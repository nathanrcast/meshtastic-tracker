import { useEffect, useRef } from "react";

const BASE = "/api";

let apiKey = localStorage.getItem("meshtastic-api-key") || "";

export { utc } from "./lib/utils.jsx";

function authHeaders() {
  const h = {};
  if (apiKey) h["X-API-Key"] = apiKey;
  return h;
}

async function fetchJSON(path, opts = {}) {
  const headers = { ...authHeaders(), ...opts.headers };
  const res = await fetch(`${BASE}${path}`, { ...opts, headers });
  if (res.status === 401) {
    window.dispatchEvent(new Event("meshtastic-auth-required"));
    throw new Error("Authentication required");
  }
  if (!res.ok) {
    const body = await res.json().catch(() => null);
    throw new Error(body?.detail || `${res.status} ${res.statusText}`);
  }
  return res.json();
}

export const api = {
  getKey: () => apiKey,
  setKey: (key) => {
    apiKey = key;
    if (key) localStorage.setItem("meshtastic-api-key", key);
    else localStorage.removeItem("meshtastic-api-key");
  },
  nodes: (tracked = false) => fetchJSON(`/nodes${tracked ? "?tracked=true" : ""}`),
  setTracked: (nodeId, isTracked) =>
    fetchJSON(`/nodes/${encodeURIComponent(nodeId)}/tracked`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ is_tracked: isTracked }),
    }),
  nodePositions: (nodeId, hours = 24, { start, end } = {}) => {
    const params = start && end
      ? `start=${encodeURIComponent(start)}&end=${encodeURIComponent(end)}`
      : `hours=${hours}`;
    return fetchJSON(`/nodes/${encodeURIComponent(nodeId)}/positions?${params}`);
  },
  messages: (channel = 0, limit = 100) =>
    fetchJSON(`/messages?channel=${channel}&limit=${limit}`),
  sendMessage: async (text, channel = 0) => {
    const res = await fetch(`${BASE}/messages`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...authHeaders() },
      body: JSON.stringify({ text, channel }),
    });
    if (res.status === 401) {
      window.dispatchEvent(new Event("meshtastic-auth-required"));
      throw new Error("Authentication required");
    }
    if (!res.ok) {
      const body = await res.json().catch(() => null);
      throw new Error(body?.detail || `${res.status} ${res.statusText}`);
    }
    return res.json();
  },
  sendDM: async (text, toId, channel = 0) => {
    const res = await fetch(`${BASE}/messages`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...authHeaders() },
      body: JSON.stringify({ text, channel, to_id: toId }),
    });
    if (res.status === 401) {
      window.dispatchEvent(new Event("meshtastic-auth-required"));
      throw new Error("Authentication required");
    }
    if (!res.ok) {
      const body = await res.json().catch(() => null);
      throw new Error(body?.detail || `${res.status} ${res.statusText}`);
    }
    return res.json();
  },
  dmMessages: (peerId, limit = 100) =>
    fetchJSON(`/messages/dm/${encodeURIComponent(peerId)}?limit=${limit}`),
  conversations: () => fetchJSON("/conversations"),
  react: (packetId, emoji, channel = 0) =>
    fetchJSON(`/messages/${packetId}/react`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ emoji, channel }),
    }),
  channels: () => fetchJSON("/channels"),
  health: () => fetchJSON("/health"),
  disconnect: () => fetchJSON("/disconnect", { method: "POST" }),
  reconnect: () => fetchJSON("/reconnect", { method: "POST" }),
  geofences: () => fetchJSON("/geofences"),
  createGeofence: (name, lat, lon, radius_m) =>
    fetchJSON("/geofences", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name, lat, lon, radius_m }),
    }),
  updateGeofence: (id, data) =>
    fetchJSON(`/geofences/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(data),
    }),
  deleteGeofence: (id) => fetchJSON(`/geofences/${id}`, { method: "DELETE" }),
};

export function useWebSocket(onEvent) {
  const cbRef = useRef(onEvent);
  cbRef.current = onEvent;

  useEffect(() => {
    let ws;
    let reconnectTimer;
    let attempt = 0;

    function backoffMs() {
      // 1s, 2s, 4s, 8s, ... cap at 30s + jitter
      const base = Math.min(1000 * Math.pow(2, attempt), 30000);
      const jitter = Math.floor(Math.random() * 250);
      return base + jitter;
    }

    function connect() {
      const proto = location.protocol === "https:" ? "wss:" : "ws:";
      const keyParam = apiKey ? `?key=${encodeURIComponent(apiKey)}` : "";
      ws = new WebSocket(`${proto}//${location.host}${BASE}/ws${keyParam}`);

      ws.onopen = () => {
        attempt = 0;
      };

      ws.onmessage = (e) => {
        try {
          cbRef.current(JSON.parse(e.data));
        } catch {}
      };

      ws.onclose = () => {
        const delay = backoffMs();
        attempt += 1;
        reconnectTimer = setTimeout(connect, delay);
      };

      ws.onerror = () => {
        try {
          ws.close();
        } catch {}
      };
    }

    connect();

    return () => {
      clearTimeout(reconnectTimer);
      if (ws) ws.close();
    };
  }, []);
}
