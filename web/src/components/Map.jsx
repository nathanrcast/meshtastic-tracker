import { useEffect, useRef } from "react";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import { useTheme } from "../theme";
import { nodeColor } from "../lib/nodeColors";

const TILES = {
  hacker: "https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png",
  corporate: "https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png",
};
const TILE_ATTR =
  '&copy; <a href="https://www.openstreetmap.org/copyright">OSM</a> &copy; <a href="https://carto.com/">CARTO</a>';

function createIcon(online, tracked, isDark, color) {
  const stroke = isDark ? "#18181b" : "#ffffff";
  const accentColor = isDark ? "#22d3ee" : "#3b82f6";

  if (tracked) {
    const c = color || "#34d399";
    if (online) {
      const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="40" height="40" viewBox="0 0 40 40">
        <circle cx="20" cy="20" r="18" fill="none" stroke="${c}" stroke-width="1.5" opacity="0.2">
          <animate attributeName="r" values="10;18" dur="2s" repeatCount="indefinite"/>
          <animate attributeName="opacity" values="0.4;0" dur="2s" repeatCount="indefinite"/>
        </circle>
        <circle cx="20" cy="20" r="14" fill="none" stroke="${c}" stroke-width="2" opacity="0.3"/>
        <circle cx="20" cy="20" r="10" fill="${c}" stroke="${stroke}" stroke-width="2"/>
      </svg>`;
      return L.divIcon({ html: svg, className: "", iconSize: [40, 40], iconAnchor: [20, 20], popupAnchor: [0, -20] });
    }
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 32 32">
      <circle cx="16" cy="16" r="14" fill="none" stroke="${c}" stroke-width="2" opacity="0.3"/>
      <circle cx="16" cy="16" r="10" fill="${c}" stroke="${stroke}" stroke-width="2" opacity="0.5"/>
    </svg>`;
    return L.divIcon({ html: svg, className: "", iconSize: [32, 32], iconAnchor: [16, 16], popupAnchor: [0, -16] });
  }

  const color = online ? accentColor : "#52525b";
  if (online) {
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 32 32">
      <circle cx="16" cy="16" r="14" fill="none" stroke="${color}" stroke-width="1" opacity="0.15">
        <animate attributeName="r" values="8;14" dur="2.5s" repeatCount="indefinite"/>
        <animate attributeName="opacity" values="0.3;0" dur="2.5s" repeatCount="indefinite"/>
      </circle>
      <circle cx="16" cy="16" r="8" fill="${color}" stroke="${stroke}" stroke-width="2"/>
    </svg>`;
    return L.divIcon({ html: svg, className: "", iconSize: [32, 32], iconAnchor: [16, 16], popupAnchor: [0, -16] });
  }
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24">
    <circle cx="12" cy="12" r="8" fill="${color}" stroke="${stroke}" stroke-width="2"/>
  </svg>`;
  return L.divIcon({ html: svg, className: "", iconSize: [24, 24], iconAnchor: [12, 12], popupAnchor: [0, -12] });
}

function batteryColor(level) {
  if (level == null) return "text-th-muted";
  if (level > 50) return "text-emerald-400";
  if (level > 20) return "text-amber-400";
  return "text-red-400";
}

function timeAgo(iso) {
  if (!iso) return "never";
  const d = iso.endsWith("Z") ? new Date(iso) : new Date(iso + "Z");
  const s = Math.floor((Date.now() - d.getTime()) / 1000);
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
}

function buildPopup(node) {
  return `
    <div class="text-sm min-w-[160px]">
      <div class="font-semibold text-th-text" style="font-family: var(--t-font-data)">${node.long_name || node.short_name || node.node_id}</div>
      ${node.short_name ? `<div class="text-th-dim text-xs">${node.short_name}</div>` : ""}
      <div class="mt-2 space-y-1 text-xs" style="font-family: var(--t-font-data)">
        ${node.battery_level != null ? `<div class="${batteryColor(node.battery_level)}">Battery: ${node.battery_level}%</div>` : ""}
        ${node.altitude != null ? `<div class="text-th-dim">Alt: ${node.altitude}m</div>` : ""}
        ${node.snr != null ? `<div class="text-th-dim">SNR: ${node.snr} dB</div>` : ""}
        <div class="text-th-muted">${timeAgo(node.last_heard)}</div>
      </div>
    </div>
  `;
}

export default function Map({ nodes, trails, trackedIds }) {
  const containerRef = useRef(null);
  const mapRef = useRef(null);
  const tileRef = useRef(null);
  const markersRef = useRef({});
  const trailsRef = useRef({});
  const { theme } = useTheme();
  const isDark = theme === "hacker";

  // Initialize map
  useEffect(() => {
    if (mapRef.current) return;
    const map = L.map(containerRef.current, {
      center: [33.45, -112.07],
      zoom: 10,
      zoomControl: true,
    });
    tileRef.current = L.tileLayer(TILES[theme] || TILES.hacker, { attribution: TILE_ATTR, maxZoom: 19 }).addTo(map);
    mapRef.current = map;

    return () => {
      map.remove();
      mapRef.current = null;
      tileRef.current = null;
    };
  }, []);

  // Swap tiles on theme change
  useEffect(() => {
    if (!mapRef.current || !tileRef.current) return;
    const url = TILES[theme] || TILES.hacker;
    tileRef.current.setUrl(url);
  }, [theme]);

  // Update markers
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !nodes) return;

    const tracked = trackedIds || new Set();
    const currentIds = new Set();
    const bounds = [];

    for (const node of nodes) {
      if (node.lat == null || node.lon == null) continue;
      currentIds.add(node.node_id);
      const pos = [node.lat, node.lon];
      bounds.push(pos);
      const isTracked = tracked.has(node.node_id);
      const color = isTracked ? nodeColor(node.node_id) : null;
      const popup = buildPopup(node);
      const label = node.long_name || node.short_name || node.node_id;

      if (markersRef.current[node.node_id]) {
        const m = markersRef.current[node.node_id];
        m.setLatLng(pos);
        m.setIcon(createIcon(node.is_online, isTracked, isDark, color));
        m.setPopupContent(popup);
        if (m.getTooltip()) m.setTooltipContent(label);
      } else {
        const marker = L.marker(pos, { icon: createIcon(node.is_online, isTracked, isDark, color) })
          .bindPopup(popup)
          .bindTooltip(label, { permanent: true, direction: "top", offset: [0, -16], className: "mesh-node-label" })
          .addTo(map);
        markersRef.current[node.node_id] = marker;
      }
    }

    for (const id of Object.keys(markersRef.current)) {
      if (!currentIds.has(id)) {
        map.removeLayer(markersRef.current[id]);
        delete markersRef.current[id];
      }
    }

    if (bounds.length > 0) {
      map.fitBounds(bounds, { padding: [40, 40], maxZoom: 15 });
    }
  }, [nodes, trackedIds, isDark]);

  // Update trail polylines
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !trails) return;

    const tracked = trackedIds || new Set();
    const accentColor = isDark ? "#22d3ee" : "#3b82f6";

    for (const line of Object.values(trailsRef.current)) {
      map.removeLayer(line);
    }
    trailsRef.current = {};

    for (const [nodeId, positions] of Object.entries(trails)) {
      if (positions.length < 2) continue;
      const latlngs = positions.map((p) => [p.lat, p.lon]);
      const isTracked = tracked.has(nodeId);
      const line = L.polyline(latlngs, {
        color: isTracked ? nodeColor(nodeId) : accentColor,
        weight: isTracked ? 3 : 2,
        opacity: 0.6,
        dashArray: "4 6",
      }).addTo(map);
      trailsRef.current[nodeId] = line;
    }
  }, [trails, trackedIds, isDark]);

  return <div ref={containerRef} className="w-full h-full" />;
}
