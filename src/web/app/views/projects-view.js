export function createProjectsView({
  state,
  api,
  showToast,
  SOURCE_BADGE,
  escapeHtml,
  relativeTime,
  makeRowKeyboardAccessible,
}) {
  const SOURCE_LABEL = {
    claude_code: "Claude Code",
    manual: "Manual",
  };

  async function loadProjectSessions(projectId) {
    const container = document.getElementById(`sessions-${projectId}`);
    if (!container) return;

    try {
      const sessions = await api(`/api/projects/${projectId}/sessions`);
      if (sessions.length === 0) {
        container.innerHTML = '<p class="text-slate-400">No Claude Code sessions found for this project.</p>';
        return;
      }

      const showAll = state.showAllSessions === projectId;
      const visible = showAll ? sessions : sessions.slice(0, 5);
      let html = `
        <table class="min-w-full text-left text-sm">
          <thead class="text-xs uppercase tracking-wide text-slate-400">
            <tr>
              <th scope="col" class="px-3 py-2">Last Active</th>
              <th scope="col" class="px-3 py-2">Messages</th>
              <th scope="col" class="px-3 py-2">First Message</th>
            </tr>
          </thead>
          <tbody class="divide-y divide-slate-800">
      `;

      for (const session of visible) {
        html += `
          <tr>
            <td class="px-3 py-2 text-slate-300">${relativeTime(session.lastActiveAt)}</td>
            <td class="px-3 py-2 text-slate-300">${session.messageCount}</td>
            <td class="px-3 py-2 text-slate-300 truncate max-w-md">${escapeHtml(session.firstMessage || "-")}</td>
          </tr>
        `;
      }

      html += "</tbody></table>";
      if (!showAll && sessions.length > 5) {
        html += `<button id="show-more-sessions-${projectId}" class="mt-2 text-xs text-sky-400 hover:text-sky-300">Show ${sessions.length - 5} more sessions</button>`;
      }

      container.innerHTML = html;
      const showMoreBtn = document.getElementById(`show-more-sessions-${projectId}`);
      if (showMoreBtn) {
        showMoreBtn.onclick = (event) => {
          event.stopPropagation();
          state.showAllSessions = projectId;
          loadProjectSessions(projectId);
        };
      }
    } catch (error) {
      container.innerHTML = `<p class="text-rose-300">Failed to load sessions: ${escapeHtml(error.message)}</p>`;
    }
  }

  async function loadProjectUsageCell(projectId) {
    const cell = document.getElementById(`usage-cell-${projectId}`);
    if (!cell) return;

    try {
      const usage = await api(`/api/projects/${projectId}/usage`);
      if (usage.estimatedCostUsd === 0 && usage.sessionCount === 0) {
        cell.textContent = "No usage data";
      } else {
        cell.innerHTML = `<span class="text-emerald-300 font-medium">~$${usage.estimatedCostUsd.toFixed(2)}</span>`;
      }
    } catch {
      cell.textContent = "-";
    }
  }

  function formatTokenCount(count) {
    if (count >= 1_000_000) return `${(count / 1_000_000).toFixed(1)}M`;
    if (count >= 1_000) return `${(count / 1_000).toFixed(1)}K`;
    return String(count);
  }

  async function loadProjectUsage(projectId) {
    const detailContainer = document.getElementById(`usage-detail-${projectId}`);
    const cellContainer = document.getElementById(`usage-cell-${projectId}`);

    try {
      const usage = await api(`/api/projects/${projectId}/usage`);
      if (usage.estimatedCostUsd === 0 && usage.sessionCount === 0) {
        if (detailContainer) detailContainer.innerHTML = '<p class="text-slate-400">No usage data</p>';
        if (cellContainer) cellContainer.textContent = "No usage data";
        return;
      }

      const cost = `~$${usage.estimatedCostUsd.toFixed(2)}`;
      if (cellContainer) {
        cellContainer.innerHTML = `<span class="text-emerald-300 font-medium">${cost}</span>`;
      }
      if (detailContainer) {
        detailContainer.innerHTML = `
          <div class="flex flex-wrap gap-4 items-center">
            <span class="text-emerald-300 font-semibold text-base">${cost} estimated cost</span>
            <span class="text-slate-400">${formatTokenCount(usage.totalInputTokens)} input</span>
            <span class="text-slate-400">${formatTokenCount(usage.totalOutputTokens)} output</span>
            <span class="text-slate-400">${formatTokenCount(usage.totalCacheCreationTokens + usage.totalCacheReadTokens)} cache</span>
            <span class="text-slate-500">${usage.sessionCount} sessions with usage</span>
          </div>
        `;
      }
    } catch {
      if (detailContainer) detailContainer.innerHTML = '<p class="text-rose-300">Failed to load usage</p>';
      if (cellContainer) cellContainer.textContent = "-";
    }
  }

  async function loadProjectTools(projectId) {
    const container = document.getElementById(`tools-detail-${projectId}`);
    if (!container) return;

    try {
      const data = await api(`/api/projects/${projectId}/tools`);
      if (data.total === 0) {
        container.innerHTML = '<p class="text-slate-400">No tool usage data</p>';
        return;
      }

      const top5 = data.breakdown.slice(0, 5);
      const maxCount = top5[0].count;
      let html = '<p class="text-xs uppercase tracking-wide text-slate-400 mb-2">Top Tools</p>';
      html += '<div class="space-y-1.5 max-w-lg">';

      for (const tool of top5) {
        const pct = maxCount > 0 ? Math.round((tool.count / maxCount) * 100) : 0;
        html += `
          <div class="flex items-center gap-2 text-xs">
            <span class="w-16 text-right text-slate-300 mono shrink-0">${escapeHtml(tool.tool)}</span>
            <div class="flex-1 h-4 bg-slate-800 rounded overflow-hidden">
              <div class="h-full bg-sky-500/70 rounded" style="width:${pct}%"></div>
            </div>
            <span class="w-20 text-slate-400 shrink-0">${tool.count} (${tool.percentage}%)</span>
          </div>
        `;
      }

      html += "</div>";
      if (data.breakdown.length > 5) {
        html += `<p class="mt-1 text-xs text-slate-500">and ${data.breakdown.length - 5} more tools (${data.total} total calls)</p>`;
      }
      container.innerHTML = html;
    } catch {
      container.innerHTML = '<p class="text-rose-300">Failed to load tools</p>';
    }
  }

  async function loadProjectFiles(projectId) {
    const container = document.getElementById(`files-detail-${projectId}`);
    if (!container) return;

    try {
      const data = await api(`/api/projects/${projectId}/files`);
      if (data.total === 0) {
        container.innerHTML = '<p class="text-slate-400">No file access data</p>';
        return;
      }

      let html = '<p class="text-xs uppercase tracking-wide text-slate-400 mb-2">Hot Files</p>';
      html += '<div class="space-y-1 max-w-lg">';
      for (let i = 0; i < data.topFiles.length; i += 1) {
        const file = data.topFiles[i];
        html += `
          <div class="flex items-center gap-2 text-xs">
            <span class="w-5 text-right text-slate-500 shrink-0">${i + 1}.</span>
            <span class="mono text-slate-300 truncate">${escapeHtml(file.shortPath)}</span>
            <span class="ml-auto shrink-0 rounded bg-slate-700 px-1.5 py-0.5 text-slate-300">${file.count}</span>
          </div>
        `;
      }
      html += "</div>";
      if (data.total > 0 && data.topFiles.length < data.total) {
        html += `<p class="mt-1 text-xs text-slate-500">${data.total} total file operations across all files</p>`;
      }
      container.innerHTML = html;
    } catch {
      container.innerHTML = '<p class="text-rose-300">Failed to load files</p>';
    }
  }

  function renderProjects() {
    const tbody = document.getElementById("projects-table");
    tbody.innerHTML = "";

    if (state.projects.length === 0) {
      tbody.innerHTML = '<tr><td colspan="6" class="px-4 py-6 text-center text-slate-400">No projects yet. Click Scan Machine to import from Claude Code.</td></tr>';
      return;
    }

    for (const project of state.projects) {
      const tr = document.createElement("tr");
      const badge = SOURCE_BADGE[project.source] || SOURCE_BADGE.manual;
      const label = SOURCE_LABEL[project.source] || project.source;
      const isClaudeCode = project.source === "claude_code";
      tr.className = isClaudeCode ? "cursor-pointer hover:bg-slate-800/70 row-interactive" : "";
      const usageCell = isClaudeCode
        ? `<td class="px-4 py-3 text-slate-300 text-xs" id="usage-cell-${project.id}">...</td>`
        : '<td class="px-4 py-3 text-slate-400 text-xs">-</td>';

      tr.innerHTML = `
        <td class="px-4 py-3 font-medium">${isClaudeCode ? `<span class="text-xs text-slate-400 mr-1">${state.expandedProjectId === project.id ? "&#9660;" : "&#9654;"}</span>` : ""}${escapeHtml(project.name)}</td>
        <td class="px-4 py-3 mono text-xs text-slate-300">${escapeHtml(project.path)}</td>
        <td class="px-4 py-3"><span class="${badge}">${label}</span></td>
        ${usageCell}
        <td class="px-4 py-3 text-slate-300">${relativeTime(project.created_at)}</td>
        <td class="px-4 py-3">
          <button data-id="${project.id}" class="project-delete btn btn-danger btn-xs">Delete</button>
        </td>
      `;

      if (isClaudeCode) {
        const onRowActivate = (target) => {
          if (target && target.closest && target.closest(".project-delete")) return;
          const expanding = state.expandedProjectId !== project.id;
          state.expandedProjectId = expanding ? project.id : null;
          renderProjects();
          if (expanding) {
            loadProjectSessions(project.id);
            loadProjectUsage(project.id);
            loadProjectTools(project.id);
            loadProjectFiles(project.id);
          }
        };

        tr.onclick = (event) => onRowActivate(event.target);
        makeRowKeyboardAccessible(tr, () => onRowActivate(null));
      }

      tbody.appendChild(tr);

      if (state.expandedProjectId === project.id && isClaudeCode) {
        const detailRow = document.createElement("tr");
        detailRow.innerHTML = `
          <td colspan="6" class="bg-slate-950/90 px-4 py-4">
            <div id="usage-detail-${project.id}" class="mb-3 text-sm text-slate-400">Loading usage...</div>
            <div id="tools-detail-${project.id}" class="mb-3 text-sm text-slate-400">Loading tools...</div>
            <div id="files-detail-${project.id}" class="mb-3 text-sm text-slate-400">Loading hot files...</div>
            <div id="sessions-${project.id}" class="text-sm text-slate-400">Loading sessions...</div>
          </td>
        `;
        tbody.appendChild(detailRow);
      }
    }

    for (const project of state.projects) {
      if (project.source === "claude_code") {
        loadProjectUsageCell(project.id);
      }
    }

    tbody.querySelectorAll(".project-delete").forEach((btn) => {
      btn.onclick = async (event) => {
        event.stopPropagation();
        const id = btn.dataset.id;
        const project = state.projects.find((p) => p.id === id);
        if (!project || !confirm(`Delete project ${project.name}?`)) return;

        try {
          await api(`/api/projects/${id}`, { method: "DELETE" });
          await loadProjects();
          showToast("Project deleted.", "success");
        } catch (error) {
          showToast(error.message, "error");
        }
      };
    });
  }

  async function loadProjects() {
    const tbody = document.getElementById("projects-table");
    if (tbody) {
      tbody.innerHTML = '<tr><td colspan="6" class="px-4 py-4"><div class="animate-pulse rounded-md bg-slate-800/70 px-4 py-3 text-slate-400">Loading projects...</div></td></tr>';
    }

    try {
      state.projects = await api("/api/projects");
      renderProjects();
    } catch (error) {
      showToast(error.message, "error");
    }
  }

  return { renderProjects, loadProjects };
}
