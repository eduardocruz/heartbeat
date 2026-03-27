export function createAgentsView({
  state,
  api,
  showToast,
  escapeHtml,
  badgeClass,
  STATUS_BADGE,
  PRIORITY_BADGE,
  titleCaseStatus,
  relativeTime,
  formatTime,
  makeRowKeyboardAccessible,
}) {
  async function loadAgentDetails(agentId) {
    try {
      state.agentDetails[agentId] = await api(`/api/agents/${agentId}`);
      if (state.expandedAgentId === agentId) {
        renderAgents();
      }
    } catch (error) {
      state.agentDetails[agentId] = { error: error.message };
      if (state.expandedAgentId === agentId) {
        renderAgents();
      }
    }
  }

  function renderAgentOptions() {
    const select = document.getElementById("task-agent");
    const existing = select.value;
    select.innerHTML = '<option value="">Unassigned</option>';
    for (const agent of state.agents) {
      const opt = document.createElement("option");
      opt.value = agent.name;
      opt.textContent = `${agent.name} (${agent.type})`;
      select.appendChild(opt);
    }
    if (existing) {
      select.value = existing;
    }
  }

  function renderAgents() {
    const tbody = document.getElementById("agents-table");
    tbody.innerHTML = "";

    if (state.agents.length === 0) {
      tbody.innerHTML = '<tr><td colspan="6" class="px-4 py-6 text-center text-slate-400">No agents configured.</td></tr>';
      return;
    }

    for (const agent of state.agents) {
      const heartbeatLabel = agent.heartbeat_enabled === 1
        ? '<span class="inline-flex items-center gap-2"><span class="heartbeat-dot"></span>enabled</span>'
        : "disabled";
      const isExpanded = state.expandedAgentId === agent.id;
      const tr = document.createElement("tr");
      tr.className = "cursor-pointer hover:bg-slate-800/70 row-interactive";
      const chevron = `<span class="mr-1 text-xs text-slate-400">${isExpanded ? "&#9660;" : "&#9654;"}</span>`;
      const nameHtml = agent.avatar_url
        ? `<div class="flex items-center gap-2">${chevron}<img src="${escapeHtml(agent.avatar_url)}" class="h-8 w-8 rounded-full" /><div><span class="font-medium">${escapeHtml(agent.name)}</span>${agent.role ? `<span class="ml-1.5 text-xs text-slate-400 uppercase">${escapeHtml(agent.role)}</span>` : ""}</div></div>`
        : `<span class="font-medium">${chevron}${escapeHtml(agent.name)}</span>`;

      tr.innerHTML = `
        <td class="px-4 py-3">${nameHtml}</td>
        <td class="px-4 py-3">${escapeHtml(agent.type)}</td>
        <td class="px-4 py-3">
          <p>${heartbeatLabel}</p>
          <p class="mono text-xs text-slate-400">${escapeHtml(agent.heartbeat_cron || "-")}</p>
        </td>
        <td class="px-4 py-3 text-xs text-slate-300">${escapeHtml(formatTime(agent.heartbeat_next_run))}</td>
        <td class="px-4 py-3">${agent.active === 1 ? "yes" : "no"}</td>
        <td class="px-4 py-3">
          <div class="flex gap-2">
            <button data-id="${agent.id}" data-action="edit" class="btn btn-secondary btn-xs">Edit</button>
            <button data-id="${agent.id}" data-action="delete" class="btn btn-danger btn-xs">Delete</button>
          </div>
        </td>
      `;

      const onRowActivate = (target) => {
        if (target && target.closest && target.closest("button")) return;
        const expanding = state.expandedAgentId !== agent.id;
        state.expandedAgentId = expanding ? agent.id : null;
        if (expanding && !state.agentDetails[agent.id]) {
          state.agentDetails[agent.id] = null;
          void loadAgentDetails(agent.id);
        }
        renderAgents();
      };

      tr.onclick = (event) => onRowActivate(event.target);
      makeRowKeyboardAccessible(tr, () => onRowActivate(null));
      tbody.appendChild(tr);

      if (isExpanded) {
        const details = state.agentDetails[agent.id];
        let detailsHtml;
        if (details === null) {
          detailsHtml = '<p class="text-sm text-slate-400">Loading details...</p>';
        } else if (details && details.error) {
          detailsHtml = `<p class="text-sm text-rose-300">Failed to load details: ${escapeHtml(details.error)}</p>`;
        } else if (details) {
          const issuesHtml = details.assigned_issues && details.assigned_issues.length > 0
            ? `<table class="min-w-full text-left text-xs mt-2">
                <thead class="text-xs uppercase tracking-wide text-slate-400">
                  <tr>
                    <th scope="col" class="px-3 py-2">Title</th>
                    <th scope="col" class="px-3 py-2">Status</th>
                    <th scope="col" class="px-3 py-2">Priority</th>
                    <th scope="col" class="px-3 py-2">Updated</th>
                  </tr>
                </thead>
                <tbody class="divide-y divide-slate-800">
                  ${details.assigned_issues.map((issue) => `
                    <tr>
                      <td class="px-3 py-2 text-slate-200">${escapeHtml(issue.title)}</td>
                      <td class="px-3 py-2"><span class="${badgeClass(STATUS_BADGE, issue.status)}">${escapeHtml(titleCaseStatus(issue.status))}</span></td>
                      <td class="px-3 py-2 text-slate-300"><span class="${badgeClass(PRIORITY_BADGE, issue.priority)}">${escapeHtml(issue.priority || "-")}</span></td>
                      <td class="px-3 py-2 text-slate-400">${relativeTime(issue.updated_at)}</td>
                    </tr>
                  `).join("")}
                </tbody>
              </table>`
            : '<p class="text-sm text-slate-400 mt-1">No tasks currently assigned.</p>';

          const soulSection = details.soul_md
            ? `<div class="mt-3">
                <p class="text-xs uppercase tracking-wide text-slate-400 mb-1">Soul Document</p>
                <pre class="mono text-xs text-slate-300 whitespace-pre-wrap bg-slate-950/60 rounded-md border border-slate-700 p-3 max-h-48 overflow-auto">${escapeHtml(details.soul_md)}</pre>
              </div>`
            : "";

          const budgetHtml = details.budget_limit_cents
            ? `<p><span class="text-slate-400">Budget:</span> <span class="text-emerald-300 font-medium">$${(details.budget_limit_cents / 100).toFixed(2)} limit</span></p>`
            : "";

          detailsHtml = `
            <div class="grid gap-2 text-sm text-slate-300 sm:grid-cols-2 lg:grid-cols-3 mb-3">
              <p><span class="text-slate-400">ID:</span> <span class="mono text-xs">${escapeHtml(details.id)}</span></p>
              <p><span class="text-slate-400">Type:</span> ${escapeHtml(details.type)}</p>
              <p><span class="text-slate-400">Command:</span> <span class="mono text-xs">${escapeHtml(details.command_template)}</span></p>
              ${details.heartbeat_repo ? `<p><span class="text-slate-400">Repo:</span> <span class="mono text-xs">${escapeHtml(details.heartbeat_repo)}</span></p>` : ""}
              <p><span class="text-slate-400">Created:</span> ${relativeTime(details.created_at)}</p>
              ${budgetHtml}
            </div>
            ${details.description ? `<p class="text-sm text-slate-300 mb-3">${escapeHtml(details.description)}</p>` : ""}
            <div>
              <p class="text-xs uppercase tracking-wide text-slate-400">Assigned Tasks (${(details.assigned_issues || []).length})</p>
              ${issuesHtml}
            </div>
            ${soulSection}
          `;
        } else {
          detailsHtml = '<p class="text-sm text-slate-400">No details available.</p>';
        }

        const detailRow = document.createElement("tr");
        detailRow.innerHTML = `<td colspan="6" class="bg-slate-950/90 px-5 py-4">${detailsHtml}</td>`;
        tbody.appendChild(detailRow);
      }
    }

    tbody.querySelectorAll("button[data-action]").forEach((btn) => {
      btn.onclick = async (event) => {
        event.stopPropagation();
        const id = btn.dataset.id;
        const action = btn.dataset.action;
        const agent = state.agents.find((x) => x.id === id);
        if (!agent) return;

        if (action === "edit") {
          document.getElementById("agent-id").value = agent.id;
          document.getElementById("agent-name").value = agent.name;
          document.getElementById("agent-type").value = agent.type;
          document.getElementById("agent-command").value = agent.command_template;
          document.getElementById("agent-active").checked = agent.active === 1;
          document.getElementById("agent-heartbeat-cron").value = agent.heartbeat_cron || "";
          document.getElementById("agent-heartbeat-repo").value = agent.heartbeat_repo || "";
          document.getElementById("agent-heartbeat-prompt").value = agent.heartbeat_prompt || "";
          document.getElementById("agent-heartbeat-enabled").checked = agent.heartbeat_enabled === 1;
          document.getElementById("agent-form-title").textContent = "Edit Agent";
          return;
        }

        if (!confirm(`Delete agent ${agent.name}?`)) return;
        try {
          await api(`/api/agents/${agent.id}`, { method: "DELETE" });
          await loadAgents();
        } catch (error) {
          showToast(error.message, "error");
        }
      };
    });
  }

  async function loadAgents() {
    const tbody = document.getElementById("agents-table");
    if (tbody) {
      tbody.innerHTML = '<tr><td colspan="6" class="px-4 py-4"><div class="animate-pulse rounded-md bg-slate-800/70 px-4 py-3 text-slate-400">Loading agents...</div></td></tr>';
    }

    try {
      state.agents = await api("/api/agents");
      renderAgents();
      renderAgentOptions();
    } catch (error) {
      showToast(error.message, "error");
    }
  }

  return { loadAgents, renderAgents, renderAgentOptions };
}
