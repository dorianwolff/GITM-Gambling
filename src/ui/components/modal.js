/**
 * modal.js
 * Generic modal mounted on #modal-root.
 */
import { h } from '../../utils/dom.js';

export function openModal({ title, body, actions = [] }) {
  const root = document.getElementById('modal-root');
  if (!root) return () => {};
  root.style.pointerEvents = 'auto';

  const close = () => {
    overlay.remove();
    if (!root.children.length) root.style.pointerEvents = 'none';
  };

  const overlay = h(
    'div.fixed.inset-0.flex.items-center.justify-center.bg-black/60.backdrop-blur-md.p-4.opacity-0.transition-opacity',
    {
      onclick: (e) => {
        if (e.target === overlay) close();
      },
    },
    [
      h('div.glass.neon-border.max-w-md.w-full.p-6.flex.flex-col.gap-4', {}, [
        title ? h('h2.text-xl.font-semibold.heading-grad', {}, [title]) : null,
        h('div.text-sm.text-white/80', {}, body ?? ''),
        h(
          'div.flex.justify-end.gap-2.pt-2',
          {},
          actions.map((a) =>
            h(
              `button.${a.variant === 'primary' ? 'btn-primary' : 'btn-ghost'}`,
              { onclick: async () => (a.onClick ? (await a.onClick(close)) : close()) },
              [a.label]
            )
          )
        ),
      ]),
    ]
  );
  root.appendChild(overlay);
  requestAnimationFrame(() => overlay.classList.remove('opacity-0'));

  const onKey = (e) => {
    if (e.key === 'Escape') close();
  };
  document.addEventListener('keydown', onKey, { once: true });

  return close;
}

export function confirmModal({ title, message, confirmLabel = 'Confirm', danger = false }) {
  return new Promise((resolve) => {
    openModal({
      title,
      body: message,
      actions: [
        { label: 'Cancel', onClick: (close) => (close(), resolve(false)) },
        {
          label: confirmLabel,
          variant: danger ? 'danger' : 'primary',
          onClick: (close) => (close(), resolve(true)),
        },
      ],
    });
  });
}
