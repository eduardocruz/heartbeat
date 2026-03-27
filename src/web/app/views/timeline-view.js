import { HEATMAP_COLORS } from "../constants.js";

export function createTimelineView({ api, escapeHtml }) {
  let timelineDaysLoaded = 30;

  async function loadHeatmap() {
    const container = document.getElementById("heatmap-container");
    try {
      const data = await api("/api/heatmap?days=90");
      if (data.days.length === 0) {
        container.innerHTML = '<div class="text-sm text-slate-400">No activity data</div>';
        return;
      }

      const firstDate = new Date(data.days[0].date + "T00:00:00");
      const startDow = firstDate.getDay();
      const padded = [];
      for (let i = 0; i < startDow; i += 1) padded.push(null);
      for (const day of data.days) padded.push(day);

      const weeks = Math.ceil(padded.length / 7);
      const dayLabels = ["Sun", "", "Tue", "", "Thu", "", "Sat"];

      let html = '<div style="overflow-x:auto">';
      html += '<div style="display:inline-flex;gap:2px;align-items:flex-start">';

      html += '<div style="display:flex;flex-direction:column;gap:2px;margin-right:4px">';
      for (let row = 0; row < 7; row += 1) {
        html += `<div style="width:24px;height:10px;line-height:10px;font-size:9px;color:#94a3b8;text-align:right">${dayLabels[row]}</div>`;
      }
      html += "</div>";

      for (let col = 0; col < weeks; col += 1) {
        html += '<div style="display:flex;flex-direction:column;gap:2px">';
        for (let row = 0; row < 7; row += 1) {
          const idx = col * 7 + row;
          const day = idx < padded.length ? padded[idx] : null;
          if (day) {
            const color = HEATMAP_COLORS[day.intensity];
            const label = `${formatDateHeader(day.date)}: ${day.count} session${day.count !== 1 ? "s" : ""}`;
            html += `<div title="${escapeHtml(label)}" style="width:10px;height:10px;background:${color};border-radius:2px"></div>`;
          } else {
            html += '<div style="width:10px;height:10px"></div>';
          }
        }
        html += "</div>";
      }

      html += "</div></div>";
      html += `<p class="mt-3 text-xs text-slate-400">${data.totalSessions} session${data.totalSessions !== 1 ? "s" : ""} in the last 90 days &middot; ${data.activeDays} active day${data.activeDays !== 1 ? "s" : ""}</p>`;
      container.innerHTML = html;
    } catch (error) {
      container.innerHTML = `<div class="text-sm text-rose-300">Failed to load heatmap: ${escapeHtml(error.message)}</div>`;
    }
  }

  function formatDateHeader(dateStr) {
    const date = new Date(dateStr + "T00:00:00");
    return date.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
  }

  async function loadTimeline(days) {
    if (days) timelineDaysLoaded = days;
    loadHeatmap();
    const container = document.getElementById("timeline-content");

    try {
      const timeline = await api(`/api/timeline?days=${timelineDaysLoaded}`);
      if (timeline.length === 0) {
        container.innerHTML = '<div class="rounded-xl border border-slate-700/70 bg-slate-900/75 p-6 text-center text-slate-400">No activity found in ~/.claude/history.jsonl</div>';
        return;
      }

      let html = "";
      for (const day of timeline) {
        html += '<div class="rounded-xl border border-slate-700/70 bg-slate-900/75 shadow-xl overflow-hidden">';
        html += '<div class="bg-slate-800/90 px-4 py-3 flex items-center justify-between">';
        html += `<span class="font-semibold text-sm">${escapeHtml(formatDateHeader(day.date))}</span>`;
        html += `<span class="text-xs text-slate-400">${day.totalSessions} session${day.totalSessions !== 1 ? "s" : ""}</span>`;
        html += "</div>";
        html += '<div class="divide-y divide-slate-800">';

        for (const project of day.projects) {
          const preview = project.firstMessage ? escapeHtml(project.firstMessage.slice(0, 100)) : "";
          html += '<div class="px-4 py-3 flex items-start gap-3">';
          html += '<span class="mt-1.5 block h-2 w-2 shrink-0 rounded-full bg-sky-400"></span>';
          html += '<div class="min-w-0">';
          html += `<span class="font-medium text-sm">${escapeHtml(project.projectName)}</span>`;
          html += `<span class="ml-2 text-xs text-slate-400">(${project.sessionCount} session${project.sessionCount !== 1 ? "s" : ""})</span>`;
          if (preview) {
            html += `<p class="mt-0.5 text-xs text-slate-400 truncate">${preview}</p>`;
          }
          html += "</div>";
          html += "</div>";
        }

        html += "</div></div>";
      }

      if (timelineDaysLoaded < 90) {
        html += '<div class="text-center"><button id="timeline-load-more" class="btn btn-secondary btn-sm">Load more</button></div>';
      }

      container.innerHTML = html;
      const loadMoreBtn = document.getElementById("timeline-load-more");
      if (loadMoreBtn) {
        loadMoreBtn.onclick = () => loadTimeline(90);
      }
    } catch (error) {
      container.innerHTML = `<div class="rounded-xl border border-slate-700/70 bg-slate-900/75 p-6 text-center text-rose-300">Failed to load timeline: ${escapeHtml(error.message)}</div>`;
    }
  }

  return { loadTimeline };
}
