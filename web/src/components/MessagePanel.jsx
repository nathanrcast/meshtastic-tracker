import { useEffect, useRef, useState } from "react";
import { api, utc } from "../api";

function formatTime(iso) {
  const d = utc(iso);
  if (!d) return "";
  return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

const HIDDEN_CHANNELS_KEY = "meshtastic-hidden-channels";

function loadHiddenChannels() {
  try {
    return new Set(JSON.parse(localStorage.getItem(HIDDEN_CHANNELS_KEY) || "[]"));
  } catch {
    return new Set();
  }
}

function saveHiddenChannels(set) {
  localStorage.setItem(HIDDEN_CHANNELS_KEY, JSON.stringify([...set]));
}

export default function MessagePanel({ messages, trackedIds, channels = [], selectedChannel = 0, onChannelChange, onMessageSent }) {
  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);
  const [collapsed, setCollapsed] = useState(false);
  const [hiddenChannels, setHiddenChannels] = useState(loadHiddenChannels);
  const bottomRef = useRef(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  const send = async (e) => {
    e.preventDefault();
    if (!text.trim() || sending) return;
    setSending(true);
    try {
      const msg = await api.sendMessage(text.trim(), selectedChannel);
      setText("");
      if (onMessageSent && msg?.id) {
        onMessageSent(msg);
      }
    } catch (err) {
      console.error("Send failed:", err);
    } finally {
      setSending(false);
    }
  };

  const hideChannel = (index) => {
    const next = new Set(hiddenChannels);
    next.add(index);
    setHiddenChannels(next);
    saveHiddenChannels(next);
    if (selectedChannel === index) {
      const visible = channels.filter((ch) => !next.has(ch.index));
      if (visible.length > 0) onChannelChange(visible[0].index);
    }
  };

  const showAllChannels = () => {
    setHiddenChannels(new Set());
    saveHiddenChannels(new Set());
  };

  const visibleChannels = channels.filter((ch) => !hiddenChannels.has(ch.index));
  const hasHidden = hiddenChannels.size > 0;

  return (
    <div
      className={`bg-zinc-800 border-l border-mesh-800/40 flex flex-col transition-all duration-200 ${
        collapsed ? "w-10" : "w-80"
      }`}
    >
      <button
        onClick={() => setCollapsed(!collapsed)}
        className="p-2 text-zinc-400 hover:text-mesh-300 border-b border-zinc-700 flex items-center justify-center"
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
          <div className="px-3 py-2 border-b border-zinc-700">
            <h2 className="text-sm font-semibold text-zinc-100 font-mono">Messages</h2>
            {visibleChannels.length <= 1 && !hasHidden ? (
              <p className="text-xs text-zinc-500 font-mono">{visibleChannels[0]?.name || "primary"}</p>
            ) : (
              <div className="flex flex-wrap gap-1 mt-1">
                {visibleChannels.map((ch) => (
                  <div key={ch.index} className="flex items-center group">
                    <button
                      onClick={() => onChannelChange(ch.index)}
                      className={`px-2 py-0.5 rounded-l text-xs font-mono transition-colors ${
                        selectedChannel === ch.index
                          ? "bg-mesh-950/50 text-mesh-300 ring-1 ring-mesh-700"
                          : "bg-zinc-900 text-zinc-400 hover:text-zinc-200"
                      }`}
                    >
                      {ch.name}
                    </button>
                    <button
                      onClick={() => hideChannel(ch.index)}
                      className={`px-1 py-0.5 rounded-r text-xs transition-colors opacity-0 group-hover:opacity-100 ${
                        selectedChannel === ch.index
                          ? "bg-mesh-950/50 text-zinc-500 hover:text-red-400 ring-1 ring-mesh-700"
                          : "bg-zinc-900 text-zinc-600 hover:text-red-400"
                      }`}
                      title="Hide channel"
                    >
                      ×
                    </button>
                  </div>
                ))}
                {hasHidden && (
                  <button
                    onClick={showAllChannels}
                    className="px-2 py-0.5 rounded text-xs font-mono text-zinc-500 hover:text-mesh-300 transition-colors"
                    title="Show all hidden channels"
                  >
                    +{hiddenChannels.size}
                  </button>
                )}
              </div>
            )}
          </div>

          <div className="flex-1 overflow-y-auto p-3 space-y-2">
            {messages.map((msg) => (
              <div key={msg.id} className="text-sm">
                <div className="flex items-baseline gap-2 flex-wrap">
                  <span className={`font-medium text-xs ${trackedIds?.has(msg.from_id) ? "text-emerald-400" : "text-mesh-400"}`}>
                    {msg.from_name || msg.from_id}
                  </span>
                  <span className="text-zinc-600 text-xs font-mono">{formatTime(msg.timestamp)}</span>
                  {(msg.snr != null || msg.rssi != null) && (
                    <span className="text-zinc-500 text-xs font-mono">
                      {msg.snr != null && `${msg.snr} dB`}
                      {msg.snr != null && msg.rssi != null && " / "}
                      {msg.rssi != null && `${msg.rssi} dBm`}
                    </span>
                  )}
                </div>
                <p className="text-zinc-300 break-words">{msg.text}</p>
              </div>
            ))}
            <div ref={bottomRef} />
          </div>

          <form onSubmit={send} className="p-3 border-t border-mesh-800/30 flex gap-2">
            <input
              type="text"
              value={text}
              onChange={(e) => setText(e.target.value)}
              placeholder="message..."
              maxLength={228}
              className="flex-1 bg-zinc-900 border border-zinc-600 text-zinc-100 rounded px-3 py-2 text-sm font-mono focus:border-mesh-500 focus:outline-none transition-colors duration-150 placeholder:text-zinc-600"
            />
            <button
              type="submit"
              disabled={!text.trim() || sending}
              className="border border-mesh-700 text-mesh-300 px-3 py-2 rounded text-sm font-mono hover:bg-mesh-950/50 disabled:opacity-50 disabled:cursor-not-allowed transition-colors duration-150"
            >
              Send
            </button>
          </form>
        </>
      )}
    </div>
  );
}
