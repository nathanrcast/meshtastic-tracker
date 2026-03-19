import { useCallback, useEffect, useMemo, useState } from "react";
import { api, useWebSocket } from "../api";
import Map from "../components/Map";
import MessagePanel from "../components/MessagePanel";

export default function MapView() {
  const [nodes, setNodes] = useState([]);
  const [messagesByChannel, setMessagesByChannel] = useState({});
  const [channels, setChannels] = useState([]);
  const [selectedChannel, setSelectedChannel] = useState(0);
  const [trails, setTrails] = useState({});
  const [filter, setFilter] = useState("tracked");

  // Initial data load
  useEffect(() => {
    api.nodes().then(setNodes).catch(console.error);
    api.channels().then(setChannels).catch(console.error);
    api.messages(0, 100).then((msgs) => {
      setMessagesByChannel((prev) => ({ ...prev, 0: msgs }));
    }).catch(console.error);
  }, []);

  // Fetch history when switching to a channel with no cached messages
  useEffect(() => {
    if (messagesByChannel[selectedChannel]) return;
    api.messages(selectedChannel, 100).then((msgs) => {
      setMessagesByChannel((prev) => ({ ...prev, [selectedChannel]: msgs }));
    }).catch(console.error);
  }, [selectedChannel]);

  const visibleMessages = messagesByChannel[selectedChannel] || [];

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

  const addMessage = useCallback((msg) => {
    const ch = msg.channel ?? 0;
    setMessagesByChannel((prev) => {
      const existing = prev[ch] || [];
      if (existing.some((m) => m.id === msg.id)) return prev;
      return { ...prev, [ch]: [...existing, msg] };
    });
  }, []);

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
      addMessage(event);
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
  }, [addMessage]);

  useWebSocket(handleEvent);

  const hasTracked = trackedIds.size > 0;

  return (
    <div className="flex h-[calc(100vh-3rem)] md:h-screen">
      <div className="flex-1 relative">
        <Map nodes={displayNodes} trails={trails} trackedIds={trackedIds} />

        {/* Filter toggle */}
        <div className="absolute top-3 left-1/2 -translate-x-1/2 z-[1000] flex bg-zinc-900/90 backdrop-blur border border-zinc-700 rounded-md p-0.5 text-sm shadow-lg animate-fade-in font-mono">
          <button
            onClick={() => setFilter("tracked")}
            className={`px-3 py-1.5 rounded transition-colors ${
              filter === "tracked"
                ? "bg-emerald-900/50 text-emerald-300 ring-1 ring-emerald-700"
                : "text-zinc-400 hover:text-zinc-200"
            }`}
          >
            My Nodes
          </button>
          <button
            onClick={() => setFilter("all")}
            className={`px-3 py-1.5 rounded transition-colors ${
              filter === "all"
                ? "bg-mesh-950/50 text-mesh-300 ring-1 ring-mesh-700"
                : "text-zinc-400 hover:text-zinc-200"
            }`}
          >
            All Nodes ({nodes.length})
          </button>
        </div>

        {/* Empty state for tracked filter */}
        {filter === "tracked" && !hasTracked && (
          <div className="absolute inset-0 z-[999] flex items-center justify-center pointer-events-none">
            <div className="bg-zinc-900/90 backdrop-blur border border-zinc-700 rounded-lg p-6 text-center pointer-events-auto">
              <p className="text-zinc-300 mb-2 font-mono">No tracked nodes</p>
              <p className="text-zinc-500 text-sm">
                Go to the{" "}
                <a href="/nodes" className="text-mesh-400 hover:underline">
                  Nodes page
                </a>{" "}
                and star your devices
              </p>
            </div>
          </div>
        )}
      </div>
      <MessagePanel
        messages={visibleMessages}
        trackedIds={trackedIds}
        channels={channels}
        selectedChannel={selectedChannel}
        onChannelChange={setSelectedChannel}
        onMessageSent={addMessage}
      />
    </div>
  );
}
