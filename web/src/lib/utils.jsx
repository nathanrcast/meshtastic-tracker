// Shared frontend utilities extracted to avoid duplication.

export function utc(iso) {
  if (!iso) return null;
  if (!iso.endsWith("Z") && !iso.includes("+")) return new Date(iso + "Z");
  return new Date(iso);
}

export function timeAgo(iso) {
  const d = utc(iso);
  if (!d) return "never";
  const s = Math.floor((Date.now() - d.getTime()) / 1000);
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
}

export function batteryColor(level) {
  if (level == null) return "text-th-muted";
  if (level > 50) return "text-emerald-400";
  if (level > 20) return "text-amber-400";
  return "text-red-400";
}

export function batteryBar(level) {
  if (level == null) return null;
  let color = "bg-emerald-500";
  if (level <= 20) color = "bg-red-500";
  else if (level <= 50) color = "bg-amber-500";

  return (
    <div className="flex items-center gap-2">
      <div className="w-16 h-2 bg-th-border rounded-full overflow-hidden">
        <div className={`h-full ${color} rounded-full`} style={{ width: `${level}%` }} />
      </div>
      <span className="text-xs text-th-dim font-mono">{level}%</span>
    </div>
  );
}
