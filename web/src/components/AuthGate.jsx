import { useEffect, useState } from "react";
import { api } from "../api";

export default function AuthGate({ children }) {
  const [state, setState] = useState("checking");
  const [error, setError] = useState("");
  const [input, setInput] = useState("");

  useEffect(() => {
    api.health().then((h) => {
      if (!h.auth_required) {
        setState("ok");
      } else if (api.getKey()) {
        api.nodes().then(() => setState("ok")).catch(() => setState("prompt"));
      } else {
        setState("prompt");
      }
    }).catch(() => setState("ok"));
  }, []);

  useEffect(() => {
    const handler = () => {
      api.setKey("");
      setState("prompt");
    };
    window.addEventListener("meshtastic-auth-required", handler);
    return () => window.removeEventListener("meshtastic-auth-required", handler);
  }, []);

  const submit = async (e) => {
    e.preventDefault();
    setError("");
    api.setKey(input.trim());
    try {
      await api.nodes();
      setState("ok");
    } catch {
      api.setKey("");
      setError("Invalid API key");
    }
  };

  if (state === "checking") {
    return (
      <div className="min-h-screen bg-th-base flex items-center justify-center">
        <div className="text-th-muted font-mono text-sm animate-pulse">connecting...</div>
      </div>
    );
  }

  if (state === "ok") return children;

  return (
    <div className="min-h-screen bg-th-base bg-mesh-grid flex items-center justify-center p-4">
      <form onSubmit={submit} className="bg-th-surface border border-th-border-strong rounded-lg p-6 w-80 shadow-lg">
        <h2 className="text-th-accent font-mono font-bold text-lg mb-1">Meshtastic</h2>
        <p className="text-th-muted font-mono text-xs mb-5">api_key_required</p>
        <input
          type="password"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="Enter API key"
          className="w-full px-3 py-2 bg-th-base border border-th-border rounded text-th-text font-mono text-sm mb-3 focus:outline-none focus:border-th-accent"
          autoFocus
        />
        {error && <p className="text-red-400 text-xs mb-3 font-mono">{error}</p>}
        <button
          type="submit"
          className="w-full py-2 bg-th-accent text-white rounded font-mono text-sm hover:opacity-90 transition-opacity"
        >
          Authenticate
        </button>
      </form>
    </div>
  );
}
