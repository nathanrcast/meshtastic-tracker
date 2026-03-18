import { useCallback, useEffect, useMemo, useState } from "react";
import { api, useWebSocket } from "../api";
import Map from "../components/Map";
import MessagePanel from "../components/MessagePanel";

export default function MapView() {
  const [nodes, setNodes] = useState([]);
  const [messages, setMessages] = useState([]);
  const [trails, setTrails] = useState({});
  const [filter, setFilter] = useState("tracked");

  // Initial data load
  useEffect(() => {
    api.nodes().then(setNodes).catch(console.error);
    api.messages(0, 100).then(setMessages).catch(console.error);
  }, []);

  const trackedIds = useMemo(
    () => new Set(nodes.filter((n) => n.is_tracked).map((n) => n.node_id)),
    [nodes]
  );

  const displayNodes = useMemo(
    () => (filter === "tracked" ? nodes.filter((n) => n.is_tracked) : nodes),
    [nodes, filter]
  );

  // Stable key for trail fetching — only re-fetch when the set of displayed node IDs changes
  const displayNodeIds = useMemo(
    () => displayNodes.filter((n) => n.lat != null && n.lon != null).map((n) => n.node_id).sort().join(","),
    [displayNodes]
  );

  // Load trails only for displayed nodes with positions
  useEffect(() => {
    if (!displayNodeIds) {
      setTrails({});
      return;
    }
    const ids = displayNodeIds.split(",");
    Promise.all(
      ids.map((id) =>
        api.nodePositions(id, 24).then((positions) => [id, positions])
      )
    ).then((results) => {
      const trailMap = {};
      for (const [id, positions] of results) {
        if (positions.length > 1) trailMap[id] = positions;
      }
      setTrails(trailMap);
    });
  }, [displayNodeIds]);

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
            is_tracked: false,
          },
        ];
      });
    }
  }, []);

  useWebSocket(handleEvent);

  const hasTracked = trackedIds.size > 0;

  return (
    <div className="flex h-[calc(100vh-3rem)] md:h-screen">
      <div className="flex-1 relative">
        <Map nodes={displayNodes} trails={trails} trackedIds={trackedIds} />

        {/* Filter toggle */}
        <div className="absolute top-3 left-1/2 -translate-x-1/2 z-[1000] flex bg-zinc-900/90 backdrop-blur border border-zinc-700 rounded-lg p-0.5 text-sm shadow-lg">
          <button
            onClick={() => setFilter("tracked")}
            className={`px-3 py-1.5 rounded-md transition-colors ${
              filter === "tracked"
                ? "bg-emerald-600 text-white"
                : "text-zinc-400 hover:text-zinc-100"
            }`}
          >
            My Nodes
          </button>
          <button
            onClick={() => setFilter("all")}
            className={`px-3 py-1.5 rounded-md transition-colors ${
              filter === "all"
                ? "bg-indigo-600 text-white"
                : "text-zinc-400 hover:text-zinc-100"
            }`}
          >
            All Nodes ({nodes.length})
          </button>
        </div>

        {/* Empty state for tracked filter */}
        {filter === "tracked" && !hasTracked && (
          <div className="absolute inset-0 z-[999] flex items-center justify-center pointer-events-none">
            <div className="bg-zinc-900/90 backdrop-blur border border-zinc-700 rounded-xl p-6 text-center pointer-events-auto">
              <p className="text-zinc-300 mb-2">No tracked nodes yet</p>
              <p className="text-zinc-500 text-sm">
                Go to the{" "}
                <a href="/nodes" className="text-emerald-400 hover:underline">
                  Nodes page
                </a>{" "}
                and star your family devices
              </p>
            </div>
          </div>
        )}
      </div>
      <MessagePanel messages={messages} trackedIds={trackedIds} />
    </div>
  );
}
