import { useState, useCallback } from "react";

const PREFIX = "meshtastic-";

export default function usePersistedState(key, defaultValue) {
  const fullKey = PREFIX + key;
  const isSet = defaultValue instanceof Set;

  const [value, setValue] = useState(() => {
    try {
      const stored = localStorage.getItem(fullKey);
      if (stored === null) return defaultValue;
      const parsed = JSON.parse(stored);
      return isSet ? new Set(parsed) : parsed;
    } catch {
      return defaultValue;
    }
  });

  const setPersisted = useCallback(
    (update) => {
      setValue((prev) => {
        const next = typeof update === "function" ? update(prev) : update;
        try {
          localStorage.setItem(fullKey, JSON.stringify(isSet ? [...next] : next));
        } catch {}
        return next;
      });
    },
    [fullKey, isSet]
  );

  return [value, setPersisted];
}
