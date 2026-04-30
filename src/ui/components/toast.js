/**
 * toast.js
 * Lightweight toast notifications. Mounted on #toast-root.
 */
import { h } from '../../utils/dom.js';

const ROOT = () => document.getElementById('toast-root');

const COLORS = {
  info: 'border-white/15 bg-white/[0.07]',
  success: 'border-accent-lime/40 bg-accent-lime/10 text-accent-lime',
  error: 'border-accent-rose/40 bg-accent-rose/10 text-accent-rose',
  warn: 'border-accent-amber/40 bg-accent-amber/10 text-accent-amber',
};

export function toast(message, { type = 'info', duration = 3500 } = {}) {
  const root = ROOT();
  if (!root) return;

  const node = h(
    `div.pointer-events-auto.glass.px-4.py-3.text-sm.font-medium.shadow-glow.translate-x-4.opacity-0.transition-all.duration-300.border.${COLORS[type] ?? COLORS.info}`,
    {},
    [message]
  );
  root.appendChild(node);

  requestAnimationFrame(() => {
    node.classList.remove('translate-x-4', 'opacity-0');
  });

  const remove = () => {
    node.classList.add('translate-x-4', 'opacity-0');
    setTimeout(() => node.remove(), 300);
  };
  setTimeout(remove, duration);
  node.addEventListener('click', remove);
  return remove;
}

export const toastSuccess = (m, o) => toast(m, { ...o, type: 'success' });
export const toastError = (m, o) => toast(m, { ...o, type: 'error' });
export const toastWarn = (m, o) => toast(m, { ...o, type: 'warn' });
