import { useCallback, useEffect, useMemo, useState } from "react";
import { api, utc, useWebSocket } from "../api";

function timeAgo(iso) {
  const d = utc(iso);
  if (!d) return "never";
  const s = Math.floor((Date.now() - d.getTime()) / 1000);
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
}

function batteryBar(level) {
  if (level == null) return null;
  let color = "bg-emerald-500";
  if (level <= 20) color = "bg-red-500";
  else if (level <= 50) color = "bg-amber-500";

  return (
    <div className="flex items-center gap-2">
      <div className="w-16 h-2 bg-zinc-700 rounded-full overflow-hidden">
        <div className={`h-full ${color} rounded-full`} style={{ width: `${level}%` }} />
      </div>
      <span className="text-xs text-zinc-400 font-mono">{level}%</span>
    </div>
  );
}

export default function Nodes() {
  const [nodes, setNodes] = useState([]);
  const [filter, setFilter] = useState("all");
  const [sortKey, setSortKey] = useState("status");
  const [sortDir, setSortDir] = useState("desc");
  const [, setTick] = useState(0);

  useEffect(() => {
    api.nodes().then(setNodes).catch(console.error);
  }, []);

  // Refresh time-ago displays
  useEffect(() => {
    const id = setInterval(() => setTick((t) => t + 1), 30000);
    return () => clearInterval(id);
  }, []);

  const handleEvent = useCallback((event) => {
    if (event.type === "position") {
      setNodes((prev) =>
        prev.map((n) =>
          n.node_id === event.node_id
            ? { ...n, lat: event.lat, lon: event.lon, altitude: event.altitude, is_online: true, last_heard: new Date().toISOString() }
            : n
        )
      );
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
  const filtered = filter === "tracked" ? nodes.filter((n) => n.is_tracked) : nodes;

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

  return (
    <div className="p-4 md:p-6">
      <div className="flex items-center justify-between mb-4">
        <h1 className="text-xl font-bold text-mesh-400 font-mono tracking-tight">Nodes</h1>
        <div className="flex bg-zinc-800 rounded-md p-0.5 text-sm font-mono border border-zinc-700">
          <button
            onClick={() => setFilter("all")}
            className={`px-3 py-1 rounded transition-colors ${
              filter === "all"
                ? "bg-mesh-950/50 text-mesh-300 ring-1 ring-mesh-700"
                : "text-zinc-400 hover:text-zinc-200"
            }`}
          >
            All ({nodes.length})
          </button>
          <button
            onClick={() => setFilter("tracked")}
            className={`px-3 py-1 rounded transition-colors ${
              filter === "tracked"
                ? "bg-emerald-900/50 text-emerald-300 ring-1 ring-emerald-700"
                : "text-zinc-400 hover:text-zinc-200"
            }`}
          >
            Tracked ({trackedCount})
          </button>
        </div>
      </div>
      <div className="bg-zinc-800 border border-zinc-700 rounded-lg overflow-hidden shadow-lg shadow-black/20">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-mesh-800/40 text-left text-zinc-400 font-mono text-xs">
              <th className="px-3 py-3 font-medium w-10"></th>
              {[
                { key: "status", label: "STATUS", className: "" },
                { key: "name", label: "NAME", className: "" },
                { key: "hardware", label: "HARDWARE", className: "hidden sm:table-cell" },
                { key: "battery", label: "BATTERY", className: "hidden md:table-cell" },
                { key: "snr", label: "SNR", className: "hidden md:table-cell" },
                { key: "position", label: "POSITION", className: "hidden lg:table-cell" },
                { key: "last_heard", label: "LAST HEARD", className: "" },
              ].map((col) => (
                <th
                  key={col.key}
                  onClick={() => handleSort(col.key)}
                  className={`px-4 py-3 font-medium cursor-pointer select-none hover:text-mesh-300 transition-colors ${col.className}`}
                >
                  {col.label}
                  {sortKey === col.key && (
                    <span className="ml-1 text-mesh-400">{sortDir === "desc" ? "▼" : "▲"}</span>
                  )}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="stagger-children">
            {displayNodes.map((node) => (
              <tr key={node.node_id} className="border-b border-zinc-700/50 hover:bg-zinc-700/20">
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
                      <svg className="w-5 h-5 text-zinc-600 hover:text-zinc-400" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                        <path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z" />
                      </svg>
                    )}
                  </button>
                </td>
                <td className="px-4 py-3">
                  <span
                    className={`inline-block w-2.5 h-2.5 rounded-full ${
                      node.is_online ? "bg-emerald-500 animate-pulse-slow" : "bg-zinc-600"
                    }`}
                  />
                </td>
                <td className="px-4 py-3">
                  <div className="text-zinc-100 font-medium">
                    {node.long_name || node.node_id}
                  </div>
                  {node.short_name && (
                    <div className="text-xs text-zinc-500">{node.short_name}</div>
                  )}
                </td>
                <td className="px-4 py-3 text-zinc-400 hidden sm:table-cell">
                  {node.hardware_model || "—"}
                </td>
                <td className="px-4 py-3 hidden md:table-cell">
                  {batteryBar(node.battery_level) || <span className="text-zinc-600">—</span>}
                </td>
                <td className="px-4 py-3 text-zinc-400 hidden md:table-cell font-mono">
                  {node.snr != null ? `${node.snr} dB` : "—"}
                </td>
                <td className="px-4 py-3 text-zinc-400 text-xs hidden lg:table-cell font-mono">
                  {node.lat != null && node.lon != null
                    ? `${node.lat.toFixed(4)}, ${node.lon.toFixed(4)}`
                    : "—"}
                </td>
                <td className="px-4 py-3 text-zinc-500 text-xs font-mono">
                  {timeAgo(node.last_heard)}
                </td>
              </tr>
            ))}
            {displayNodes.length === 0 && (
              <tr>
                <td colSpan={8} className="px-4 py-8 text-center text-zinc-500 font-mono">
                  {filter === "tracked" ? "no tracked nodes — star nodes to track them" : "no nodes discovered yet"}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
