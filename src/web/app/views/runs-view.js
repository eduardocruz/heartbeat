export function createRunsView({
  state,
  api,
  showToast,
  badgeClass,
  RUN_STATUS_BADGE,
  escapeHtml,
  titleCaseStatus,
  relativeTime,
  makeRowKeyboardAccessible,
}) {
  function formatDuration(startedAt, completedAt) {
    if (!startedAt) return "-";
    const startMs = Date.parse(startedAt);
    if (!Number.isFinite(startMs)) return "-";
    const endMs = completedAt ? Date.parse(completedAt) : Date.now();
    if (!Number.isFinite(endMs)) return "-";
    const sec = Math.max(0, Math.round((endMs - startMs) / 1000));
    if (sec < 60) return `${sec}s`;
    const min = Math.floor(sec / 60);
    if (min < 60) return `${min}m ${sec % 60}s`;
    return `${Math.floor(min / 60)}h ${min % 60}m`;
  }

  function formatCostCents(cents) {
    if (!cents || cents === 0) return "-";
    const dollars = cents / 100;
    return dollars < 0.01 ? "<$0.01" : `$${dollars.toFixed(2)}`;
  }

  function configureRunsPolling() {
    const hasActiveRuns = (state.runs || []).some((run) => run.status === "running");
    const badge = document.getElementById("runs-live-badge");
    if (badge) badge.classList.toggle("hidden", !hasActiveRuns);

    if (!hasActiveRuns && state.runsPollHandle) {
      clearInterval(state.runsPollHandle);
      state.runsPollHandle = null;
    }

    if (hasActiveRuns && !state.runsPollHandle) {
      state.runsPollHandle = setInterval(loadRuns, 5000);
    }
  }

  function renderRuns() {
    const tbody = document.getElementById("runs-table");
    tbody.innerHTML = "";
    const runs = state.runs || [];

    if (runs.length === 0) {
      tbody.innerHTML = '<tr><td colspan="7" class="px-4 py-6 text-center text-slate-400">No execution runs yet.</td></tr>';
      return;
    }

    for (const run of runs) {
      const tr = document.createElement("tr");
      const isRunning = run.status === "running";
      tr.className = `cursor-pointer hover:bg-slate-800/70 row-interactive${isRunning ? " bg-blue-950/20" : ""}`;
      const badge = badgeClass(RUN_STATUS_BADGE, run.status);
      tr.innerHTML = `
        <td class="px-4 py-3 font-medium">${escapeHtml(run.task_title || run.task_id)}</td>
        <td class="px-4 py-3">${escapeHtml(run.agent)}</td>
        <td class="px-4 py-3"><span class="${badge}">${escapeHtml(titleCaseStatus(run.status))}</span></td>
        <td class="px-4 py-3 mono text-xs">${run.exit_code !== null ? run.exit_code : "-"}</td>
        <td class="px-4 py-3 text-slate-300">${relativeTime(run.started_at)}</td>
        <td class="px-4 py-3 text-slate-300">${formatDuration(run.started_at, run.completed_at)}</td>
        <td class="px-4 py-3 text-emerald-300 mono text-xs">${formatCostCents(run.cost_cents)}</td>
      `;

      const onRowActivate = () => {
        state.expandedRunId = state.expandedRunId === run.id ? null : run.id;
        renderRuns();
      };

      tr.onclick = onRowActivate;
      makeRowKeyboardAccessible(tr, onRowActivate);
      tbody.appendChild(tr);

      if (state.expandedRunId === run.id) {
        const details = document.createElement("tr");
        details.innerHTML = `
          <td colspan="7" class="space-y-3 bg-slate-950/90 px-4 py-4">
            <div class="grid gap-2 text-sm text-slate-300 sm:grid-cols-2 lg:grid-cols-4">
              <p><span class="text-slate-400">Run ID:</span> <span class="mono text-xs">${escapeHtml(run.id)}</span></p>
              <p><span class="text-slate-400">Commit:</span> ${escapeHtml(run.commit_hash || "-")}</p>
              <p><span class="text-slate-400">Timed Out:</span> ${run.timed_out ? "Yes" : "No"}</p>
              <p><span class="text-slate-400">Cost:</span> <span class="text-emerald-300 font-medium">${formatCostCents(run.cost_cents)}</span></p>
              <p class="sm:col-span-2"><span class="text-slate-400">Workspace:</span> <span class="mono text-xs">${escapeHtml(run.workspace_dir || "-")}</span></p>
            </div>
            <div class="grid gap-3 lg:grid-cols-2">
              <div>
                <p class="text-xs uppercase tracking-wide text-slate-400">Stdout</p>
                <pre class="mono mt-1 max-h-48 overflow-auto rounded-md border border-slate-700 bg-black/40 p-3 text-xs text-emerald-200">${escapeHtml(run.stdout || "")}</pre>
              </div>
              <div>
                <p class="text-xs uppercase tracking-wide text-slate-400">Stderr</p>
                <pre class="mono mt-1 max-h-48 overflow-auto rounded-md border border-slate-700 bg-black/40 p-3 text-xs text-rose-200">${escapeHtml(run.stderr || "")}</pre>
              </div>
            </div>
          </td>
        `;
        tbody.appendChild(details);
      }
    }
  }

  async function loadRuns() {
    const tbody = document.getElementById("runs-table");
    if (tbody) {
      tbody.innerHTML = '<tr><td colspan="7" class="px-4 py-4"><div class="animate-pulse rounded-md bg-slate-800/70 px-4 py-3 text-slate-400">Loading runs...</div></td></tr>';
    }

    try {
      state.runs = await api("/api/runs?limit=100");
      renderRuns();
      configureRunsPolling();
    } catch (error) {
      showToast(error.message, "error");
    }
  }

  return { loadRuns, renderRuns };
}
