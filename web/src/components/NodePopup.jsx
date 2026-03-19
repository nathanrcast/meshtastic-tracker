import { utc } from "../api";

function batteryColor(level) {
  if (level == null) return "text-zinc-500";
  if (level > 50) return "text-emerald-400";
  if (level > 20) return "text-amber-400";
  return "text-red-400";
}

function timeAgo(iso) {
  const d = utc(iso);
  if (!d) return "never";
  const s = Math.floor((Date.now() - d.getTime()) / 1000);
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
}

export default function NodePopup({ node }) {
  return (
    <div className="text-sm min-w-[160px]">
      <div className="font-semibold text-zinc-100 font-mono">
        {node.long_name || node.short_name || node.node_id}
      </div>
      {node.short_name && (
        <div className="text-zinc-400 text-xs">{node.short_name}</div>
      )}
      <div className="mt-2 space-y-1 text-xs font-mono">
        {node.battery_level != null && (
          <div className={batteryColor(node.battery_level)}>
            Battery: {node.battery_level}%
          </div>
        )}
        {node.altitude != null && (
          <div className="text-zinc-400">Alt: {node.altitude}m</div>
        )}
        {node.snr != null && (
          <div className="text-zinc-400">SNR: {node.snr} dB</div>
        )}
        <div className="text-zinc-500">{timeAgo(node.last_heard)}</div>
      </div>
    </div>
  );
}
