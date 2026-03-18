import { useEffect, useRef, useState } from "react";
import { api, utc } from "../api";

function formatTime(iso) {
  const d = utc(iso);
  if (!d) return "";
  return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

export default function MessagePanel({ messages, onNewMessage }) {
  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);
  const [collapsed, setCollapsed] = useState(false);
  const bottomRef = useRef(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  const send = async (e) => {
    e.preventDefault();
    if (!text.trim() || sending) return;
    setSending(true);
    try {
      await api.sendMessage(text.trim());
      setText("");
    } catch (err) {
      console.error("Send failed:", err);
    } finally {
      setSending(false);
    }
  };

  return (
    <div
      className={`bg-zinc-900 border-l border-zinc-800 flex flex-col transition-all duration-200 ${
        collapsed ? "w-10" : "w-80"
      }`}
    >
      <button
        onClick={() => setCollapsed(!collapsed)}
        className="p-2 text-zinc-400 hover:text-zinc-100 border-b border-zinc-800 flex items-center justify-center"
      >
        {collapsed ? (
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
          </svg>
        ) : (
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
          </svg>
        )}
      </button>

      {!collapsed && (
        <>
          <div className="px-3 py-2 border-b border-zinc-800">
            <h2 className="text-sm font-semibold text-zinc-100">Messages</h2>
            <p className="text-xs text-zinc-500">Channel 0</p>
          </div>

          <div className="flex-1 overflow-y-auto p-3 space-y-2">
            {messages.map((msg) => (
              <div key={msg.id} className="text-sm">
                <div className="flex items-baseline gap-2">
                  <span className="font-medium text-indigo-400 text-xs">
                    {msg.from_name || msg.from_id}
                  </span>
                  <span className="text-zinc-600 text-xs">{formatTime(msg.timestamp)}</span>
                </div>
                <p className="text-zinc-300 break-words">{msg.text}</p>
              </div>
            ))}
            <div ref={bottomRef} />
          </div>

          <form onSubmit={send} className="p-3 border-t border-zinc-800 flex gap-2">
            <input
              type="text"
              value={text}
              onChange={(e) => setText(e.target.value)}
              placeholder="Send message..."
              maxLength={228}
              className="flex-1 bg-zinc-800 border border-zinc-700 text-zinc-100 rounded-lg px-3 py-2 text-sm focus:border-indigo-500 focus:outline-none transition-colors duration-150"
            />
            <button
              type="submit"
              disabled={!text.trim() || sending}
              className="bg-indigo-600 text-white px-3 py-2 rounded-lg text-sm hover:bg-indigo-500 disabled:opacity-50 disabled:cursor-not-allowed transition-colors duration-150"
            >
              Send
            </button>
          </form>
        </>
      )}
    </div>
  );
}
