import { useCallback, useEffect, useRef, useState } from "react";
import { useNavigate, useParams, Link } from "react-router-dom";
import { api, useWebSocket } from "../api";
import Map from "../components/Map";
import { batteryBar, timeAgo, utc } from "../lib/utils.jsx";

const TRAIL_PRESETS = [
  { label: "1h", hours: 1 },
  { label: "6h", hours: 6 },
  { label: "24h", hours: 24 },
  { label: "3d", hours: 72 },
  { label: "7d", hours: 168 },
  { label: "30d", hours: 720 },
];

const TRACEROUTE_TIMEOUT_MS = 30000;

function formatTime(iso) {
  const d = utc(iso);
  if (!d) return "";
  return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

function hopLabel(hop) {
  if (!hop) return "?";
  const snr = hop.snr != null ? `${hop.snr.toFixed(1)}dB` : "?dB";
  return `${hop.node_id || "?"} (${snr})`;
}

export default function NodeDetail() {
  const { nodeId } = useParams();
  const navigate = useNavigate();

  const [node, setNode] = useState(null);
  const [notFound, setNotFound] = useState(false);
  const [myNodeId, setMyNodeId] = useState(null);
  const [trail, setTrail] = useState([]);
  const [trailHours, setTrailHours] = useState(24);

  const [messages, setMessages] = useState([]);
  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);

  const [traceroute, setTraceroute] = useState(null);
  const [tracerouteState, setTracerouteState] = useState("idle"); // idle | running | timeout | error
  const tracerouteTimerRef = useRef(null);
  const bottomRef = useRef(null);

  useEffect(() => {
    setNode(null);
    setNotFound(false);
    api.node(nodeId).then(setNode).catch(() => setNotFound(true));
  }, [nodeId]);

  useEffect(() => {
    api.health().then((h) => setMyNodeId(h.my_node_id)).catch(() => {});
  }, []);

  useEffect(() => {
    api.dmMessages(nodeId, 100).then(setMessages).catch(console.error);
  }, [nodeId]);

  useEffect(() => {
    api.lastTraceroute(nodeId).then((tr) => {
      if (tr) setTraceroute(tr);
    });
  }, [nodeId]);

  useEffect(() => {
    let cancelled = false;
    api.nodePositions(nodeId, trailHours).then((positions) => {
      if (!cancelled) setTrail(positions);
    }).catch(() => {});
    return () => { cancelled = true; };
  }, [nodeId, trailHours]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  useEffect(() => {
    return () => {
      if (tracerouteTimerRef.current) clearTimeout(tracerouteTimerRef.current);
    };
  }, []);

  const handleEvent = useCallback((event) => {
    if (event.type === "position" && event.node_id === nodeId) {
      setNode((prev) => prev ? {
        ...prev,
        lat: event.lat,
        lon: event.lon,
        altitude: event.altitude,
        hops_away: event.hops_away ?? prev.hops_away,
        is_online: true,
        last_heard: new Date().toISOString(),
      } : prev);
      setTrail((prev) => {
        const updated = [...prev, { lat: event.lat, lon: event.lon, altitude: event.altitude, timestamp: new Date().toISOString() }];
        return updated.length > 2000 ? updated.slice(-2000) : updated;
      });
    } else if (event.type === "node_update" && event.node_id === nodeId) {
      setNode((prev) => prev ? {
        ...prev,
        long_name: event.long_name,
        short_name: event.short_name,
        hops_away: event.hops_away ?? prev.hops_away,
      } : prev);
    } else if (event.type === "message") {
      const isDM = event.to_id && event.to_id !== "^all";
      if (!isDM) return;
      const peerId = event.from_id === myNodeId ? event.to_id : event.from_id;
      if (peerId !== nodeId) return;
      setMessages((prev) => {
        if (prev.some((m) => m.id === event.id)) return prev;
        const pendingIdx = prev.findIndex((m) => typeof m.id === "string" && m.id.startsWith("pending-"));
        if (pendingIdx >= 0 && typeof event.id !== "string") {
          const next = [...prev];
          next[pendingIdx] = event;
          return next;
        }
        return [...prev, event];
      });
    } else if (event.type === "traceroute" && event.node_id === nodeId) {
      if (tracerouteTimerRef.current) {
        clearTimeout(tracerouteTimerRef.current);
        tracerouteTimerRef.current = null;
      }
      setTraceroute({ route: event.route, route_back: event.route_back, timestamp: event.timestamp });
      setTracerouteState("idle");
    }
  }, [nodeId, myNodeId]);

  useWebSocket(handleEvent);

  const toggleTracked = async () => {
    if (!node) return;
    const newVal = !node.is_tracked;
    setNode((prev) => ({ ...prev, is_tracked: newVal }));
    try {
      await api.setTracked(nodeId, newVal);
    } catch {
      setNode((prev) => ({ ...prev, is_tracked: !newVal }));
    }
  };

  const sendMessage = async (e) => {
    e.preventDefault();
    const msg = text.trim();
    if (!msg || sending) return;
    setText("");
    setSending(true);

    const optimistic = {
      id: `pending-${Date.now()}`,
      from_id: myNodeId || "local",
      from_name: "You",
      to_id: nodeId,
      channel: 0,
      text: msg,
      snr: null,
      rssi: null,
      timestamp: new Date().toISOString(),
      reactions: [],
    };
    setMessages((prev) => [...prev, optimistic]);

    try {
      const real = await api.sendDM(msg, nodeId);
      if (real?.id) {
        setMessages((prev) => prev.map((m) => (m.id === optimistic.id ? real : m)));
      }
    } catch (err) {
      console.error("Send failed:", err);
    } finally {
      setSending(false);
    }
  };

  const runTraceroute = async () => {
    if (tracerouteState === "running") return;
    setTracerouteState("running");
    try {
      await api.traceroute(nodeId);
      tracerouteTimerRef.current = setTimeout(() => {
        setTracerouteState((s) => (s === "running" ? "timeout" : s));
      }, TRACEROUTE_TIMEOUT_MS);
    } catch (err) {
      console.error("Traceroute failed:", err);
      setTracerouteState("error");
    }
  };

  if (notFound) {
    return (
      <div className="p-6">
        <p className="text-th-muted font-mono mb-3">Node not found.</p>
        <Link to="/nodes" className="text-th-accent hover:underline font-mono text-sm">&larr; Back to Nodes</Link>
      </div>
    );
  }

  if (!node) {
    return (
      <div className="p-6">
        <p className="text-th-muted font-mono animate-pulse">loading...</p>
      </div>
    );
  }

  const trackedIds = new Set(node.is_tracked ? [nodeId] : []);
  const mapNodes = node.lat != null && node.lon != null ? [node] : [];
  const trails = trail.length > 1 ? { [nodeId]: trail } : {};

  return (
    <div className="p-4 md:p-6 max-w-5xl mx-auto space-y-4">
      <Link to="/nodes" className="text-th-muted hover:text-th-accent-light transition-colors text-xs font-mono inline-block">
        &larr; Nodes
      </Link>

      <div className="bg-th-surface border border-th-border rounded-lg shadow-lg shadow-black/20 overflow-hidden">
        <div className="px-4 py-3 border-b border-th-border flex items-center justify-between flex-wrap gap-2">
          <div className="flex items-center gap-2">
            <button
              onClick={toggleTracked}
              className="text-lg leading-none hover:scale-110 transition-transform"
              title={node.is_tracked ? "Untrack node" : "Track node"}
            >
              {node.is_tracked ? (
                <svg className="w-5 h-5 text-emerald-400" fill="currentColor" viewBox="0 0 24 24">
                  <path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z" />
                </svg>
              ) : (
                <svg className="w-5 h-5 text-th-faint hover:text-th-dim" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                  <path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z" />
                </svg>
              )}
            </button>
            <div>
              <h1 className="text-lg font-bold text-th-text font-mono">
                {node.long_name || node.short_name || node.node_id}
              </h1>
              <p className="text-xs text-th-muted font-mono">
                {node.node_id}
                {node.hardware_model && ` · ${node.hardware_model}`}
                {node.hops_away != null && ` · ${node.hops_away === 0 ? "direct" : `${node.hops_away} hops`}`}
                {" · heard "}{timeAgo(node.last_heard)}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-1.5 text-xs font-mono text-th-dim">
            <span className={`inline-block w-2.5 h-2.5 rounded-full ${node.is_online ? "bg-emerald-500 animate-pulse-slow" : "bg-th-faint"}`} />
            {node.is_online ? "online" : "offline"}
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2">
          <div className="h-64 md:h-72 border-b md:border-b-0 md:border-r border-th-border">
            {mapNodes.length > 0 ? (
              <Map nodes={mapNodes} trails={trails} trackedIds={trackedIds} geofences={[]} />
            ) : (
              <div className="w-full h-full flex items-center justify-center text-th-muted font-mono text-xs">
                no position data
              </div>
            )}
          </div>
          <div className="p-4 space-y-2 text-sm font-mono">
            <div className="flex items-center justify-between">
              <span className="text-th-muted">Battery</span>
              {node.battery_level != null ? (
                <span className="flex items-center gap-2">
                  {batteryBar(node.battery_level)}
                  {node.voltage != null && <span className="text-th-dim">{node.voltage}V</span>}
                </span>
              ) : <span className="text-th-faint">—</span>}
            </div>
            <div className="flex items-center justify-between">
              <span className="text-th-muted">SNR</span>
              <span className="text-th-dim">{node.snr != null ? `${node.snr} dB` : "—"}</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-th-muted">Altitude</span>
              <span className="text-th-dim">{node.altitude != null ? `${node.altitude} m` : "—"}</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-th-muted">Position</span>
              <span className="text-th-dim text-xs">
                {node.lat != null && node.lon != null ? `${node.lat.toFixed(5)}, ${node.lon.toFixed(5)}` : "—"}
              </span>
            </div>

            <div className="pt-2 flex flex-wrap gap-1 border-t border-th-border">
              {TRAIL_PRESETS.map(({ label, hours }) => (
                <button
                  key={label}
                  onClick={() => setTrailHours(hours)}
                  className={`px-2 py-1 rounded text-xs transition-colors ${
                    trailHours === hours
                      ? "bg-th-accent-bg/50 text-th-accent-light ring-1 ring-th-accent-border"
                      : "bg-th-elevated text-th-dim hover:text-th-text"
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>
        </div>
      </div>

      <div className="bg-th-surface border border-th-border rounded-lg shadow-lg shadow-black/20">
        <div className="px-4 py-2 border-b border-th-border flex items-center justify-between">
          <h2 className="text-sm font-semibold text-th-text font-mono">Messages</h2>
          <button
            onClick={() => navigate(`/?dm=${encodeURIComponent(nodeId)}`)}
            className="text-xs font-mono text-th-muted hover:text-th-accent-light transition-colors"
          >
            Open in Map &#8599;
          </button>
        </div>
        <div className="max-h-72 overflow-y-auto p-3 space-y-2">
          {messages.length === 0 && (
            <p className="text-th-muted text-xs font-mono text-center py-4">no messages yet</p>
          )}
          {messages.map((msg) => (
            <div key={msg.id} className="text-sm">
              <div className="flex items-baseline gap-2">
                <span className="font-medium text-xs text-th-accent">
                  {msg.from_id === myNodeId || msg.from_id === "local" ? "You" : (msg.from_name || msg.from_id)}
                </span>
                <span className="text-th-faint text-xs font-mono">{formatTime(msg.timestamp)}</span>
              </div>
              <p className="text-th-body break-words">{msg.text}</p>
            </div>
          ))}
          <div ref={bottomRef} />
        </div>
        <form onSubmit={sendMessage} className="p-3 border-t border-th-border flex gap-2">
          <input
            type="text"
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder={`DM to ${node.long_name || node.short_name || nodeId}...`}
            maxLength={228}
            className="flex-1 bg-th-elevated border border-th-border-strong text-th-text rounded px-3 py-2 text-sm font-mono focus:border-th-accent focus:outline-none transition-colors duration-150 placeholder:text-th-faint"
          />
          <button
            type="submit"
            disabled={!text.trim() || sending}
            className="border border-th-accent-border text-th-accent-light px-3 py-2 rounded text-sm font-mono hover:bg-th-accent-bg/50 disabled:opacity-50 disabled:cursor-not-allowed transition-colors duration-150"
          >
            Send
          </button>
        </form>
      </div>

      <div className="bg-th-surface border border-th-border rounded-lg shadow-lg shadow-black/20 p-4">
        <div className="flex items-center justify-between mb-2">
          <h2 className="text-sm font-semibold text-th-text font-mono">Traceroute</h2>
          <button
            onClick={runTraceroute}
            disabled={tracerouteState === "running" || !node.is_online}
            className="border border-th-accent-border text-th-accent-light px-3 py-1.5 rounded text-xs font-mono hover:bg-th-accent-bg/50 disabled:opacity-50 disabled:cursor-not-allowed transition-colors duration-150"
          >
            {tracerouteState === "running" ? "Running…" : "Run traceroute"}
          </button>
        </div>
        {tracerouteState === "timeout" && (
          <p className="text-amber-400 text-xs font-mono mb-2">no response — node may be unreachable</p>
        )}
        {tracerouteState === "error" && (
          <p className="text-red-400 text-xs font-mono mb-2">failed to start traceroute</p>
        )}
        {traceroute ? (
          <div className="text-xs font-mono space-y-1">
            <div className="text-th-dim break-all">
              you &rarr; {traceroute.route.map((h) => hopLabel(h)).join(" → ")}
            </div>
            {traceroute.route_back.length > 0 && (
              <div className="text-th-muted break-all">
                back: {traceroute.route_back.map((h) => hopLabel(h)).join(" → ")}
              </div>
            )}
            <div className="text-th-faint">last run {timeAgo(traceroute.timestamp)}</div>
          </div>
        ) : (
          <p className="text-th-muted text-xs font-mono">no traceroute on record</p>
        )}
      </div>
    </div>
  );
}
