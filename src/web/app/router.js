const VIEW_TO_PATH = {
  tasks: "/",
  agents: "/agents",
  runs: "/runs",
  projects: "/projects",
  timeline: "/timeline",
  approvals: "/approvals",
};

export function pathToView(pathname) {
  const normalizedPath = String(pathname || "/").replace(/\/+$/, "") || "/";
  for (const [view, path] of Object.entries(VIEW_TO_PATH)) {
    if (path === normalizedPath) {
      return view;
    }
  }

  return "tasks";
}

export function viewToPath(view) {
  return VIEW_TO_PATH[view] || "/";
}

export function syncViewUrl(view, options = {}) {
  const { replace = false } = options;
  const nextPath = viewToPath(view);
  const currentPath = window.location.pathname;

  if (currentPath === nextPath) {
    return;
  }

  const url = new URL(window.location.href);
  url.pathname = nextPath;

  if (replace) {
    window.history.replaceState({}, "", url);
  } else {
    window.history.pushState({}, "", url);
  }
}
