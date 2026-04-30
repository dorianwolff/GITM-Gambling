/**
 * store.js
 * Tiny pub/sub store factory. Reactive without a framework.
 */

export function createStore(initial = {}) {
  let state = { ...initial };
  const listeners = new Set();

  function get() {
    return state;
  }

  function set(patch) {
    const next = typeof patch === 'function' ? patch(state) : { ...state, ...patch };
    if (next === state) return;
    state = next;
    for (const fn of listeners) {
      try {
        fn(state);
      } catch (e) {
        console.error('[store] listener error', e);
      }
    }
  }

  function subscribe(fn) {
    listeners.add(fn);
    return () => listeners.delete(fn);
  }

  return { get, set, subscribe };
}
