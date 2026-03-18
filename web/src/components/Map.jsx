import { useEffect, useRef } from "react";
import L from "leaflet";
import "leaflet/dist/leaflet.css";

const TILE_URL = "https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png";
const TILE_ATTR =
  '&copy; <a href="https://www.openstreetmap.org/copyright">OSM</a> &copy; <a href="https://carto.com/">CARTO</a>';

function createIcon(online) {
  const color = online ? "#818cf8" : "#52525b";
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24">
    <circle cx="12" cy="12" r="8" fill="${color}" stroke="#18181b" stroke-width="2"/>
  </svg>`;
  return L.divIcon({
    html: svg,
    className: "",
    iconSize: [24, 24],
    iconAnchor: [12, 12],
    popupAnchor: [0, -12],
  });
}

function batteryColor(level) {
  if (level == null) return "text-zinc-500";
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

export default function Map({ nodes, trails }) {
  const containerRef = useRef(null);
  const mapRef = useRef(null);
  const markersRef = useRef({});
  const trailsRef = useRef({});

  // Initialize map
  useEffect(() => {
    if (mapRef.current) return;
    const map = L.map(containerRef.current, {
      center: [33.45, -112.07], // Phoenix default
      zoom: 10,
      zoomControl: true,
    });
    L.tileLayer(TILE_URL, { attribution: TILE_ATTR, maxZoom: 19 }).addTo(map);
    mapRef.current = map;

    return () => {
      map.remove();
      mapRef.current = null;
    };
  }, []);

  // Update markers
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !nodes) return;

    const currentIds = new Set();
    const bounds = [];

    for (const node of nodes) {
      if (node.lat == null || node.lon == null) continue;
      currentIds.add(node.node_id);
      const pos = [node.lat, node.lon];
      bounds.push(pos);

      const popup = `
        <div class="text-sm min-w-[160px]">
          <div class="font-semibold text-zinc-100">${node.long_name || node.short_name || node.node_id}</div>
          ${node.short_name ? `<div class="text-zinc-400 text-xs">${node.short_name}</div>` : ""}
          <div class="mt-2 space-y-1 text-xs">
            ${node.battery_level != null ? `<div class="${batteryColor(node.battery_level)}">Battery: ${node.battery_level}%</div>` : ""}
            ${node.altitude != null ? `<div class="text-zinc-400">Alt: ${node.altitude}m</div>` : ""}
            ${node.snr != null ? `<div class="text-zinc-400">SNR: ${node.snr} dB</div>` : ""}
            <div class="text-zinc-500">${timeAgo(node.last_heard)}</div>
          </div>
        </div>
      `;

      if (markersRef.current[node.node_id]) {
        markersRef.current[node.node_id].setLatLng(pos);
        markersRef.current[node.node_id].setIcon(createIcon(node.is_online));
        markersRef.current[node.node_id].setPopupContent(popup);
      } else {
        const marker = L.marker(pos, { icon: createIcon(node.is_online) })
          .bindPopup(popup)
          .addTo(map);
        markersRef.current[node.node_id] = marker;
      }
    }

    // Remove stale markers
    for (const id of Object.keys(markersRef.current)) {
      if (!currentIds.has(id)) {
        map.removeLayer(markersRef.current[id]);
        delete markersRef.current[id];
      }
    }

    // Auto-fit bounds
    if (bounds.length > 0) {
      map.fitBounds(bounds, { padding: [40, 40], maxZoom: 15 });
    }
  }, [nodes]);

  // Update trail polylines
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !trails) return;

    // Clear old trails
    for (const line of Object.values(trailsRef.current)) {
      map.removeLayer(line);
    }
    trailsRef.current = {};

    for (const [nodeId, positions] of Object.entries(trails)) {
      if (positions.length < 2) continue;
      const latlngs = positions.map((p) => [p.lat, p.lon]);
      const line = L.polyline(latlngs, {
        color: "#818cf8",
        weight: 2,
        opacity: 0.6,
        dashArray: "4 6",
      }).addTo(map);
      trailsRef.current[nodeId] = line;
    }
  }, [trails]);

  return <div ref={containerRef} className="w-full h-full" />;
}
