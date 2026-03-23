import { useState } from "react";
import { api } from "../api";

export default function GeofencePanel({ geofences, onUpdate }) {
  const [open, setOpen] = useState(false);
  const [placing, setPlacing] = useState(false);
  const [pending, setPending] = useState(null);
  const [form, setForm] = useState({ name: "", radius: "500" });

  const startPlacing = () => {
    setPlacing(true);
    setPending(null);
  };

  const cancelPlacing = () => {
    setPlacing(false);
    setPending(null);
  };

  const onMapClick = placing
    ? (coords) => {
        setPending(coords);
        setPlacing(false);
      }
    : null;

  const submitFence = async (e) => {
    e.preventDefault();
    if (!pending) return;
    const radius = parseInt(form.radius, 10);
    if (!form.name.trim() || isNaN(radius) || radius < 50) return;
    try {
      await api.createGeofence(form.name.trim(), pending.lat, pending.lon, radius);
      setPending(null);
      setForm({ name: "", radius: "500" });
      onUpdate();
    } catch (err) {
      console.error("Failed to create geofence:", err);
    }
  };

  const toggleEnabled = async (fence) => {
    try {
      await api.updateGeofence(fence.id, { enabled: !fence.enabled });
      onUpdate();
    } catch (err) {
      console.error("Failed to toggle geofence:", err);
    }
  };

  const deleteFence = async (fence) => {
    try {
      await api.deleteGeofence(fence.id);
      onUpdate();
    } catch (err) {
      console.error("Failed to delete geofence:", err);
    }
  };

  return {
    onMapClick,
    panel: (
      <div className="bg-th-surface/90 backdrop-blur border border-th-border-strong rounded-md shadow-lg font-mono text-xs">
        <button
          onClick={() => setOpen((o) => !o)}
          className="flex items-center gap-1.5 px-3 py-1.5 text-amber-400 hover:text-amber-300 transition-colors w-full"
        >
          <span className={`transition-transform ${open ? "rotate-90" : ""}`}>&#9654;</span>
          Geofences ({geofences.filter((f) => f.enabled).length}/{geofences.length})
        </button>

        {open && (
          <div className="border-t border-th-border px-2 py-2 space-y-2">
            {geofences.map((f) => (
              <div key={f.id} className="flex items-center gap-2">
                <button
                  onClick={() => toggleEnabled(f)}
                  className={`w-2.5 h-2.5 rounded-full flex-shrink-0 transition-opacity ${
                    f.enabled ? "bg-amber-400" : "bg-zinc-600"
                  }`}
                  title={f.enabled ? "Disable" : "Enable"}
                />
                <span className={`flex-1 truncate ${f.enabled ? "text-th-dim" : "text-th-muted line-through opacity-50"}`}>
                  {f.name}
                  <span className="text-th-muted ml-1">({f.radius_m}m)</span>
                </span>
                <button
                  onClick={() => deleteFence(f)}
                  className="text-th-muted hover:text-red-400 transition-colors text-[10px]"
                  title="Delete"
                >
                  &times;
                </button>
              </div>
            ))}

            {placing && (
              <div className="text-amber-300 text-center py-2 animate-pulse">
                Click the map to place geofence center
              </div>
            )}

            {pending && (
              <form onSubmit={submitFence} className="space-y-1.5 pt-1 border-t border-th-border">
                <div className="text-th-muted">
                  {pending.lat.toFixed(5)}, {pending.lon.toFixed(5)}
                </div>
                <input
                  type="text"
                  value={form.name}
                  onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                  placeholder="Fence name"
                  className="w-full px-2 py-1 bg-th-base border border-th-border rounded text-th-text text-xs focus:outline-none focus:border-th-accent"
                  autoFocus
                  maxLength={100}
                />
                <div className="flex gap-1.5">
                  <input
                    type="number"
                    value={form.radius}
                    onChange={(e) => setForm((f) => ({ ...f, radius: e.target.value }))}
                    placeholder="Radius (m)"
                    className="flex-1 px-2 py-1 bg-th-base border border-th-border rounded text-th-text text-xs focus:outline-none focus:border-th-accent"
                    min={50}
                    max={100000}
                  />
                  <span className="text-th-muted self-center">m</span>
                </div>
                <div className="flex gap-1.5">
                  <button
                    type="submit"
                    className="flex-1 py-1 bg-amber-600 text-white rounded text-xs hover:bg-amber-500 transition-colors"
                  >
                    Create
                  </button>
                  <button
                    type="button"
                    onClick={() => setPending(null)}
                    className="flex-1 py-1 bg-th-base border border-th-border text-th-dim rounded text-xs hover:text-th-text transition-colors"
                  >
                    Cancel
                  </button>
                </div>
              </form>
            )}

            {!placing && !pending && (
              <button
                onClick={startPlacing}
                className="w-full py-1.5 text-center border border-dashed border-amber-600/50 text-amber-400 rounded hover:border-amber-500 hover:text-amber-300 transition-colors"
              >
                + Add Geofence
              </button>
            )}

            {placing && (
              <button
                onClick={cancelPlacing}
                className="w-full py-1 text-center text-th-muted hover:text-th-text transition-colors"
              >
                Cancel
              </button>
            )}
          </div>
        )}
      </div>
    ),
  };
}
