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

const EMOJI_GROUPS = [
  { label: "Smileys", emojis: ["😀", "😂", "🤣", "😊", "😎", "🤔", "😅", "😢", "😡", "🥳", "😴", "🤯"] },
  { label: "Hands", emojis: ["👍", "👎", "👋", "🤝", "✌️", "🤙", "👏", "🙏", "💪", "🫡", "✋", "🤞"] },
  { label: "Symbols", emojis: ["❤️", "🔥", "⚡", "✅", "❌", "⚠️", "📍", "🎯", "💬", "📡", "🛰️", "📻"] },
  { label: "Nature", emojis: ["🌧️", "☀️", "🌙", "⛰️", "🌊", "🏕️", "🌲", "🐻", "🦌", "🐍", "🦅", "🐺"] },
];

const QUICK_EMOJIS = ["👍", "❤️", "😂", "👎", "🔥", "👋"];

export default function MessagePanel({ messages, trackedIds, channels = [], selectedChannel = 0, onChannelChange, onMessageSent, onReact }) {
  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);
  const [collapsed, setCollapsed] = useState(false);
  const [hiddenChannels, setHiddenChannels] = useState(loadHiddenChannels);
  const [showEmoji, setShowEmoji] = useState(false);
  const [hoveredMsgId, setHoveredMsgId] = useState(null);
  const bottomRef = useRef(null);
  const inputRef = useRef(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  const send = async (e) => {
    e.preventDefault();
    const msg = text.trim();
    if (!msg || sending) return;

    setText("");
    setSending(true);
    setShowEmoji(false);

    const optimistic = {
      id: `pending-${Date.now()}`,
      from_id: "local",
      from_name: "You",
      to_id: "^all",
      channel: selectedChannel,
      text: msg,
      snr: null,
      rssi: null,
      timestamp: new Date().toISOString(),
    };
    if (onMessageSent) onMessageSent(optimistic);

    try {
      const real = await api.sendMessage(msg, selectedChannel);
      if (onMessageSent && real?.id) {
        onMessageSent(real);
      }
    } catch (err) {
      console.error("Send failed:", err);
    } finally {
      setSending(false);
    }
  };

  const insertEmoji = (emoji) => {
    const input = inputRef.current;
    if (!input) {
      setText((prev) => prev + emoji);
      return;
    }
    const start = input.selectionStart ?? text.length;
    const end = input.selectionEnd ?? text.length;
    const next = text.slice(0, start) + emoji + text.slice(end);
    setText(next);
    requestAnimationFrame(() => {
      const pos = start + emoji.length;
      input.setSelectionRange(pos, pos);
      input.focus();
    });
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
      className={`bg-th-surface border-l border-th-accent-border/40 flex flex-col transition-all duration-200 ${
        collapsed ? "w-10" : "w-80"
      }`}
    >
      <button
        onClick={() => setCollapsed(!collapsed)}
        className="p-2 text-th-dim hover:text-th-accent-light border-b border-th-border flex items-center justify-center"
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
          <div className="px-3 py-2 border-b border-th-border">
            <h2 className="text-sm font-semibold text-th-text font-mono">Messages</h2>
            {visibleChannels.length <= 1 && !hasHidden ? (
              <p className="text-xs text-th-muted font-mono">{visibleChannels[0]?.name || "primary"}</p>
            ) : (
              <div className="flex flex-wrap gap-1 mt-1">
                {visibleChannels.map((ch) => (
                  <div key={ch.index} className="flex items-center group">
                    <button
                      onClick={() => onChannelChange(ch.index)}
                      className={`px-2 py-0.5 rounded-l text-xs font-mono transition-colors ${
                        selectedChannel === ch.index
                          ? "bg-th-accent-bg/50 text-th-accent-light ring-1 ring-th-accent-border"
                          : "bg-th-elevated text-th-dim hover:text-th-text"
                      }`}
                    >
                      {ch.name}
                    </button>
                    <button
                      onClick={() => hideChannel(ch.index)}
                      className={`px-1 py-0.5 rounded-r text-xs transition-colors opacity-0 group-hover:opacity-100 ${
                        selectedChannel === ch.index
                          ? "bg-th-accent-bg/50 text-th-muted hover:text-red-400 ring-1 ring-th-accent-border"
                          : "bg-th-elevated text-th-faint hover:text-red-400"
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
                    className="px-2 py-0.5 rounded text-xs font-mono text-th-muted hover:text-th-accent-light transition-colors"
                    title="Show all hidden channels"
                  >
                    +{hiddenChannels.size}
                  </button>
                )}
              </div>
            )}
          </div>

          <div className="flex-1 overflow-y-auto p-3 space-y-2">
            {messages.map((msg) => {
              const grouped = {};
              if (msg.reactions) {
                for (const r of msg.reactions) {
                  grouped[r.emoji] = (grouped[r.emoji] || 0) + 1;
                }
              }
              const hasReactions = Object.keys(grouped).length > 0;
              return (
                <div
                  key={msg.id}
                  className="text-sm relative group"
                  onMouseEnter={() => setHoveredMsgId(msg.id)}
                  onMouseLeave={() => setHoveredMsgId(null)}
                >
                  <div className="flex items-baseline gap-2 flex-wrap">
                    <span className={`font-medium text-xs ${trackedIds?.has(msg.from_id) ? "text-emerald-400" : "text-th-accent"}`}>
                      {msg.from_name || msg.from_id}
                    </span>
                    <span className="text-th-faint text-xs font-mono">{formatTime(msg.timestamp)}</span>
                    {(msg.snr != null || msg.rssi != null) && (
                      <span className="text-th-muted text-xs font-mono">
                        {msg.snr != null && `${msg.snr} dB`}
                        {msg.snr != null && msg.rssi != null && " / "}
                        {msg.rssi != null && `${msg.rssi} dBm`}
                      </span>
                    )}
                  </div>
                  <p className="text-th-body break-words">{msg.text}</p>
                  {hasReactions && (
                    <div className="flex flex-wrap gap-1 mt-1">
                      {Object.entries(grouped).map(([emoji, count]) => (
                        <button
                          key={emoji}
                          onClick={() => msg.packet_id && onReact?.(msg.packet_id, emoji, msg.channel)}
                          className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded-full text-xs bg-th-elevated border border-th-border hover:border-th-accent-border transition-colors"
                          title={`React with ${emoji}`}
                        >
                          <span>{emoji}</span>
                          <span className="text-th-muted font-mono">{count}</span>
                        </button>
                      ))}
                    </div>
                  )}
                  {msg.packet_id && hoveredMsgId === msg.id && (
                    <div className="absolute right-0 top-0 flex gap-0.5 bg-th-surface border border-th-border rounded shadow-lg p-0.5 z-10">
                      {QUICK_EMOJIS.map((emoji) => (
                        <button
                          key={emoji}
                          onClick={() => onReact?.(msg.packet_id, emoji, msg.channel)}
                          className="w-6 h-6 flex items-center justify-center rounded hover:bg-th-hover transition-colors text-sm"
                          title={emoji}
                        >
                          {emoji}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              );
            })}
            <div ref={bottomRef} />
          </div>

          {showEmoji && (
            <div className="border-t border-th-border px-2 py-2 max-h-48 overflow-y-auto">
              {EMOJI_GROUPS.map((group) => (
                <div key={group.label} className="mb-2">
                  <p className="text-xs text-th-muted font-mono mb-1">{group.label}</p>
                  <div className="flex flex-wrap gap-1">
                    {group.emojis.map((e) => (
                      <button
                        key={e}
                        onClick={() => insertEmoji(e)}
                        className="w-8 h-8 flex items-center justify-center rounded hover:bg-th-hover transition-colors text-base"
                      >
                        {e}
                      </button>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          )}

          <form onSubmit={send} className="p-3 border-t border-th-accent-border/30 flex gap-2 items-center">
            <button
              type="button"
              onClick={() => setShowEmoji(!showEmoji)}
              className={`text-lg leading-none transition-colors ${showEmoji ? "text-th-accent" : "text-th-muted hover:text-th-body"}`}
              title="Emoji"
            >
              😊
            </button>
            <input
              ref={inputRef}
              type="text"
              value={text}
              onChange={(e) => setText(e.target.value)}
              placeholder="message..."
              maxLength={228}
              className="flex-1 bg-th-elevated border border-th-border-strong text-th-text rounded px-3 py-2 text-sm font-mono focus:border-th-accent focus:outline-none transition-colors duration-150 placeholder:text-th-faint"
            />
            <button
              type="submit"
              disabled={!text.trim() || sending}
              className="border border-th-accent-border text-th-accent-light px-3 py-2 rounded text-sm font-mono hover:bg-th-accent-bg/50 disabled:opacity-50 disabled:cursor-not-allowed transition-colors duration-150"
            >
              Send
            </button>
          </form>
        </>
      )}
    </div>
  );
}
