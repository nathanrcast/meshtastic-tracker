import { useCallback, useEffect, useState } from "react";
import { api, useWebSocket } from "../api";
import Map from "../components/Map";
import MessagePanel from "../components/MessagePanel";

export default function MapView() {
  const [nodes, setNodes] = useState([]);
  const [messages, setMessages] = useState([]);
  const [trails, setTrails] = useState({});

  // Initial data load
  useEffect(() => {
    api.nodes().then(setNodes).catch(console.error);
    api.messages(0, 100).then(setMessages).catch(console.error);
  }, []);

  // Load trails for nodes with positions
  useEffect(() => {
    const nodesWithPos = nodes.filter((n) => n.lat != null && n.lon != null);
    if (nodesWithPos.length === 0) return;

    Promise.all(
      nodesWithPos.map((n) =>
        api.nodePositions(n.node_id, 24).then((positions) => [n.node_id, positions])
      )
    ).then((results) => {
      const trailMap = {};
      for (const [id, positions] of results) {
        if (positions.length > 1) trailMap[id] = positions;
      }
      setTrails(trailMap);
    });
  }, [nodes]);

  // WebSocket for real-time updates
  const handleEvent = useCallback((event) => {
    if (event.type === "position") {
      setNodes((prev) =>
        prev.map((n) =>
          n.node_id === event.node_id
            ? { ...n, lat: event.lat, lon: event.lon, altitude: event.altitude, is_online: true }
            : n
        )
      );
      setTrails((prev) => {
        const existing = prev[event.node_id] || [];
        return {
          ...prev,
          [event.node_id]: [
            ...existing,
            { lat: event.lat, lon: event.lon, altitude: event.altitude },
          ],
        };
      });
    } else if (event.type === "message") {
      setMessages((prev) => [...prev, event]);
    } else if (event.type === "node_update") {
      setNodes((prev) => {
        const exists = prev.some((n) => n.node_id === event.node_id);
        if (exists) {
          return prev.map((n) =>
            n.node_id === event.node_id
              ? { ...n, long_name: event.long_name, short_name: event.short_name }
              : n
          );
        }
        return [
          ...prev,
          {
            node_id: event.node_id,
            long_name: event.long_name,
            short_name: event.short_name,
            hardware_model: "",
            battery_level: null,
            voltage: null,
            snr: null,
            lat: null,
            lon: null,
            altitude: null,
            last_heard: null,
            is_online: true,
          },
        ];
      });
    }
  }, []);

  useWebSocket(handleEvent);

  return (
    <div className="flex h-[calc(100vh-3rem)] md:h-screen">
      <div className="flex-1">
        <Map nodes={nodes} trails={trails} />
      </div>
      <MessagePanel messages={messages} />
    </div>
  );
}
