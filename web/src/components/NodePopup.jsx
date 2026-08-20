import { Link } from "react-router-dom";
import { batteryColor, timeAgo } from "../lib/utils.jsx";

export default function NodePopup({ node, onOpenDM }) {
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
      <div className="mt-2 flex gap-1.5">
        <Link
          to={`/nodes/${encodeURIComponent(node.node_id)}`}
          className="flex-1 text-center px-2 py-1 text-xs rounded border border-th-accent-border text-th-accent-light hover:bg-th-accent-bg/50 transition-colors"
        >
          Details
        </Link>
        {onOpenDM && (
          <button
            onClick={() => onOpenDM(node.node_id)}
            className="flex-1 px-2 py-1 text-xs rounded border border-violet-600/50 text-violet-400 hover:bg-violet-900/30 hover:text-violet-300 transition-colors cursor-pointer"
          >
            Message
          </button>
        )}
      </div>
    </div>
  );
}
