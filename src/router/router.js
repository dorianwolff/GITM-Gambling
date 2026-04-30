/**
 * router.js
 * Tiny hash-free History API router with parameter matching and guards.
 *
 * Usage:
 *   const router = createRouter([{ path: '/events/:id', render: ctx => ... }]);
 *   router.start(document.getElementById('app'));
 */
import { logger } from '../lib/logger.js';

function compile(path) {
  const keys = [];
  const re = new RegExp(
    '^' +
      path
        .replace(/\/$/, '')
        .replace(/\/:([\w-]+)/g, (_, k) => {
          keys.push(k);
          return '/([^/]+)';
        }) +
      '/?$'
  );
  return { re, keys };
}

export function createRouter(routes) {
  const compiled = routes.map((r) => ({ ...r, ...compile(r.path) }));
  let outlet = null;
  let cleanups = [];

  function match(pathname) {
    for (const r of compiled) {
      const m = pathname.match(r.re);
      if (m) {
        const params = {};
        r.keys.forEach((k, i) => (params[k] = decodeURIComponent(m[i + 1])));
        return { route: r, params };
      }
    }
    return null;
  }

  function ctx(params) {
    return {
      params,
      query: Object.fromEntries(new URLSearchParams(window.location.search)),
      navigate,
      onCleanup: (fn) => cleanups.push(fn),
    };
  }

  async function render() {
    // If a render is requested before start() (e.g. an auth-state callback
    // fires during bootstrap), no-op — start() will trigger the first render.
    if (!outlet) return;
    cleanups.forEach((fn) => {
      try {
        fn();
      } catch (e) {
        logger.warn('cleanup error', e);
      }
    });
    cleanups = [];

    const m = match(window.location.pathname);
    if (!m) {
      outlet.innerHTML = `<div class="p-10 text-center text-muted">404 — page not found.</div>`;
      return;
    }
    const c = ctx(m.params);
    let result;
    try {
      result = await m.route.render(c);
    } catch (e) {
      logger.error('route render error', e);
      outlet.innerHTML = `<div class="p-10 text-center text-accent-rose">Something went wrong.</div>`;
      return;
    }
    if (result == null) return; // guard handled (e.g. redirected)
    if (result instanceof Node) {
      outlet.replaceChildren(result);
      result.classList?.add('page-enter');
    } else if (typeof result === 'string' || result?.html) {
      outlet.innerHTML = typeof result === 'string' ? result : result.html;
    }
    window.scrollTo({ top: 0 });
  }

  function navigate(to, { replace = false } = {}) {
    if (to === window.location.pathname + window.location.search) return;
    if (replace) history.replaceState({}, '', to);
    else history.pushState({}, '', to);
    render();
  }

  function start(rootEl) {
    outlet = rootEl;
    window.addEventListener('popstate', render);
    document.addEventListener('click', interceptLinks);
    render();
  }

  function interceptLinks(ev) {
    const a = ev.target.closest('a[data-link]');
    if (!a) return;
    const href = a.getAttribute('href');
    if (!href || href.startsWith('http') || a.target === '_blank') return;
    ev.preventDefault();
    navigate(href);
  }

  return { start, navigate, render };
}
