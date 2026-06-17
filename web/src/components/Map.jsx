import { useEffect, useRef, useState } from "react";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import { useTheme } from "../theme";
import { nodeColor } from "../lib/nodeColors";
import { batteryColor, timeAgo } from "../lib/utils.jsx";

const TILES = {
  hacker: "https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png",
  corporate: "https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png",
};
const TILE_ATTR =
  '&copy; <a href="https://www.openstreetmap.org/copyright">OSM</a> &copy; <a href="https://carto.com/">CARTO</a>';
const MAP_VIEW_KEY = "meshtastic-map-view";

function createIcon(online, tracked, isDark, nodeClr) {
  const stroke = isDark ? "#18181b" : "#ffffff";
  const accentColor = isDark ? "#22d3ee" : "#3b82f6";

  if (tracked) {
    const c = nodeClr || "#34d399";
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

function buildPopup(node, onOpenDM) {
  const container = document.createElement("div");
  container.className = "text-sm min-w-[160px]";
  container.style.fontFamily = "var(--t-font-data)";

  const name = document.createElement("div");
  name.className = "font-semibold text-th-text";
  name.textContent = node.long_name || node.short_name || node.node_id;
  container.appendChild(name);

  if (node.short_name) {
    const short = document.createElement("div");
    short.className = "text-th-dim text-xs";
    short.textContent = node.short_name;
    container.appendChild(short);
  }

  const details = document.createElement("div");
  details.className = "mt-2 space-y-1 text-xs";

  if (node.battery_level != null) {
    const batt = document.createElement("div");
    batt.className = batteryColor(node.battery_level);
    batt.textContent = `Battery: ${node.battery_level}%`;
    details.appendChild(batt);
  }

  if (node.altitude != null) {
    const alt = document.createElement("div");
    alt.className = "text-th-dim";
    alt.textContent = `Alt: ${node.altitude}m`;
    details.appendChild(alt);
  }

  if (node.snr != null) {
    const snr = document.createElement("div");
    snr.className = "text-th-dim";
    snr.textContent = `SNR: ${node.snr} dB`;
    details.appendChild(snr);
  }

  const time = document.createElement("div");
  time.className = "text-th-muted";
  time.textContent = timeAgo(node.last_heard);
  details.appendChild(time);

  container.appendChild(details);

  if (onOpenDM) {
    const msgBtn = document.createElement("button");
    msgBtn.textContent = "Message";
    msgBtn.className = "mt-2 w-full px-2 py-1 text-xs rounded border border-violet-600/50 text-violet-400 hover:bg-violet-900/30 hover:text-violet-300 transition-colors cursor-pointer";
    msgBtn.style.fontFamily = "var(--t-font-data)";
    msgBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      onOpenDM(node.node_id);
    });
    container.appendChild(msgBtn);
  }

  return container;
}

export default function Map({ nodes, trails, trackedIds, geofences, onMapClick, onOpenDM }) {
  const containerRef = useRef(null);
  const mapRef = useRef(null);
  const tileRef = useRef(null);
  const markersRef = useRef({});
  const trailsRef = useRef({});
  const fenceLayersRef = useRef({});
  const [hasFitBounds, setHasFitBounds] = useState(false);
  const { theme } = useTheme();
  const isDark = theme === "hacker";

  // Initialize map
  useEffect(() => {
    if (mapRef.current) return;

    let center = [33.45, -112.07];
    let zoom = 10;
    let restored = false;
    try {
      const saved = JSON.parse(localStorage.getItem(MAP_VIEW_KEY));
      if (saved?.center && saved?.zoom) {
        center = saved.center;
        zoom = saved.zoom;
        restored = true;
      }
    } catch {}
    if (restored) setHasFitBounds(true);

    const map = L.map(containerRef.current, { center, zoom, zoomControl: true });
    tileRef.current = L.tileLayer(TILES[theme] || TILES.hacker, { attribution: TILE_ATTR, maxZoom: 19 }).addTo(map);
    mapRef.current = map;

    map.on("moveend", () => {
      const c = map.getCenter();
      localStorage.setItem(MAP_VIEW_KEY, JSON.stringify({ center: [c.lat, c.lng], zoom: map.getZoom() }));
    });

    const ro = new ResizeObserver(() => map.invalidateSize());
    ro.observe(containerRef.current);

    return () => {
      ro.disconnect();
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

  // Map click handler for geofence placement
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !onMapClick) return;
    const handler = (e) => onMapClick({ lat: e.latlng.lat, lon: e.latlng.lng });
    map.on("click", handler);
    return () => map.off("click", handler);
  }, [onMapClick]);

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
      const popup = buildPopup(node, onOpenDM);
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

    if (bounds.length > 0 && !hasFitBounds) {
      map.fitBounds(bounds, { padding: [40, 40], maxZoom: 15 });
      setHasFitBounds(true);
    }
  }, [nodes, trackedIds, isDark, hasFitBounds, onOpenDM]);

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

  // Geofence circles
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    for (const layer of Object.values(fenceLayersRef.current)) {
      map.removeLayer(layer);
    }
    fenceLayersRef.current = {};

    if (!geofences) return;

    const fenceColor = isDark ? "#f59e0b" : "#d97706";
    for (const fence of geofences) {
      if (!fence.enabled) continue;
      const circle = L.circle([fence.lat, fence.lon], {
        radius: fence.radius_m,
        color: fenceColor,
        weight: 2,
        opacity: 0.6,
        fillColor: fenceColor,
        fillOpacity: 0.08,
        dashArray: "6 4",
      }).addTo(map);
      circle.bindTooltip(fence.name, { direction: "center", className: "mesh-node-label" });
      fenceLayersRef.current[fence.id] = circle;
    }
  }, [geofences, isDark]);

  return <div ref={containerRef} className="w-full h-full" />;
}
