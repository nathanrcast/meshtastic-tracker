import { useEffect, useRef } from "react";

const BASE = "/api";

export function utc(iso) {
  if (!iso) return null;
  if (!iso.endsWith("Z") && !iso.includes("+")) return new Date(iso + "Z");
  return new Date(iso);
}

async function fetchJSON(path, opts = {}) {
  const res = await fetch(`${BASE}${path}`, opts);
  if (!res.ok) {
    const body = await res.json().catch(() => null);
    throw new Error(body?.detail || `${res.status} ${res.statusText}`);
  }
  return res.json();
}

export const api = {
  nodes: (tracked = false) => fetchJSON(`/nodes${tracked ? "?tracked=true" : ""}`),
  setTracked: (nodeId, isTracked) =>
    fetchJSON(`/nodes/${encodeURIComponent(nodeId)}/tracked`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ is_tracked: isTracked }),
    }),
  nodePositions: (nodeId, hours = 24) =>
    fetchJSON(`/nodes/${encodeURIComponent(nodeId)}/positions?hours=${hours}`),
  messages: (channel = 0, limit = 100) =>
    fetchJSON(`/messages?channel=${channel}&limit=${limit}`),
  sendMessage: (text, channel = 0) =>
    fetchJSON("/messages", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text, channel }),
    }),
  channels: () => fetchJSON("/channels"),
  health: () => fetchJSON("/health"),
  disconnect: () => fetchJSON("/disconnect", { method: "POST" }),
  reconnect: () => fetchJSON("/reconnect", { method: "POST" }),
};

export function useWebSocket(onEvent) {
  const cbRef = useRef(onEvent);
  cbRef.current = onEvent;

  useEffect(() => {
    let ws;
    let reconnectTimer;

    function connect() {
      const proto = location.protocol === "https:" ? "wss:" : "ws:";
      ws = new WebSocket(`${proto}//${location.host}${BASE}/ws`);

      ws.onmessage = (e) => {
        try {
          cbRef.current(JSON.parse(e.data));
        } catch {}
      };

      ws.onclose = () => {
        reconnectTimer = setTimeout(connect, 3000);
      };

      ws.onerror = () => ws.close();
    }

    connect();

    return () => {
      clearTimeout(reconnectTimer);
      if (ws) ws.close();
    };
  }, []);
}
