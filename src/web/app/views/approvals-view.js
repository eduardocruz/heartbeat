const APPROVALS_FILTER_TABS = ["pending", "approved", "denied", "all"];

export function createApprovalsView({
  state,
  api,
  showToast,
  badgeClass,
  APPROVAL_STATUS_BADGE,
  escapeHtml,
  relativeTime,
}) {
  function renderApprovalsFilterTabs() {
    const root = document.getElementById("approvals-filter-tabs");
    if (!root) return;
    root.innerHTML = "";

    for (const filter of APPROVALS_FILTER_TABS) {
      const button = document.createElement("button");
      const active = state.approvalsFilter === filter;
      button.className = `btn btn-sm ${active ? "btn-primary" : "btn-secondary"}`;
      button.textContent = filter === "all" ? "All" : filter.charAt(0).toUpperCase() + filter.slice(1);
      button.onclick = () => {
        state.approvalsFilter = filter;
        renderApprovalsFilterTabs();
        loadApprovals();
      };
      root.appendChild(button);
    }
  }

  function renderApprovals() {
    const tbody = document.getElementById("approvals-table");
    if (!tbody) return;
    tbody.innerHTML = "";
    const approvals = state.approvals || [];

    if (approvals.length === 0) {
      tbody.innerHTML = `<tr><td colspan="6" class="px-4 py-6 text-center text-slate-400">No ${state.approvalsFilter === "all" ? "" : `${state.approvalsFilter} `}approvals found.</td></tr>`;
      return;
    }

    for (const approval of approvals) {
      const badge = badgeClass(APPROVAL_STATUS_BADGE, approval.status);
      const isPending = approval.status === "pending";
      const actionsHtml = isPending
        ? `<div class="flex gap-2">
            <button class="approval-approve btn btn-success btn-xs" data-id="${escapeHtml(approval.id)}">Approve</button>
            <button class="approval-deny btn btn-danger btn-xs" data-id="${escapeHtml(approval.id)}">Deny</button>
          </div>`
        : `<span class="text-xs text-slate-500">${approval.resolved_by ? escapeHtml(approval.resolved_by) : "—"}</span>`;

      const linkedHtml = approval.task_id
        ? `<span class="mono text-xs text-slate-400">${escapeHtml(approval.task_id.slice(0, 8))}…</span>`
        : approval.run_id
          ? `<span class="mono text-xs text-slate-400">run:${escapeHtml(approval.run_id.slice(0, 8))}…</span>`
          : "—";

      const tr = document.createElement("tr");
      tr.className = isPending ? "bg-amber-950/10" : "";
      tr.innerHTML = `
        <td class="px-4 py-3 max-w-xs">
          <p class="text-sm text-slate-200 truncate" title="${escapeHtml(approval.reason)}">${escapeHtml(approval.reason)}</p>
        </td>
        <td class="px-4 py-3 mono text-xs text-slate-300">${escapeHtml(approval.agent_id.slice(0, 8))}…</td>
        <td class="px-4 py-3"><span class="${badge}">${escapeHtml(approval.status)}</span></td>
        <td class="px-4 py-3">${linkedHtml}</td>
        <td class="px-4 py-3 text-slate-300 text-xs">${relativeTime(approval.created_at)}</td>
        <td class="px-4 py-3">${actionsHtml}</td>
      `;
      tbody.appendChild(tr);
    }

    tbody.querySelectorAll(".approval-approve").forEach((btn) => {
      btn.onclick = async () => {
        const id = btn.dataset.id;
        try {
          btn.disabled = true;
          await api(`/api/approvals/${id}`, {
            method: "PATCH",
            body: JSON.stringify({ status: "approved", resolved_by: "operator" }),
          });
          await loadApprovals();
        } catch (error) {
          showToast(error.message, "error");
          btn.disabled = false;
        }
      };
    });

    tbody.querySelectorAll(".approval-deny").forEach((btn) => {
      btn.onclick = async () => {
        const id = btn.dataset.id;
        try {
          btn.disabled = true;
          await api(`/api/approvals/${id}`, {
            method: "PATCH",
            body: JSON.stringify({ status: "denied", resolved_by: "operator" }),
          });
          await loadApprovals();
        } catch (error) {
          showToast(error.message, "error");
          btn.disabled = false;
        }
      };
    });
  }

  async function loadApprovals() {
    renderApprovalsFilterTabs();
    const query = state.approvalsFilter === "all" ? "" : `?status=${state.approvalsFilter}`;
    const tbody = document.getElementById("approvals-table");
    if (tbody) {
      tbody.innerHTML = '<tr><td colspan="6" class="px-4 py-4"><div class="animate-pulse rounded-md bg-slate-800/70 px-4 py-3 text-slate-400">Loading approvals...</div></td></tr>';
    }

    try {
      state.approvals = await api(`/api/approvals${query}`);
      renderApprovals();
    } catch (error) {
      showToast(error.message, "error");
    }
  }

  return { loadApprovals, renderApprovals };
}
