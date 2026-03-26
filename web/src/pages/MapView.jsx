import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { api, useWebSocket } from "../api";
import Map from "../components/Map";
import MessagePanel from "../components/MessagePanel";
import GeofencePanel from "../components/GeofencePanel";
import { nodeColor } from "../lib/nodeColors";
import usePersistedState from "../hooks/usePersistedState";

export default function MapView() {
  const [searchParams, setSearchParams] = useSearchParams();
  const [nodes, setNodes] = useState([]);
  const [messagesByChannel, setMessagesByChannel] = useState({});
  const [channels, setChannels] = useState([]);
  const [trails, setTrails] = useState({});
  const [filter, setFilter] = usePersistedState("map-filter", "tracked");
  const [hiddenNodeIds, setHiddenNodeIds] = usePersistedState("hidden-node-ids", new Set());
  const [nodeListOpen, setNodeListOpen] = usePersistedState("node-list-open", false);
  const [geofences, setGeofences] = useState([]);
  const [mapControlsOpen, setMapControlsOpen] = usePersistedState("map-controls-open", true);
  const [trailHours, setTrailHours] = usePersistedState("trail-hours", 24);
  const [trailMode, setTrailMode] = useState("preset"); // "preset" | "custom"
  const [customStart, setCustomStart] = useState("");
  const [customEnd, setCustomEnd] = useState("");

  // DM state
  const [myNodeId, setMyNodeId] = useState(null);
  const myNodeIdRef = useRef(null);
  const [dmMessages, setDmMessages] = useState({});
  const [openDMs, setOpenDMs] = usePersistedState("open-dms", []);
  const [activeConversation, setActiveConversation] = usePersistedState("active-conversation", { type: "channel", channelIndex: 0 });

  useEffect(() => { myNodeIdRef.current = myNodeId; }, [myNodeId]);

  // Open DM from ?dm= query param (e.g., from Nodes page)
  useEffect(() => {
    const dmId = searchParams.get("dm");
    if (dmId) {
      setOpenDMs((prev) => prev.includes(dmId) ? prev : [...prev, dmId]);
      setActiveConversation({ type: "dm", peerId: dmId });
      setSearchParams({}, { replace: true });
    }
  }, [searchParams]);

  const loadGeofences = useCallback(() => {
    api.geofences().then(setGeofences).catch(console.error);
  }, []);

  useEffect(() => {
    api.nodes().then(setNodes).catch(console.error);
    api.channels().then(setChannels).catch(console.error);
    api.messages(0, 100).then((msgs) => {
      setMessagesByChannel((prev) => ({ ...prev, 0: msgs }));
    }).catch(console.error);
    api.health().then((h) => setMyNodeId(h.my_node_id)).catch(console.error);
    loadGeofences();
  }, [loadGeofences]);

  // Lazy-load channel messages
  useEffect(() => {
    if (activeConversation.type !== "channel") return;
    const ch = activeConversation.channelIndex;
    if (messagesByChannel[ch]) return;
    api.messages(ch, 100).then((msgs) => {
      setMessagesByChannel((prev) => ({ ...prev, [ch]: msgs }));
    }).catch(console.error);
  }, [activeConversation]);

  // Lazy-load DM messages
  useEffect(() => {
    if (activeConversation.type !== "dm") return;
    const peerId = activeConversation.peerId;
    if (dmMessages[peerId]) return;
    api.dmMessages(peerId, 100).then((msgs) => {
      setDmMessages((prev) => ({ ...prev, [peerId]: msgs }));
    }).catch(console.error);
  }, [activeConversation]);

  const visibleMessages = activeConversation.type === "channel"
    ? (messagesByChannel[activeConversation.channelIndex] || [])
    : (dmMessages[activeConversation.peerId] || []);

  const trackedIds = useMemo(
    () => new Set(nodes.filter((n) => n.is_tracked).map((n) => n.node_id)),
    [nodes]
  );

  const displayNodes = useMemo(
    () => {
      if (filter === "tracked") {
        return nodes.filter((n) => n.is_tracked && !hiddenNodeIds.has(n.node_id));
      }
      return nodes;
    },
    [nodes, filter, hiddenNodeIds]
  );

  const displayNodeIds = useMemo(
    () => displayNodes.filter((n) => n.lat != null && n.lon != null).map((n) => n.node_id).sort().join(","),
    [displayNodes]
  );

  useEffect(() => {
    if (!displayNodeIds) {
      setTrails({});
      return;
    }
    const ids = displayNodeIds.split(",");
    const opts = trailMode === "custom" && customStart && customEnd
      ? { start: new Date(customStart).toISOString(), end: new Date(customEnd).toISOString() }
      : {};
    const hours = trailMode === "preset" ? trailHours : 24;
    Promise.all(
      ids.map((id) =>
        api.nodePositions(id, hours, opts).then((positions) => [id, positions])
      )
    ).then((results) => {
      const trailMap = {};
      for (const [id, positions] of results) {
        if (positions.length > 1) trailMap[id] = positions;
      }
      setTrails(trailMap);
    });
  }, [displayNodeIds, trailHours, trailMode, customStart, customEnd]);

  const pendingIdRef = useRef(null);

  const appendToList = useCallback((setter, key, msg, isPending) => {
    setter((prev) => {
      const existing = prev[key] || [];
      if (existing.some((m) => m.id === msg.id)) return prev;
      if (!isPending && pendingIdRef.current && existing.some((m) => typeof m.id === "string" && m.id.startsWith("pending-"))) {
        pendingIdRef.current = null;
        return { ...prev, [key]: existing.map((m) => (typeof m.id === "string" && m.id.startsWith("pending-") ? msg : m)) };
      }
      const updated = [...existing, msg];
      return { ...prev, [key]: updated.length > 500 ? updated.slice(-500) : updated };
    });
  }, []);

  const addMessage = useCallback((msg) => {
    const isPending = typeof msg.id === "string" && msg.id.startsWith("pending-");
    if (isPending) pendingIdRef.current = msg.id;

    const isDM = msg.to_id && msg.to_id !== "^all";
    if (isDM) {
      const peerId = msg.from_id === myNodeIdRef.current ? msg.to_id : msg.from_id;
      appendToList(setDmMessages, peerId, msg, isPending);
      setOpenDMs((prev) => prev.includes(peerId) ? prev : [...prev, peerId]);
      return;
    }
    appendToList(setMessagesByChannel, msg.channel ?? 0, msg, isPending);
  }, [appendToList]);

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
        const updated = [...existing, { lat: event.lat, lon: event.lon, altitude: event.altitude }];
        return {
          ...prev,
          [event.node_id]: updated.length > 500 ? updated.slice(-500) : updated,
        };
      });
    } else if (event.type === "message") {
      addMessage(event);
    } else if (event.type === "reaction") {
      setMessagesByChannel((prev) => {
        const updated = {};
        for (const [ch, msgs] of Object.entries(prev)) {
          updated[ch] = msgs.map((m) =>
            m.packet_id === event.message_packet_id
              ? { ...m, reactions: [...(m.reactions || []), { from_id: event.from_id, emoji: event.emoji }] }
              : m
          );
        }
        return updated;
      });
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

  const trackedNodes = useMemo(
    () => nodes.filter((n) => n.is_tracked),
    [nodes]
  );

  const handleReact = useCallback((packetId, emoji, channel = 0) => {
    api.react(packetId, emoji, channel).catch(console.error);
  }, []);

  const handleChannelChange = useCallback((channelIndex) => {
    setActiveConversation({ type: "channel", channelIndex });
  }, []);

  const handleOpenDM = useCallback((peerId) => {
    setOpenDMs((prev) => prev.includes(peerId) ? prev : [...prev, peerId]);
    setActiveConversation({ type: "dm", peerId });
  }, []);

  const handleCloseDM = useCallback((peerId) => {
    setOpenDMs((prev) => prev.filter((id) => id !== peerId));
    setActiveConversation((prev) =>
      prev.type === "dm" && prev.peerId === peerId
        ? { type: "channel", channelIndex: 0 }
        : prev
    );
  }, []);

  const hasTracked = trackedIds.size > 0;

  const geofencePanel = GeofencePanel({ geofences, onUpdate: loadGeofences });

  return (
    <div className="flex h-[calc(100vh-3rem)] md:h-screen">
      <div className="flex-1 relative isolate">
        <Map
          nodes={displayNodes}
          trails={trails}
          trackedIds={trackedIds}
          geofences={geofences}
          onMapClick={geofencePanel.onMapClick}
          onOpenDM={handleOpenDM}
        />

        <div className="absolute top-3 left-1/2 -translate-x-1/2 z-[1000] flex flex-col items-center gap-1.5 animate-fade-in">
          {/* Mobile toggle for map controls */}
          <button
            onClick={() => setMapControlsOpen((o) => !o)}
            className="md:hidden bg-th-surface/90 backdrop-blur border border-th-border-strong rounded-md px-2.5 py-1 text-xs font-mono text-th-dim hover:text-th-text shadow-lg flex items-center gap-1.5 transition-colors"
          >
            <svg className={`w-3 h-3 transition-transform ${mapControlsOpen ? "rotate-180" : ""}`} fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
            </svg>
            {mapControlsOpen ? "Hide" : "Controls"}
          </button>

          <div className={`${mapControlsOpen ? "flex" : "hidden md:flex"} flex-col items-center gap-1.5`}>
          <div className="flex bg-th-surface/90 backdrop-blur border border-th-border-strong rounded-md p-0.5 text-xs md:text-sm shadow-lg font-mono">
            <button
              onClick={() => setFilter("tracked")}
              className={`px-2 py-1 md:px-3 md:py-1.5 rounded transition-colors ${
                filter === "tracked"
                  ? "bg-emerald-900/50 text-emerald-300 ring-1 ring-emerald-700"
                  : "text-th-dim hover:text-th-text"
              }`}
            >
              My Nodes
            </button>
            <button
              onClick={() => { setFilter("all"); setHiddenNodeIds(new Set()); setNodeListOpen(false); }}
              className={`px-2 py-1 md:px-3 md:py-1.5 rounded transition-colors ${
                filter === "all"
                  ? "bg-th-accent-bg/50 text-th-accent-light ring-1 ring-th-accent-border"
                  : "text-th-dim hover:text-th-text"
              }`}
            >
              All Nodes ({nodes.length})
            </button>
          </div>

          <div className="flex flex-col items-center gap-1">
            <div className="flex bg-th-surface/90 backdrop-blur border border-th-border-strong rounded-md p-0.5 text-xs shadow-lg font-mono">
              {[
                { label: "1h", hours: 1 },
                { label: "6h", hours: 6 },
                { label: "24h", hours: 24 },
                { label: "3d", hours: 72 },
                { label: "7d", hours: 168 },
                { label: "30d", hours: 720 },
              ].map(({ label, hours }) => (
                <button
                  key={label}
                  onClick={() => { setTrailMode("preset"); setTrailHours(hours); }}
                  className={`px-2 py-1 rounded transition-colors ${
                    trailMode === "preset" && trailHours === hours
                      ? "bg-th-accent-bg/50 text-th-accent-light ring-1 ring-th-accent-border"
                      : "text-th-dim hover:text-th-text"
                  }`}
                >
                  {label}
                </button>
              ))}
              <button
                onClick={() => setTrailMode("custom")}
                className={`px-2 py-1 rounded transition-colors ${
                  trailMode === "custom"
                    ? "bg-th-accent-bg/50 text-th-accent-light ring-1 ring-th-accent-border"
                    : "text-th-dim hover:text-th-text"
                }`}
              >
                Custom
              </button>
            </div>
            {trailMode === "custom" && (
              <div className="flex items-center gap-1.5 bg-th-surface/90 backdrop-blur border border-th-border-strong rounded-md px-2 py-1.5 text-xs shadow-lg font-mono">
                <input
                  type="datetime-local"
                  value={customStart}
                  onChange={(e) => setCustomStart(e.target.value)}
                  className="bg-th-bg border border-th-border rounded px-1.5 py-0.5 text-th-text text-xs"
                />
                <span className="text-th-muted">&rarr;</span>
                <input
                  type="datetime-local"
                  value={customEnd}
                  onChange={(e) => setCustomEnd(e.target.value)}
                  className="bg-th-bg border border-th-border rounded px-1.5 py-0.5 text-th-text text-xs"
                />
              </div>
            )}
          </div>

          {filter === "tracked" && trackedNodes.length >= 2 && (
            <div className="bg-th-surface/90 backdrop-blur border border-th-border-strong rounded-md shadow-lg font-mono text-xs">
              <button
                onClick={() => setNodeListOpen((o) => !o)}
                className="flex items-center gap-1.5 px-3 py-1.5 text-th-dim hover:text-th-text transition-colors w-full"
              >
                <span className={`transition-transform ${nodeListOpen ? "rotate-90" : ""}`}>&#9654;</span>
                {trackedNodes.length} tracked nodes
              </button>
              {nodeListOpen && (
                <div className="border-t border-th-border px-1 py-1 space-y-0.5 max-h-48 overflow-y-auto">
                  {trackedNodes.map((n) => {
                    const hidden = hiddenNodeIds.has(n.node_id);
                    const color = nodeColor(n.node_id);
                    return (
                      <button
                        key={n.node_id}
                        onClick={() => {
                          setHiddenNodeIds((prev) => {
                            const next = new Set(prev);
                            if (next.has(n.node_id)) next.delete(n.node_id);
                            else next.add(n.node_id);
                            return next;
                          });
                        }}
                        className="flex items-center gap-2 px-2 py-1 rounded hover:bg-th-hover/50 transition-colors w-full text-left"
                      >
                        <span
                          className="inline-block w-2.5 h-2.5 rounded-full flex-shrink-0 transition-opacity"
                          style={{ backgroundColor: color, opacity: hidden ? 0.3 : 1 }}
                        />
                        <span className={`truncate transition-opacity ${hidden ? "line-through text-th-muted opacity-50" : "text-th-dim"}`}>
                          {n.long_name || n.short_name || n.node_id}
                        </span>
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
          )}

          {geofencePanel.panel}
          </div>
        </div>

        {filter === "tracked" && !hasTracked && hiddenNodeIds.size === 0 && (
          <div className="absolute inset-0 z-[999] flex items-center justify-center pointer-events-none">
            <div className="bg-th-surface/90 backdrop-blur border border-th-border-strong rounded-lg p-6 text-center pointer-events-auto">
              <p className="text-th-body mb-2 font-mono">No tracked nodes</p>
              <p className="text-th-muted text-sm">
                Go to the{" "}
                <a href="/nodes" className="text-th-accent hover:underline">
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
        selectedChannel={activeConversation.type === "channel" ? activeConversation.channelIndex : null}
        onChannelChange={handleChannelChange}
        onMessageSent={addMessage}
        onReact={handleReact}
        myNodeId={myNodeId}
        activeConversation={activeConversation}
        openDMs={openDMs}
        onOpenDM={handleOpenDM}
        onCloseDM={handleCloseDM}
        nodes={nodes}
      />
    </div>
  );
}
