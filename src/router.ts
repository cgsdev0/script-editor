type RouteHandler = (params: Record<string, string>) => void;

interface Route {
  pattern: string;
  handler: RouteHandler;
  regex: RegExp;
  paramNames: string[];
}

const routes: Route[] = [];
let cleanup: (() => void) | null = null;

export function onCleanup(fn: () => void) {
  cleanup = fn;
}

export function route(pattern: string, handler: RouteHandler) {
  const paramNames: string[] = [];
  const regexStr = pattern.replace(/:([^/]+)/g, (_match, name) => {
    paramNames.push(name);
    return "([^/]+)";
  });
  routes.push({
    pattern,
    handler,
    regex: new RegExp(`^${regexStr}$`),
    paramNames,
  });
}

export function navigate(path: string) {
  history.pushState(null, "", path);
  resolve();
}

export function resolve() {
  if (cleanup) {
    cleanup();
    cleanup = null;
  }

  const path = location.pathname || "/";

  for (const r of routes) {
    const match = path.match(r.regex);
    if (match) {
      const params: Record<string, string> = {};
      r.paramNames.forEach((name, i) => {
        params[name] = decodeURIComponent(match[i + 1]);
      });
      r.handler(params);
      return;
    }
  }
}

window.addEventListener("popstate", () => resolve());
