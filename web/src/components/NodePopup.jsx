import { batteryColor, timeAgo } from "../lib/utils.jsx";

export default function NodePopup({ node }) {
  return (
    <div className="text-sm min-w-[160px]">
      <div className="font-semibold text-th-text font-mono">
        {node.long_name || node.short_name || node.node_id}
      </div>
      {node.short_name && (
        <div className="text-th-dim text-xs">{node.short_name}</div>
      )}
      <div className="mt-2 space-y-1 text-xs font-mono">
        {node.battery_level != null && (
          <div className={batteryColor(node.battery_level)}>
            Battery: {node.battery_level}%
          </div>
        )}
        {node.altitude != null && (
          <div className="text-th-dim">Alt: {node.altitude}m</div>
        )}
        {node.snr != null && (
          <div className="text-th-dim">SNR: {node.snr} dB</div>
        )}
        <div className="text-th-muted">{timeAgo(node.last_heard)}</div>
      </div>
    </div>
  );
}
