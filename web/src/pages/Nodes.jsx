import { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { api, utc, useWebSocket } from "../api";
import { batteryBar, timeAgo } from "../lib/utils.jsx";
import usePersistedState from "../hooks/usePersistedState";

export default function Nodes() {
  const navigate = useNavigate();
  const [nodes, setNodes] = useState([]);
  const [filter, setFilter] = usePersistedState("nodes-filter", "all");
  const [sortKey, setSortKey] = useState("status");
  const [sortDir, setSortDir] = useState("desc");
  const [, setTick] = useState(0);

  useEffect(() => {
    api.nodes().then(setNodes).catch(console.error);
  }, []);

  useEffect(() => {
    const id = setInterval(() => setTick((t) => t + 1), 30000);
    return () => clearInterval(id);
  }, []);

  const handleEvent = useCallback((event) => {
    if (event.type === "position") {
      setNodes((prev) =>
        prev.map((n) =>
          n.node_id === event.node_id
            ? {
                ...n,
                lat: event.lat,
                lon: event.lon,
                altitude: event.altitude,
                hops_away: event.hops_away ?? n.hops_away,
                is_online: true,
                last_heard: new Date().toISOString(),
              }
            : n
        )
      );
    } else if (event.type === "node_update") {
      setNodes((prev) => {
        const exists = prev.some((n) => n.node_id === event.node_id);
        if (exists) {
          return prev.map((n) =>
            n.node_id === event.node_id
              ? {
                  ...n,
                  long_name: event.long_name,
                  short_name: event.short_name,
                  hops_away: event.hops_away ?? n.hops_away,
                }
              : n
          );
        }
        return [...prev, {
          node_id: event.node_id,
          long_name: event.long_name,
          short_name: event.short_name,
          hardware_model: "",
          battery_level: null,
          snr: null,
          lat: null,
          lon: null,
          altitude: null,
          hops_away: event.hops_away ?? null,
          last_heard: new Date().toISOString(),
          is_online: true,
          is_tracked: false,
        }];
      });
    }
  }, []);

  useWebSocket(handleEvent);

  const toggleTracked = async (node) => {
    const newVal = !node.is_tracked;
    setNodes((prev) =>
      prev.map((n) => (n.node_id === node.node_id ? { ...n, is_tracked: newVal } : n))
    );
    try {
      await api.setTracked(node.node_id, newVal);
    } catch {
      setNodes((prev) =>
        prev.map((n) => (n.node_id === node.node_id ? { ...n, is_tracked: !newVal } : n))
      );
    }
  };

  const trackedCount = nodes.filter((n) => n.is_tracked).length;
  const onlineCount = nodes.filter((n) => n.is_online).length;
  const filtered =
    filter === "tracked" ? nodes.filter((n) => n.is_tracked)
    : filter === "online" ? nodes.filter((n) => n.is_online)
    : nodes;

  const handleSort = (key) => {
    if (sortKey === key) {
      setSortDir((d) => (d === "desc" ? "asc" : "desc"));
    } else {
      setSortKey(key);
      setSortDir("desc");
    }
  };

  const displayNodes = useMemo(() => {
    const cmp = (a, b) => {
      const dir = sortDir === "desc" ? -1 : 1;
      switch (sortKey) {
        case "status": {
          const av = a.is_online ? 1 : 0;
          const bv = b.is_online ? 1 : 0;
          return (av - bv) * dir;
        }
        case "name": {
          const an = (a.long_name || a.node_id).toLowerCase();
          const bn = (b.long_name || b.node_id).toLowerCase();
          return an < bn ? dir : an > bn ? -dir : 0;
        }
        case "hardware": {
          const ah = (a.hardware_model || "").toLowerCase();
          const bh = (b.hardware_model || "").toLowerCase();
          return ah < bh ? dir : ah > bh ? -dir : 0;
        }
        case "hops": {
          const an = a.hops_away;
          const bn = b.hops_away;
          if (an == null && bn == null) return 0;
          if (an == null) return 1;
          if (bn == null) return -1;
          return (an - bn) * dir;
        }
        case "battery": {
          const an = a.battery_level;
          const bn = b.battery_level;
          if (an == null && bn == null) return 0;
          if (an == null) return 1;
          if (bn == null) return -1;
          return (an - bn) * dir;
        }
        case "snr": {
          const an = a.snr;
          const bn = b.snr;
          if (an == null && bn == null) return 0;
          if (an == null) return 1;
          if (bn == null) return -1;
          return (an - bn) * dir;
        }
        case "position": {
          const ap = a.lat != null && a.lon != null ? 1 : 0;
          const bp = b.lat != null && b.lon != null ? 1 : 0;
          if (ap !== bp) return (ap - bp) * dir;
          if (ap && bp) return ((a.lat || 0) - (b.lat || 0)) * dir;
          return 0;
        }
        case "last_heard": {
          const at = a.last_heard ? new Date(a.last_heard).getTime() : 0;
          const bt = b.last_heard ? new Date(b.last_heard).getTime() : 0;
          if (!at && !bt) return 0;
          if (!at) return 1;
          if (!bt) return -1;
          return (at - bt) * dir;
        }
        default:
          return 0;
      }
    };
    return [...filtered].sort(cmp);
  }, [filtered, sortKey, sortDir]);

  const emptyMessage =
    filter === "tracked" ? "no tracked nodes — star nodes to track them"
    : filter === "online" ? "no nodes online right now"
    : "no nodes discovered yet";

  return (
    <div className="p-4 md:p-6">
      <div className="flex items-center justify-between mb-4">
        <h1 className="text-xl font-bold text-th-accent font-mono tracking-tight">Nodes</h1>
        <div className="flex bg-th-surface rounded-md p-0.5 text-sm font-mono border border-th-border">
          <button
            onClick={() => setFilter("all")}
            className={`px-3 py-1 rounded transition-colors ${
              filter === "all"
                ? "bg-th-accent-bg/50 text-th-accent-light ring-1 ring-th-accent-border"
                : "text-th-dim hover:text-th-text"
            }`}
          >
            All ({nodes.length})
          </button>
          <button
            onClick={() => setFilter("online")}
            className={`px-3 py-1 rounded transition-colors ${
              filter === "online"
                ? "bg-th-accent-bg/50 text-th-accent-light ring-1 ring-th-accent-border"
                : "text-th-dim hover:text-th-text"
            }`}
          >
            Online ({onlineCount})
          </button>
          <button
            onClick={() => setFilter("tracked")}
            className={`px-3 py-1 rounded transition-colors ${
              filter === "tracked"
                ? "bg-emerald-900/50 text-emerald-300 ring-1 ring-emerald-700"
                : "text-th-dim hover:text-th-text"
            }`}
          >
            Tracked ({trackedCount})
          </button>
        </div>
      </div>
      <div className="bg-th-surface border border-th-border rounded-lg overflow-hidden shadow-lg shadow-black/20">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-th-accent-border/40 text-left text-th-dim font-mono text-xs">
              <th className="px-3 py-3 font-medium w-10"></th>
              {[
                { key: "status", label: "STATUS", className: "" },
                { key: "name", label: "NAME", className: "" },
                { key: "hardware", label: "HARDWARE", className: "hidden sm:table-cell" },
                { key: "hops", label: "HOPS", className: "hidden sm:table-cell" },
                { key: "battery", label: "BATTERY", className: "hidden md:table-cell" },
                { key: "snr", label: "SNR", className: "hidden md:table-cell" },
                { key: "position", label: "POSITION", className: "hidden lg:table-cell" },
                { key: "last_heard", label: "LAST HEARD", className: "" },
              ].map((col) => (
                <th
                  key={col.key}
                  onClick={() => handleSort(col.key)}
                  className={`px-4 py-3 font-medium cursor-pointer select-none hover:text-th-accent-light transition-colors ${col.className}`}
                >
                  {col.label}
                  {sortKey === col.key && (
                    <span className="ml-1 text-th-accent">{sortDir === "desc" ? "▼" : "▲"}</span>
                  )}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="stagger-children">
            {displayNodes.map((node) => (
              <tr key={node.node_id} className="border-b border-th-border/50 hover:bg-th-hover/20">
                <td className="px-3 py-3">
                  <button
                    onClick={() => toggleTracked(node)}
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
                </td>
                <td className="px-4 py-3">
                  <span
                    className={`inline-block w-2.5 h-2.5 rounded-full ${
                      node.is_online ? "bg-emerald-500 animate-pulse-slow" : "bg-th-faint"
                    }`}
                  />
                </td>
                <td className="px-4 py-3">
                  <button
                    onClick={() => navigate(`/nodes/${encodeURIComponent(node.node_id)}`)}
                    className="text-left hover:underline"
                    title={`View ${node.long_name || node.node_id}`}
                  >
                    <div className="text-th-text font-medium">
                      {node.long_name || node.node_id}
                    </div>
                    {node.short_name && (
                      <div className="text-xs text-th-muted">{node.short_name}</div>
                    )}
                  </button>
                </td>
                <td className="px-4 py-3 text-th-dim hidden sm:table-cell">
                  {node.hardware_model || "—"}
                </td>
                <td className="px-4 py-3 text-th-dim hidden sm:table-cell font-mono">
                  {node.hops_away == null ? "—" : node.hops_away === 0 ? "direct" : node.hops_away}
                </td>
                <td className="px-4 py-3 hidden md:table-cell">
                  {batteryBar(node.battery_level) || <span className="text-th-faint">—</span>}
                </td>
                <td className="px-4 py-3 text-th-dim hidden md:table-cell font-mono">
                  {node.snr != null ? `${node.snr} dB` : "—"}
                </td>
                <td className="px-4 py-3 text-th-dim text-xs hidden lg:table-cell font-mono">
                  {node.lat != null && node.lon != null
                    ? `${node.lat.toFixed(4)}, ${node.lon.toFixed(4)}`
                    : "—"}
                </td>
                <td className="px-4 py-3 text-th-muted text-xs font-mono">
                  {timeAgo(node.last_heard)}
                </td>
              </tr>
            ))}
            {displayNodes.length === 0 && (
              <tr>
                <td colSpan={9} className="px-4 py-8 text-center text-th-muted font-mono">
                  {emptyMessage}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
