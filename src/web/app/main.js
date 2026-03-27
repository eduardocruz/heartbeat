import { api } from "./api-client.js";
import { pathToView, syncViewUrl } from "./router.js";
import { createAgentsView } from "./views/agents-view.js";
import { createApprovalsView } from "./views/approvals-view.js";
import { createProjectsView } from "./views/projects-view.js";
import { createRunsView } from "./views/runs-view.js";
import { createTasksController } from "./views/tasks-controller.js";
import { createTimelineView } from "./views/timeline-view.js";
import {
  ACTIVE_TASK_STATUSES,
  APPROVAL_STATUS_BADGE,
  PRIORITY_BADGE,
  PRIORITY_WEIGHT,
  RUN_STATUS_BADGE,
  SOURCE_BADGE,
  STATUS_BADGE,
  STATUS_TABS,
  TASK_STATUS_OPTIONS,
} from "./constants.js";
import {
  badgeClass,
  escapeHtml,
  formatTime,
  makeRowKeyboardAccessible,
  relativeTime,
  titleCaseStatus,
} from "./ui-utils.js";

      const state = {
        tasks: [],
        filteredTasks: [],
        agents: [],
        agentDetails: {},
        projects: [],
        runs: [],
        approvals: [],
        approvalsFilter: "pending",
        expandedTaskId: null,
        expandedAgentId: null,
        expandedRunId: null,
        taskComments: {},
        taskFeedback: {},
        expandedProjectId: null,
        showAllSessions: null,
        statusFilter: "all",
        taskQuery: "",
        taskSort: "created_desc",
        taskPage: 1,
        taskPageSize: 25,
        pollHandle: null,
        runsPollHandle: null,
      };

      let lastFocusedElement = null;
      let activeDialogCleanup = null;
      let approvalsView = null;
      let agentsView = null;
      let projectsView = null;
      let runsView = null;
      let tasksController = null;
      const timelineView = createTimelineView({ api, escapeHtml });

      function showToast(message, type = "info", timeoutMs = 4500) {
        const stack = document.getElementById("global-toast-stack");
        if (!stack) return;

        const styles = {
          success: "toast-success",
          error: "toast-danger",
          warning: "toast-warning",
          info: "toast-info",
        };
        const tone = styles[type] || styles.info;
        const node = document.createElement("div");
        if (typeof node.setAttribute === "function") {
          node.setAttribute("role", "status");
        }
        node.className = `toast ${tone} pointer-events-auto rounded-lg border px-4 py-3 text-sm shadow-xl`;
        node.textContent = message;
        stack.appendChild(node);
        setTimeout(() => {
          if (node && node.parentNode === stack) {
            stack.removeChild(node);
          }
        }, timeoutMs);
      }

      approvalsView = createApprovalsView({
        state,
        api,
        showToast,
        badgeClass,
        APPROVAL_STATUS_BADGE,
        escapeHtml,
        relativeTime,
      });

      function renderApprovals() {
        approvalsView.renderApprovals();
      }

      runsView = createRunsView({
        state,
        api,
        showToast,
        badgeClass,
        RUN_STATUS_BADGE,
        escapeHtml,
        titleCaseStatus,
        relativeTime,
        makeRowKeyboardAccessible,
      });

      function renderRuns() {
        runsView.renderRuns();
      }

      projectsView = createProjectsView({
        state,
        api,
        showToast,
        SOURCE_BADGE,
        escapeHtml,
        relativeTime,
        makeRowKeyboardAccessible,
      });

      function renderProjects() {
        projectsView.renderProjects();
      }

      async function loadProjects() {
        await projectsView.loadProjects();
      }

      agentsView = createAgentsView({
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
      });

      function renderAgents() {
        agentsView.renderAgents();
      }

      async function loadAgents() {
        await agentsView.loadAgents();
      }

      function renderAgentOptions() {
        agentsView.renderAgentOptions();
      }

      tasksController = createTasksController({
        state,
        api,
        showToast,
        titleCaseStatus,
        STATUS_TABS,
        ACTIVE_TASK_STATUSES,
        renderTasks,
      });

      async function loadTasks() {
        await tasksController.loadTasks();
      }

      function renderStatusTabs() {
        tasksController.renderStatusTabs();
      }

      function bindTaskTableControls() {
        tasksController.bindTaskTableControls();
      }

      function configurePolling() {
        tasksController.configurePolling();
      }

      function clearInlineError(inputEl) {
        if (!inputEl || typeof inputEl.setAttribute !== "function") return;
        inputEl.setAttribute("aria-invalid", "false");
        if (inputEl.classList && typeof inputEl.classList.remove === "function") {
          inputEl.classList.remove("border-rose-500");
        }
      }

      function setInlineError(inputEl, message) {
        if (!inputEl || typeof inputEl.setAttribute !== "function") return;
        inputEl.setAttribute("aria-invalid", "true");
        if (inputEl.classList && typeof inputEl.classList.add === "function") {
          inputEl.classList.add("border-rose-500");
        }
        showToast(message, "error");
      }

      function openDialog(modalId, initialFocusSelector) {
        const dialog = document.getElementById(modalId);
        if (!dialog || typeof dialog.showModal !== "function") return;
        lastFocusedElement = document.activeElement;
        dialog.showModal();
        if (initialFocusSelector && typeof dialog.querySelector === "function") {
          const focusTarget = dialog.querySelector(initialFocusSelector);
          if (focusTarget) {
            focusTarget.focus();
          }
        }

        if (activeDialogCleanup) {
          activeDialogCleanup();
          activeDialogCleanup = null;
        }

        const handleCancel = (event) => {
          if (event && typeof event.preventDefault === "function") {
            event.preventDefault();
          }
          closeDialog(modalId);
        };

        const handleKeydown = (event) => {
          if (!event || event.key !== "Tab" || typeof dialog.querySelectorAll !== "function") return;
          const focusables = Array.from(dialog.querySelectorAll('button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'));
          if (focusables.length === 0) return;
          const first = focusables[0];
          const last = focusables[focusables.length - 1];
          if (event.shiftKey && document.activeElement === first) {
            event.preventDefault();
            last.focus();
          } else if (!event.shiftKey && document.activeElement === last) {
            event.preventDefault();
            first.focus();
          }
        };

        if (typeof dialog.addEventListener === "function") {
          dialog.addEventListener("cancel", handleCancel);
          dialog.addEventListener("keydown", handleKeydown);
          activeDialogCleanup = () => {
            dialog.removeEventListener("cancel", handleCancel);
            dialog.removeEventListener("keydown", handleKeydown);
          };
        }
      }

      function closeDialog(modalId) {
        const dialog = document.getElementById(modalId);
        if (activeDialogCleanup) {
          activeDialogCleanup();
          activeDialogCleanup = null;
        }
        if (dialog && typeof dialog.close === "function") {
          dialog.close();
        }
        if (lastFocusedElement && typeof lastFocusedElement.focus === "function") {
          lastFocusedElement.focus();
        }
      }

      function openView(view, options = {}) {
        const { syncHistory = true, replaceHistory = false } = options;
        document.getElementById("tasks-view").classList.toggle("hidden", view !== "tasks");
        document.getElementById("runs-view").classList.toggle("hidden", view !== "runs");
        document.getElementById("agents-view").classList.toggle("hidden", view !== "agents");
        document.getElementById("projects-view").classList.toggle("hidden", view !== "projects");
        document.getElementById("timeline-view").classList.toggle("hidden", view !== "timeline");
        document.getElementById("approvals-view").classList.toggle("hidden", view !== "approvals");

        document.querySelectorAll(".view-tab").forEach((el) => {
          const active = el.dataset.view === view;
          el.classList.toggle("active", active);
          if (active) {
            if (typeof el.setAttribute === "function") {
              el.setAttribute("aria-current", "page");
            }
          } else if (typeof el.removeAttribute === "function") {
            el.removeAttribute("aria-current");
          }
        });

        const activeSection = document.getElementById(`${view}-view`);
        if (activeSection) {
          activeSection.classList.remove("view-enter");
          void activeSection.offsetWidth;
          activeSection.classList.add("view-enter");
        }

        if (syncHistory) {
          syncViewUrl(view, { replace: replaceHistory });
        }

        if (view === "projects") projectsView.loadProjects();
        if (view === "timeline") timelineView.loadTimeline();
        if (view === "runs") runsView.loadRuns();
        if (view === "approvals") approvalsView.loadApprovals();

        // Stop runs polling when leaving runs view
        if (view !== "runs" && state.runsPollHandle) {
          clearInterval(state.runsPollHandle);
          state.runsPollHandle = null;
        }
      }

      function buildTaskAgentOptions(selectedAgent) {
        const options = ['<option value="">Unassigned</option>'];
        const seen = new Set([""]);
        for (const agent of state.agents) {
          seen.add(agent.name);
          options.push(
            `<option value="${escapeHtml(agent.name)}" ${agent.name === (selectedAgent || "") ? "selected" : ""}>${escapeHtml(agent.name)} (${escapeHtml(agent.type)})</option>`,
          );
        }
        if (selectedAgent && !seen.has(selectedAgent)) {
          options.push(`<option value="${escapeHtml(selectedAgent)}" selected>${escapeHtml(selectedAgent)} (current)</option>`);
        }
        return options.join("");
      }

      function setTaskFeedback(taskId, kind, message) {
        if (!message) {
          delete state.taskFeedback[taskId];
          return;
        }
        state.taskFeedback[taskId] = { kind, message };
      }

      async function loadTaskComments(taskId) {
        try {
          state.taskComments[taskId] = await api(`/api/tasks/${taskId}/comments`);
          if (state.expandedTaskId === taskId) {
            renderTasks();
          }
        } catch (error) {
          state.taskComments[taskId] = [{ id: "error", body: error.message, created_at: null }];
          if (state.expandedTaskId === taskId) {
            renderTasks();
          }
        }
      }

      function sortTasks(tasks) {
        const list = [...tasks];
        list.sort((a, b) => {
          if (state.taskSort === "title_asc") {
            return String(a.title || "").localeCompare(String(b.title || ""));
          }
          if (state.taskSort === "priority_desc" || state.taskSort === "priority_asc") {
            const aWeight = PRIORITY_WEIGHT[a.priority] || 0;
            const bWeight = PRIORITY_WEIGHT[b.priority] || 0;
            return state.taskSort === "priority_desc" ? bWeight - aWeight : aWeight - bWeight;
          }
          const aMs = Date.parse(a.created_at || "") || 0;
          const bMs = Date.parse(b.created_at || "") || 0;
          return state.taskSort === "created_asc" ? aMs - bMs : bMs - aMs;
        });
        return list;
      }

      function getVisibleTasks() {
        const query = state.taskQuery.trim().toLowerCase();
        const filtered = query
          ? state.tasks.filter((task) =>
              [task.title, task.agent, task.status, task.priority]
                .filter(Boolean)
                .some((value) => String(value).toLowerCase().includes(query)),
            )
          : state.tasks;

        const sorted = sortTasks(filtered);
        state.filteredTasks = sorted;
        const totalPages = Math.max(1, Math.ceil(sorted.length / state.taskPageSize));
        if (state.taskPage > totalPages) {
          state.taskPage = totalPages;
        }
        const start = (state.taskPage - 1) * state.taskPageSize;
        const end = start + state.taskPageSize;
        return {
          pageItems: sorted.slice(start, end),
          totalItems: sorted.length,
          totalPages,
          startIndex: sorted.length === 0 ? 0 : start + 1,
          endIndex: Math.min(end, sorted.length),
        };
      }

      function renderTaskPagination(totalItems, totalPages, startIndex, endIndex) {
        const meta = document.getElementById("tasks-page-meta");
        const prev = document.getElementById("tasks-prev-page");
        const next = document.getElementById("tasks-next-page");
        if (meta) {
          if (totalItems === 0) {
            meta.textContent = "0 tasks";
          } else {
            meta.textContent = `${startIndex}-${endIndex} of ${totalItems} tasks`;
          }
        }
        if (prev) {
          prev.disabled = state.taskPage <= 1;
        }
        if (next) {
          next.disabled = state.taskPage >= totalPages;
        }
      }

      function renderTasks() {
        const tbody = document.getElementById("tasks-table");
        tbody.innerHTML = "";

        const { pageItems, totalItems, totalPages, startIndex, endIndex } = getVisibleTasks();
        renderTaskPagination(totalItems, totalPages, startIndex, endIndex);

        if (totalItems === 0) {
          tbody.innerHTML = '<tr><td colspan="5" class="px-4 py-6 text-center text-slate-400">No tasks found.</td></tr>';
          return;
        }

        for (const task of pageItems) {
          const tr = document.createElement("tr");
          tr.className = "cursor-pointer hover:bg-slate-800/70 row-interactive";
          tr.innerHTML = `
            <td class="px-4 py-3 font-medium">${escapeHtml(task.title)}</td>
            <td class="px-4 py-3"><span class="${badgeClass(STATUS_BADGE, task.status)}">${escapeHtml(titleCaseStatus(task.status))}</span></td>
            <td class="px-4 py-3">${escapeHtml(task.agent || "-")}</td>
            <td class="px-4 py-3"><span class="${badgeClass(PRIORITY_BADGE, task.priority)}">${escapeHtml(task.priority || "-")}</span></td>
            <td class="px-4 py-3 text-slate-300">${relativeTime(task.created_at)}</td>
          `;
          const onRowActivate = () => {
            state.expandedTaskId = state.expandedTaskId === task.id ? null : task.id;
            if (state.expandedTaskId === task.id && !state.taskComments[task.id]) {
              state.taskComments[task.id] = null;
              void loadTaskComments(task.id);
            }
            renderTasks();
          };
          tr.onclick = onRowActivate;
          makeRowKeyboardAccessible(tr, onRowActivate);
          tbody.appendChild(tr);

          const commentItems = state.taskComments[task.id];
          const commentsHtml = commentItems === null
            ? '<p class="text-sm text-slate-400">Loading updates...</p>'
            : Array.isArray(commentItems) && commentItems.length > 0
              ? commentItems.map((comment) => `
                  <div class="rounded-md border border-slate-700 bg-slate-900/80 p-3">
                    <div class="flex flex-wrap items-center gap-2 text-xs text-slate-400">
                      <span>${escapeHtml(comment.status ? titleCaseStatus(comment.status) : "Note")}</span>
                      <span>${escapeHtml(comment.reviewer ? `Reviewer: ${comment.reviewer}` : "No reviewer")}</span>
                      <span>${escapeHtml(comment.created_at ? formatTime(comment.created_at) : "-")}</span>
                    </div>
                    <p class="mt-2 text-sm text-slate-200 whitespace-pre-wrap">${escapeHtml(comment.body || "")}</p>
                  </div>
                `).join("")
              : '<p class="text-sm text-slate-400">No workflow notes yet.</p>';

          const statusOptionsHtml = TASK_STATUS_OPTIONS.map((status) => `
            <option value="${status}" ${task.status === status ? "selected" : ""}>${titleCaseStatus(status)}</option>
          `).join("");
          const agentOptionsHtml = buildTaskAgentOptions(task.agent);
          const feedback = state.taskFeedback[task.id];
          const feedbackHtml = feedback
            ? `<p class="task-feedback rounded-md border px-3 py-2 text-sm ${
                feedback.kind === "error"
                  ? "border-rose-800 bg-rose-950/60 text-rose-200"
                  : feedback.kind === "success"
                    ? "border-emerald-800 bg-emerald-950/60 text-emerald-200"
                    : "border-slate-700 bg-slate-950/60 text-slate-300"
              }">${escapeHtml(feedback.message)}</p>`
            : "";

          if (state.expandedTaskId === task.id) {
            const details = document.createElement("tr");
            details.innerHTML = `
              <td colspan="5" class="space-y-3 bg-slate-950/90 px-4 py-4">
                <div>
                  <p class="text-xs uppercase tracking-wide text-slate-400">Description</p>
                  <p class="mt-1 text-sm text-slate-200">${escapeHtml(task.description || "No description")}</p>
                </div>
                <div class="grid gap-3 lg:grid-cols-2">
                  <div>
                    <p class="text-xs uppercase tracking-wide text-slate-400">Stdout</p>
                    <pre class="mono mt-1 max-h-48 overflow-auto rounded-md border border-slate-700 bg-black/40 p-3 text-xs text-emerald-200">${escapeHtml(task.stdout || "")}</pre>
                  </div>
                  <div>
                    <p class="text-xs uppercase tracking-wide text-slate-400">Stderr</p>
                    <pre class="mono mt-1 max-h-48 overflow-auto rounded-md border border-slate-700 bg-black/40 p-3 text-xs text-rose-200">${escapeHtml(task.stderr || "")}</pre>
                  </div>
                </div>
                <div class="grid gap-2 text-sm text-slate-300 sm:grid-cols-2 lg:grid-cols-3">
                  <p><span class="text-slate-400">Reviewer:</span> ${escapeHtml(task.reviewer || "-")}</p>
                  <p><span class="text-slate-400">Commit:</span> ${escapeHtml(task.commit_hash || "-")}</p>
                  <p><span class="text-slate-400">Started:</span> ${escapeHtml(task.started_at || "-")}</p>
                  <p><span class="text-slate-400">Completed:</span> ${escapeHtml(task.completed_at || "-")}</p>
                </div>
                <form class="task-update-form grid gap-3 rounded-lg border border-slate-700 bg-slate-900/70 p-4" data-task-id="${task.id}">
                  <div class="grid gap-3 md:grid-cols-3">
                    <label class="text-sm text-slate-300">
                      <span class="text-xs uppercase tracking-wide text-slate-400">Status</span>
                      <select name="status" class="mt-1 w-full rounded-md border border-slate-600 bg-slate-950 px-3 py-2">${statusOptionsHtml}</select>
                    </label>
                    <label class="text-sm text-slate-300">
                      <span class="text-xs uppercase tracking-wide text-slate-400">Assignee</span>
                      <select name="agent" class="mt-1 w-full rounded-md border border-slate-600 bg-slate-950 px-3 py-2">${agentOptionsHtml}</select>
                    </label>
                    <label class="text-sm text-slate-300">
                      <span class="text-xs uppercase tracking-wide text-slate-400">Reviewer</span>
                      <input name="reviewer" value="${escapeHtml(task.reviewer || "")}" placeholder="Optional unless sending to review" class="mt-1 w-full rounded-md border border-slate-600 bg-slate-950 px-3 py-2" />
                    </label>
                  </div>
                  <label class="text-sm text-slate-300">
                    <span class="text-xs uppercase tracking-wide text-slate-400">Note</span>
                    <textarea name="comment" rows="3" placeholder="Explain the status change or handoff" class="mt-1 w-full rounded-md border border-slate-600 bg-slate-950 px-3 py-2"></textarea>
                  </label>
                  <div class="flex flex-wrap gap-2">
                    <button class="btn btn-primary btn-sm" type="submit">Save update</button>
                    <button class="task-reassign-button btn btn-secondary btn-sm" type="button" data-task-id="${task.id}" data-current-agent="${escapeHtml(task.agent || "")}">Reassign task</button>
                    <button class="task-note-button btn btn-ghost btn-sm" type="button" data-task-id="${task.id}">Add note only</button>
                    ${task.status === "failed" || task.status === "cancelled" ? `<button class="task-retry-button btn btn-success btn-sm" type="button" data-task-id="${task.id}">Retry</button>` : ""}
                  </div>
                  ${feedbackHtml}
                </form>
                <div class="space-y-3">
                  <p class="text-xs uppercase tracking-wide text-slate-400">Workflow Notes</p>
                  ${commentsHtml}
                </div>
              </td>
            `;
            tbody.appendChild(details);
          }
        }

        tbody.querySelectorAll(".task-update-form").forEach((form) => {
          form.onsubmit = async (event) => {
            event.preventDefault();
            const taskId = form.dataset.taskId;
            const formData = new FormData(form);
            const status = formData.get("status");
            const agent = formData.get("agent");
            const reviewer = formData.get("reviewer");
            const comment = formData.get("comment");
            try {
              setTaskFeedback(taskId, "info", "Saving task update...");
              renderTasks();
              const body = {
                status,
                agent: agent ? String(agent).trim() || null : null,
                reviewer: reviewer ? String(reviewer).trim() || null : null,
              };
              if (comment && String(comment).trim()) {
                body.comment = String(comment).trim();
              }
              await api(`/api/tasks/${taskId}`, {
                method: "PATCH",
                body: JSON.stringify(body),
              });
              setTaskFeedback(taskId, "success", "Task update saved.");
              state.taskComments[taskId] = null;
              await Promise.all([loadTasks(), loadTaskComments(taskId)]);
            } catch (error) {
              setTaskFeedback(taskId, "error", error.message);
              renderTasks();
            }
          };
        });

        tbody.querySelectorAll(".task-reassign-button").forEach((button) => {
          button.onclick = async () => {
            const taskId = button.dataset.taskId;
            const currentAgent = button.dataset.currentAgent || "";
            const form = button.closest(".task-update-form");
            const formData = new FormData(form);
            const nextAgent = String(formData.get("agent") || "").trim();
            const reviewer = String(formData.get("reviewer") || "").trim();
            const comment = String(formData.get("comment") || "").trim();

            if (nextAgent === currentAgent) {
              setTaskFeedback(taskId, "error", "Choose a different assignee or Unassigned before reassigning.");
              renderTasks();
              return;
            }

            try {
              setTaskFeedback(taskId, "info", nextAgent ? `Reassigning to ${nextAgent}...` : "Removing the current assignee...");
              renderTasks();
              const body = {
                agent: nextAgent || null,
                reviewer: reviewer || null,
              };
              if (comment) {
                body.comment = comment;
              }
              await api(`/api/tasks/${taskId}`, {
                method: "PATCH",
                body: JSON.stringify(body),
              });
              setTaskFeedback(taskId, "success", nextAgent ? `Task reassigned to ${nextAgent}.` : "Task is now unassigned.");
              state.taskComments[taskId] = null;
              await Promise.all([loadTasks(), loadTaskComments(taskId)]);
            } catch (error) {
              setTaskFeedback(taskId, "error", error.message);
              renderTasks();
            }
          };
        });

        tbody.querySelectorAll(".task-note-button").forEach((button) => {
          button.onclick = async () => {
            const taskId = button.dataset.taskId;
            const form = button.closest(".task-update-form");
            const formData = new FormData(form);
            const comment = String(formData.get("comment") || "").trim();
            if (!comment) {
              setTaskFeedback(taskId, "error", "Note is required.");
              renderTasks();
              return;
            }
            try {
              await api(`/api/tasks/${taskId}/comments`, {
                method: "POST",
                body: JSON.stringify({
                  body: comment,
                }),
              });
              setTaskFeedback(taskId, "success", "Note added.");
              state.taskComments[taskId] = null;
              await Promise.all([loadTasks(), loadTaskComments(taskId)]);
            } catch (error) {
              setTaskFeedback(taskId, "error", error.message);
              renderTasks();
            }
          };
        });

        tbody.querySelectorAll(".task-retry-button").forEach((button) => {
          button.onclick = async () => {
            const taskId = button.dataset.taskId;
            try {
              setTaskFeedback(taskId, "info", "Requeuing task...");
              renderTasks();
              await api(`/api/tasks/${taskId}/retry`, { method: "POST" });
              setTaskFeedback(taskId, "success", "Task requeued for retry.");
              state.taskComments[taskId] = null;
              await Promise.all([loadTasks(), loadTaskComments(taskId)]);
            } catch (error) {
              setTaskFeedback(taskId, "error", error.message);
              renderTasks();
            }
          };
        });
      }

      function resetAgentForm() {
        document.getElementById("agent-id").value = "";
        document.getElementById("agent-name").value = "";
        document.getElementById("agent-type").value = "";
        document.getElementById("agent-command").value = "";
        document.getElementById("agent-active").checked = true;
        document.getElementById("agent-heartbeat-cron").value = "";
        document.getElementById("agent-heartbeat-repo").value = "";
        document.getElementById("agent-heartbeat-prompt").value = "";
        document.getElementById("agent-heartbeat-enabled").checked = false;
        document.getElementById("agent-form-title").textContent = "Add Agent";
      }

      function bindKeyboardShortcuts() {
        if (typeof document.addEventListener !== "function") return;
        document.addEventListener("keydown", (event) => {
          const tagName = event && event.target && event.target.tagName ? String(event.target.tagName).toLowerCase() : "";
          if (tagName === "input" || tagName === "textarea" || tagName === "select") return;

          const key = event.key ? String(event.key).toLowerCase() : "";
          if (key === "n") {
            event.preventDefault();
            openDialog("task-modal", "#task-title");
            return;
          }
          if (key === "/") {
            event.preventDefault();
            const search = document.getElementById("tasks-search");
            if (search && typeof search.focus === "function") {
              search.focus();
            }
            return;
          }

          if (!event.shiftKey || key !== "g") return;
          const map = { t: "tasks", r: "runs", a: "agents", p: "projects", y: "timeline" };
          const followUp = (nextEvent) => {
            const followKey = nextEvent.key ? String(nextEvent.key).toLowerCase() : "";
            const view = map[followKey];
            if (view) {
              nextEvent.preventDefault();
              openView(view);
            }
            if (typeof document.removeEventListener === "function") {
              document.removeEventListener("keydown", followUp);
            }
          };
          document.addEventListener("keydown", followUp, { once: true });
        });
      }

      document.getElementById("open-task-modal").onclick = () => openDialog("task-modal", "#task-title");
      document.getElementById("close-task-modal").onclick = () => closeDialog("task-modal");
      document.getElementById("reset-agent-form").onclick = resetAgentForm;

      document.getElementById("task-form").onsubmit = async (event) => {
        event.preventDefault();
        const titleEl = document.getElementById("task-title");
        const repoEl = document.getElementById("task-repo");
        clearInlineError(titleEl);
        clearInlineError(repoEl);

        const title = String(titleEl.value || "").trim();
        const repoUrl = String(repoEl.value || "").trim();
        if (!title) {
          setInlineError(titleEl, "Task title is required.");
          return;
        }
        if (repoUrl) {
          try {
            new URL(repoUrl);
          } catch {
            setInlineError(repoEl, "Repository URL must be a valid URL.");
            return;
          }
        }

        const body = {
          title,
          description: document.getElementById("task-description").value || null,
          agent: document.getElementById("task-agent").value || null,
          repo_url: repoUrl || null,
          priority: document.getElementById("task-priority").value,
        };

        try {
          await api("/api/tasks", { method: "POST", body: JSON.stringify(body) });
          document.getElementById("task-form").reset();
          closeDialog("task-modal");
          await loadTasks();
          showToast("Task created.", "success");
        } catch (error) {
          showToast(error.message, "error");
        }
      };

      document.getElementById("agent-form").onsubmit = async (event) => {
        event.preventDefault();

        const nameEl = document.getElementById("agent-name");
        const typeEl = document.getElementById("agent-type");
        const commandEl = document.getElementById("agent-command");
        clearInlineError(nameEl);
        clearInlineError(typeEl);
        clearInlineError(commandEl);

        if (!String(nameEl.value || "").trim()) {
          setInlineError(nameEl, "Agent name is required.");
          return;
        }
        if (!String(typeEl.value || "").trim()) {
          setInlineError(typeEl, "Agent type is required.");
          return;
        }
        if (!String(commandEl.value || "").trim()) {
          setInlineError(commandEl, "Command template is required.");
          return;
        }

        const id = document.getElementById("agent-id").value;
        const body = {
          name: String(nameEl.value || "").trim(),
          type: String(typeEl.value || "").trim(),
          command_template: String(commandEl.value || "").trim(),
          active: document.getElementById("agent-active").checked ? 1 : 0,
          heartbeat_cron: document.getElementById("agent-heartbeat-cron").value || null,
          heartbeat_repo: document.getElementById("agent-heartbeat-repo").value || null,
          heartbeat_prompt: document.getElementById("agent-heartbeat-prompt").value || null,
          heartbeat_enabled: document.getElementById("agent-heartbeat-enabled").checked ? 1 : 0,
        };

        try {
          if (id) {
            await api(`/api/agents/${id}`, { method: "PATCH", body: JSON.stringify(body) });
          } else {
            await api("/api/agents", { method: "POST", body: JSON.stringify(body) });
          }
          resetAgentForm();
          await loadAgents();
          showToast(id ? "Agent updated." : "Agent created.", "success");
        } catch (error) {
          showToast(error.message, "error");
        }
      };

      document.getElementById("scan-projects").onclick = async () => {
        const btn = document.getElementById("scan-projects");
        btn.disabled = true;
        btn.textContent = "Scanning...";
        try {
          const result = await api("/api/projects/scan", { method: "POST" });
          state.projects = result.projects;
          renderProjects();
          showToast(`Found ${result.total} projects (${result.inserted} new)`, "success");
        } catch (error) {
          showToast(error.message, "error");
        } finally {
          btn.disabled = false;
          btn.textContent = "Scan Machine";
        }
      };

      document.getElementById("open-project-form").onclick = () => {
        document.getElementById("project-form-panel").classList.remove("hidden");
      };
      document.getElementById("cancel-project-form").onclick = () => {
        document.getElementById("project-form-panel").classList.add("hidden");
        document.getElementById("project-form").reset();
      };

      document.getElementById("project-form").onsubmit = async (event) => {
        event.preventDefault();
        const nameEl = document.getElementById("project-name");
        const pathEl = document.getElementById("project-path");
        clearInlineError(nameEl);
        clearInlineError(pathEl);

        const projectName = String(nameEl.value || "").trim();
        const projectPath = String(pathEl.value || "").trim();
        if (!projectName) {
          setInlineError(nameEl, "Project name is required.");
          return;
        }
        if (!projectPath) {
          setInlineError(pathEl, "Project path is required.");
          return;
        }
        const body = {
          name: projectName,
          path: projectPath,
          description: document.getElementById("project-description").value || null,
        };
        try {
          await api("/api/projects", { method: "POST", body: JSON.stringify(body) });
          document.getElementById("project-form").reset();
          document.getElementById("project-form-panel").classList.add("hidden");
          await loadProjects();
          showToast("Project saved.", "success");
        } catch (error) {
          showToast(error.message, "error");
        }
      };

      document.querySelectorAll(".view-tab").forEach((el) => {
        el.onclick = () => openView(el.dataset.view || "tasks", { syncHistory: true, replaceHistory: false });
      });

      setInterval(() => {
        if (!document.getElementById("tasks-view").classList.contains("hidden")) {
          renderTasks();
        }
      }, 30000);

      // --- Hire Agent flow ---
      document.getElementById("open-hire-modal").onclick = async () => {
        const content = document.getElementById("hire-modal-content");
        document.getElementById("hire-modal-title").textContent = "Hire Agent";
        content.innerHTML = `
          <div class="flex items-center justify-center py-12">
            <div class="text-center">
              <div class="inline-block h-8 w-8 animate-spin rounded-full border-2 border-slate-400 border-t-emerald-400 mb-3"></div>
              <p class="text-sm text-slate-300">Asking Claude to suggest candidates...</p>
            </div>
          </div>`;
        openDialog("hire-modal");

        try {
          const data = await api("/api/agents/generate-personas", { method: "POST" });
          renderPersonaCards(data.personas);
        } catch (error) {
          content.innerHTML = `
            <div class="rounded-md border border-rose-700 bg-rose-900/30 p-4 text-sm text-rose-200">
              Failed to generate personas: ${escapeHtml(error.message)}
            </div>`;
        }
      };

      document.getElementById("close-hire-modal").onclick = () => closeDialog("hire-modal");

      function renderPersonaCards(personas) {
        const content = document.getElementById("hire-modal-content");
        let html = '<div class="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">';
        for (const p of personas) {
          html += `
            <div class="rounded-lg border border-slate-700 bg-slate-800/60 p-4 flex flex-col items-center text-center hover:border-emerald-600 transition-colors">
              <img src="${escapeHtml(p.avatarUrl)}" alt="${escapeHtml(p.name)}" class="h-20 w-20 rounded-full mb-3" />
              <p class="font-semibold text-sm">${escapeHtml(p.name)}</p>
              <p class="mt-1 text-xs text-slate-400 line-clamp-3" style="display:-webkit-box;-webkit-line-clamp:3;-webkit-box-orient:vertical;overflow:hidden">${escapeHtml(p.description)}</p>
              <button class="hire-choose btn btn-success btn-xs mt-3" data-name="${escapeHtml(p.name)}" data-avatar="${escapeHtml(p.avatarUrl)}" data-desc="${escapeHtml(p.description)}">Choose</button>
            </div>`;
        }
        html += '</div>';
        content.innerHTML = html;

        content.querySelectorAll(".hire-choose").forEach((btn) => {
          btn.onclick = () => hireAgent(btn.dataset.name, btn.dataset.avatar, btn.dataset.desc);
        });
      }

      async function hireAgent(name, avatarUrl, description) {
        const content = document.getElementById("hire-modal-content");
        content.innerHTML = `
          <div class="flex items-center justify-center py-12">
            <div class="text-center">
              <div class="inline-block h-8 w-8 animate-spin rounded-full border-2 border-slate-400 border-t-emerald-400 mb-3"></div>
              <p class="text-sm text-slate-300">Generating ${escapeHtml(name)}'s soul document...</p>
            </div>
          </div>`;

        try {
          await api("/api/agents/hire", {
            method: "POST",
            body: JSON.stringify({ name, avatarUrl, description, role: "ceo" }),
          });
          closeDialog("hire-modal");
          await loadAgents();
          showHireToast(`Welcome, ${name}!`);
        } catch (error) {
          content.innerHTML = `
            <div class="rounded-md border border-rose-700 bg-rose-900/30 p-4 text-sm text-rose-200">
              Failed to hire agent: ${escapeHtml(error.message)}
            </div>`;
        }
      }

      function showHireToast(message) {
        showToast(message, "success", 4000);
      }

      (async function init() {
        renderStatusTabs();
        bindTaskTableControls();
        bindKeyboardShortcuts();
        window.addEventListener("popstate", () => {
          openView(pathToView(window.location.pathname), { syncHistory: false });
        });
        openView(pathToView(window.location.pathname), { syncHistory: false, replaceHistory: true });
        await loadAgents();
        await loadTasks();
      })();
