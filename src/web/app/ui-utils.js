export function relativeTime(raw) {
  if (!raw) return "-";
  const source = new Date(raw.replace(" ", "T") + "Z");
  const sec = Math.floor((Date.now() - source.getTime()) / 1000);
  if (!Number.isFinite(sec)) return raw;
  if (sec < 60) return `${sec}s ago`;
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min}m ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h ago`;
  const day = Math.floor(hr / 24);
  return `${day}d ago`;
}

export function formatTime(raw) {
  if (!raw) return "-";
  const source = new Date(raw);
  if (!Number.isFinite(source.getTime())) return raw;
  return source.toLocaleString();
}

export function escapeHtml(value) {
  const div = document.createElement("div");
  div.textContent = value || "";
  return div.innerHTML;
}

export function titleCaseStatus(status) {
  return String(status || "")
    .split("_")
    .map((part) => (part ? part[0].toUpperCase() + part.slice(1) : part))
    .join(" ");
}

export function badgeClass(map, key, fallback = "badge badge-low") {
  return map[key] || fallback;
}

export function makeRowKeyboardAccessible(row, onActivate) {
  if (!row || typeof row.setAttribute !== "function" || typeof row.addEventListener !== "function") {
    return;
  }
  row.setAttribute("tabindex", "0");
  row.setAttribute("role", "button");
  row.addEventListener("keydown", (event) => {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      onActivate();
    }
  });
}
