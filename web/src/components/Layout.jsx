import { useEffect, useState } from "react";
import { NavLink, Outlet } from "react-router-dom";
import { api } from "../api";

const links = [
  { to: "/", label: "Map" },
  { to: "/nodes", label: "Nodes" },
];

export default function Layout() {
  const [health, setHealth] = useState(null);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const poll = () => api.health().then(setHealth).catch(() => {});
    poll();
    const id = setInterval(poll, 10000);
    return () => clearInterval(id);
  }, []);

  const closeMenu = () => setOpen(false);

  const navContent = (
    <>
      <h1 className="text-lg font-bold mb-1 text-zinc-100">Meshtastic</h1>
      <p className="text-xs text-zinc-500 mb-6">Mesh Network</p>
      <ul className="space-y-1 flex-1">
        {links.map((l) => (
          <li key={l.to}>
            <NavLink
              to={l.to}
              end={l.to === "/"}
              onClick={closeMenu}
              className={({ isActive }) =>
                `block px-3 py-2 rounded-lg text-sm transition-colors duration-150 ${
                  isActive
                    ? "bg-indigo-600 text-white"
                    : "text-zinc-300 hover:bg-zinc-800"
                }`
              }
            >
              {l.label}
            </NavLink>
          </li>
        ))}
      </ul>
      <div className="border-t border-zinc-800 pt-3 mt-3">
        <div className="flex items-center gap-2 px-3 py-2">
          <span
            className={`inline-block w-2 h-2 rounded-full ${
              health?.connected ? "bg-emerald-500" : "bg-red-500"
            }`}
          />
          <span className="text-xs text-zinc-400">
            {health?.connected ? "Connected" : "Disconnected"}
          </span>
        </div>
        {health && (
          <p className="text-xs text-zinc-500 px-3">
            {health.node_count} nodes &middot; {health.message_count} msgs
          </p>
        )}
      </div>
    </>
  );

  return (
    <div className="flex min-h-screen">
      <nav className="hidden md:flex md:w-56 bg-zinc-900 border-r border-zinc-800 text-zinc-100 p-4 flex-shrink-0 flex-col">
        {navContent}
      </nav>

      <div className="fixed top-0 left-0 right-0 z-40 md:hidden bg-zinc-900 border-b border-zinc-800 text-zinc-100 flex items-center px-4 h-12">
        <button onClick={() => setOpen(!open)} className="mr-3 p-1">
          <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            {open ? (
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            ) : (
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
            )}
          </svg>
        </button>
        <span className="font-bold flex-1">Meshtastic</span>
        <span
          className={`inline-block w-2 h-2 rounded-full ${
            health?.connected ? "bg-emerald-500" : "bg-red-500"
          }`}
        />
      </div>

      {open && (
        <>
          <div className="fixed inset-0 z-40 bg-black/50 md:hidden" onClick={closeMenu} />
          <nav className="fixed top-0 left-0 bottom-0 z-50 w-64 bg-zinc-900 border-r border-zinc-800 text-zinc-100 p-4 flex flex-col md:hidden">
            {navContent}
          </nav>
        </>
      )}

      <main className="flex-1 bg-zinc-950 overflow-auto pt-12 md:pt-0">
        <Outlet />
      </main>
    </div>
  );
}
