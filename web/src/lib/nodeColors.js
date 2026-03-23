const PALETTE = [
  "#34d399", "#f472b6", "#facc15", "#fb923c", "#a78bfa",
  "#38bdf8", "#f87171", "#4ade80", "#c084fc", "#2dd4bf",
];

function djb2(str) {
  let hash = 5381;
  for (let i = 0; i < str.length; i++) {
    hash = ((hash << 5) + hash + str.charCodeAt(i)) >>> 0;
  }
  return hash;
}

export function nodeColor(nodeId) {
  return PALETTE[djb2(nodeId) % PALETTE.length];
}
