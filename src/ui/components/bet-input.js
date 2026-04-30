/**
 * bet-input.js
 * Reusable bet amount input with quick-action buttons (½, 2×, max).
 */
import { h } from '../../utils/dom.js';
import { LIMITS } from '../../config/constants.js';
import { userStore } from '../../state/user-store.js';

/**
 * @param {{value:number, onChange:(n:number)=>void, max?:number}} opts
 */
export function createBetInput({ value = 10, onChange, max } = {}) {
  let current = value;
  const input = h('input.input.text-center.font-mono.text-lg', {
    type: 'number',
    min: String(LIMITS.MIN_BET),
    max: String(LIMITS.MAX_BET),
    step: '1',
    value: String(current),
  });

  const set = (n) => {
    const lim = Math.min(max ?? Infinity, LIMITS.MAX_BET, userStore.get().profile?.credits ?? Infinity);
    n = Math.max(LIMITS.MIN_BET, Math.min(lim, Math.floor(Number(n) || 0)));
    current = n;
    input.value = String(n);
    onChange?.(n);
  };

  input.addEventListener('input', () => set(input.value));

  const btn = (label, fn) =>
    h('button.btn-ghost.px-3.py-2.text-xs.font-semibold', { onclick: fn, type: 'button' }, [label]);

  const row = h('div.flex.items-center.gap-2', {}, [
    btn('½', () => set(Math.floor(current / 2))),
    btn('2×', () => set(current * 2)),
    btn('Max', () => set(userStore.get().profile?.credits ?? LIMITS.MAX_BET)),
  ]);

  const wrap = h('div.flex.flex-col.gap-2', {}, [
    h('label.text-xs.text-muted.uppercase.tracking-widest', {}, ['Bet']),
    input,
    row,
  ]);

  set(current);
  return { el: wrap, get: () => current, set };
}
