export function createTasksController({
  state,
  api,
  showToast,
  titleCaseStatus,
  STATUS_TABS,
  ACTIVE_TASK_STATUSES,
  renderTasks,
}) {
  async function loadTasks() {
    const query = state.statusFilter === "all" ? "" : `?status=${state.statusFilter}`;
    const tbody = document.getElementById("tasks-table");
    if (tbody) {
      tbody.innerHTML = '<tr><td colspan="5" class="px-4 py-4"><div class="animate-pulse rounded-md bg-slate-800/70 px-4 py-3 text-slate-400">Loading tasks...</div></td></tr>';
    }

    try {
      state.tasks = await api(`/api/tasks${query}`);
      renderTasks();
      configurePolling();
    } catch (error) {
      showToast(error.message, "error");
    }
  }

  function renderStatusTabs() {
    const root = document.getElementById("status-tabs");
    root.innerHTML = "";

    for (const status of STATUS_TABS) {
      const button = document.createElement("button");
      const active = state.statusFilter === status;
      button.className = `btn btn-sm ${active ? "btn-primary" : "btn-secondary"}`;
      button.textContent = status === "all" ? "All" : titleCaseStatus(status);
      button.onclick = () => {
        state.statusFilter = status;
        state.expandedTaskId = null;
        renderStatusTabs();
        loadTasks();
      };
      root.appendChild(button);
    }
  }

  function bindTaskTableControls() {
    const search = document.getElementById("tasks-search");
    const sort = document.getElementById("tasks-sort");
    const pageSize = document.getElementById("tasks-page-size");
    const prev = document.getElementById("tasks-prev-page");
    const next = document.getElementById("tasks-next-page");

    if (search) {
      search.oninput = () => {
        state.taskQuery = String(search.value || "");
        state.taskPage = 1;
        renderTasks();
      };
    }

    if (sort) {
      sort.onchange = () => {
        state.taskSort = String(sort.value || "created_desc");
        state.taskPage = 1;
        renderTasks();
      };
    }

    if (pageSize) {
      pageSize.onchange = () => {
        const parsed = Number.parseInt(String(pageSize.value || "25"), 10);
        state.taskPageSize = Number.isFinite(parsed) && parsed > 0 ? parsed : 25;
        state.taskPage = 1;
        renderTasks();
      };
    }

    if (prev) {
      prev.onclick = () => {
        state.taskPage = Math.max(1, state.taskPage - 1);
        renderTasks();
      };
    }

    if (next) {
      next.onclick = () => {
        const totalPages = Math.max(1, Math.ceil(state.filteredTasks.length / state.taskPageSize));
        state.taskPage = Math.min(totalPages, state.taskPage + 1);
        renderTasks();
      };
    }
  }

  function configurePolling() {
    const hasActiveTasks = state.tasks.some((task) => ACTIVE_TASK_STATUSES.has(task.status));
    if (!hasActiveTasks && state.pollHandle) {
      clearInterval(state.pollHandle);
      state.pollHandle = null;
    }
    if (hasActiveTasks && !state.pollHandle) {
      state.pollHandle = setInterval(loadTasks, 5000);
    }
  }

  return { loadTasks, renderStatusTabs, bindTaskTableControls, configurePolling };
}
