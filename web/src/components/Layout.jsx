import { useEffect, useState } from "react";
import { NavLink, Outlet } from "react-router-dom";
import { api } from "../api";
import { useTheme } from "../theme";

const links = [
  { to: "/", label: "Map" },
  { to: "/nodes", label: "Nodes" },
];

export default function Layout() {
  const [health, setHealth] = useState(null);
  const [open, setOpen] = useState(false);
  const [toggling, setToggling] = useState(false);
  const { theme, setTheme } = useTheme();

  useEffect(() => {
    const poll = () => api.health().then(setHealth).catch(() => {});
    poll();
    const id = setInterval(poll, 10000);
    return () => clearInterval(id);
  }, []);

  const closeMenu = () => setOpen(false);

  const toggleConnection = async () => {
    if (toggling) return;
    setToggling(true);
    try {
      if (health?.connected) {
        await api.disconnect();
      } else {
        await api.reconnect();
      }
      await new Promise((r) => setTimeout(r, 500));
      const h = await api.health();
      setHealth(h);
    } catch {}
    setToggling(false);
  };

  const toggleTheme = () => setTheme(theme === "hacker" ? "corporate" : "hacker");

  const navContent = (
    <>
      <h1 className="text-lg font-bold mb-1 text-th-accent font-mono tracking-tight">Meshtastic</h1>
      <p className="text-xs text-th-muted mb-6 font-mono">mesh_network</p>
      <ul className="space-y-0.5 flex-1">
        {links.map((l) => (
          <li key={l.to}>
            <NavLink
              to={l.to}
              end={l.to === "/"}
              onClick={closeMenu}
              className={({ isActive }) =>
                `block py-2 text-sm transition-colors duration-150 ${
                  isActive
                    ? "text-th-accent-light border-l-2 border-th-accent bg-th-accent-bg/30 pl-2.5 pr-3"
                    : "text-th-dim hover:text-th-text pl-3 pr-3"
                }`
              }
            >
              {l.label}
            </NavLink>
          </li>
        ))}
      </ul>
      <div className="border-t border-th-accent-border/30 pt-3 mt-3 space-y-2">
        {/* Theme toggle */}
        <div className="flex items-center gap-1 px-1">
          <button
            onClick={toggleTheme}
            className="flex items-center gap-2 px-2 py-1.5 rounded text-xs font-mono text-th-muted hover:text-th-text transition-colors w-full"
            title={`Switch to ${theme === "hacker" ? "Modern" : "Hacker"} theme`}
          >
            {theme === "hacker" ? (
              <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 3v1m0 16v1m9-9h-1M4 12H3m15.364 6.364l-.707-.707M6.343 6.343l-.707-.707m12.728 0l-.707.707M6.343 17.657l-.707.707M16 12a4 4 0 11-8 0 4 4 0 018 0z" />
              </svg>
            ) : (
              <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" d="M8 9l3 3-3 3m5 0h3M5 20h14a2 2 0 002-2V6a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
              </svg>
            )}
            {theme === "hacker" ? "Modern" : "Hacker"}
          </button>
        </div>
        {/* Connection */}
        <div className="flex items-center gap-2 px-1 py-2">
          <span
            className={`inline-block w-2 h-2 rounded-full ${
              health?.connected ? "bg-emerald-500 animate-pulse-slow" : "bg-red-500"
            }`}
          />
          <span className="text-xs text-th-dim flex-1 font-mono">
            {health?.connected ? "connected" : "disconnected"}
          </span>
          <button
            onClick={toggleConnection}
            disabled={toggling}
            className="text-th-muted hover:text-th-accent-light disabled:opacity-50 transition-colors"
            title={health?.connected ? "Disconnect" : "Reconnect"}
          >
            {health?.connected ? (
              <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" d="M18.364 18.364A9 9 0 005.636 5.636m12.728 12.728L5.636 5.636" />
              </svg>
            ) : (
              <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" d="M13 10V3L4 14h7v7l9-11h-7z" />
              </svg>
            )}
          </button>
        </div>
        {health && (
          <p className="text-xs text-th-muted px-1 font-mono">
            {health.node_count} nodes &middot; {health.message_count} msgs
          </p>
        )}
      </div>
    </>
  );

  return (
    <div className="flex min-h-screen">
      <nav className="hidden md:flex md:w-52 bg-th-surface bg-mesh-grid border-r border-th-accent-border/40 p-4 flex-shrink-0 flex-col">
        {navContent}
      </nav>

      <div className="fixed top-0 left-0 right-0 z-40 md:hidden bg-th-surface border-b border-th-accent-border/40 flex items-center px-4 h-12">
        <button onClick={() => setOpen(!open)} className="mr-3 p-1">
          <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            {open ? (
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            ) : (
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
            )}
          </svg>
        </button>
        <span className="font-bold flex-1 font-mono tracking-tight text-th-accent">Meshtastic</span>
        <button
          onClick={toggleTheme}
          className="mr-2 text-th-dim hover:text-th-accent-light transition-colors"
          title={`Switch to ${theme === "hacker" ? "Modern" : "Hacker"} theme`}
        >
          {theme === "hacker" ? (
            <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 3v1m0 16v1m9-9h-1M4 12H3m15.364 6.364l-.707-.707M6.343 6.343l-.707-.707m12.728 0l-.707.707M6.343 17.657l-.707.707M16 12a4 4 0 11-8 0 4 4 0 018 0z" />
            </svg>
          ) : (
            <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" d="M8 9l3 3-3 3m5 0h3M5 20h14a2 2 0 002-2V6a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
            </svg>
          )}
        </button>
        <button
          onClick={toggleConnection}
          disabled={toggling}
          className="mr-2 text-th-dim hover:text-th-accent-light disabled:opacity-50"
          title={health?.connected ? "Disconnect" : "Reconnect"}
        >
          {health?.connected ? (
            <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" d="M18.364 18.364A9 9 0 005.636 5.636m12.728 12.728L5.636 5.636" />
            </svg>
          ) : (
            <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" d="M13 10V3L4 14h7v7l9-11h-7z" />
            </svg>
          )}
        </button>
        <span
          className={`inline-block w-2 h-2 rounded-full ${
            health?.connected ? "bg-emerald-500 animate-pulse-slow" : "bg-red-500"
          }`}
        />
      </div>

      {open && (
        <>
          <div className="fixed inset-0 z-40 bg-black/50 md:hidden" onClick={closeMenu} />
          <nav className="fixed top-0 left-0 bottom-0 z-50 w-56 bg-th-surface bg-mesh-grid border-r border-th-accent-border/40 p-4 flex flex-col md:hidden">
            {navContent}
          </nav>
        </>
      )}

      <main className="flex-1 bg-th-base overflow-auto pt-12 md:pt-0">
        <Outlet />
      </main>
    </div>
  );
}
