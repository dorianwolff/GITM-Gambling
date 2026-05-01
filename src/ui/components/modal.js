/**
 * modal.js
 * Generic modal mounted on #modal-root.
 *
 * Exposes:
 *   - openModal({ title, body, actions, size, onClose })
 *       Low-level primitive. `actions` is an array of
 *         { label, variant: 'primary'|'ghost'|'danger', onClick(close) }
 *       The modal is mobile-first: full-width on phones with bottom-sheet
 *       styling, centered card on >= sm. Escape + backdrop tap close it.
 *       Returns a `close()` function the caller can invoke programmatically.
 *
 *   - confirmModal({ title, message, confirmLabel, danger })
 *       Promise<boolean>. Replaces `window.confirm`.
 *
 *   - promptModal({ title, message, placeholder, defaultValue,
 *                    type, min, max, step, confirmLabel, validate })
 *       Promise<string | null>. Replaces `window.prompt`. Returns the
 *       entered value on confirm, `null` on cancel. `validate(value)`
 *       runs before resolving; return a string to show an inline error
 *       and keep the modal open, or null/undefined to accept.
 */
import { h } from '../../utils/dom.js';

// Modal sizes. `sm` fits short messages, `md` is the default, `lg` is for
// content-heavy modals (item lookup etc.).
const SIZE_CLASS = {
  sm: 'max-w-sm',
  md: 'max-w-md',
  lg: 'max-w-lg',
};

export function openModal({ title, body, actions = [], size = 'md', onClose }) {
  const root = document.getElementById('modal-root');
  if (!root) return () => {};
  root.style.pointerEvents = 'auto';

  // Lock body scroll while modal is open so the page behind doesn't
  // visibly jitter, especially on iOS where viewport resizes hit.
  const prevOverflow = document.body.style.overflow;
  document.body.style.overflow = 'hidden';

  let closed = false;
  const close = () => {
    if (closed) return;
    closed = true;
    overlay.classList.add('opacity-0');
    // Let the fade-out finish before removing from the DOM.
    setTimeout(() => {
      overlay.remove();
      if (!root.children.length) root.style.pointerEvents = 'none';
      document.body.style.overflow = prevOverflow;
      document.removeEventListener('keydown', onKey);
      if (typeof onClose === 'function') onClose();
    }, 120);
  };

  const actionBar = actions.length
    ? h(
        'div.flex.flex-col-reverse.sm:flex-row.sm:justify-end.gap-2.pt-2',
        {},
        actions.map((a) =>
          h(
            `button.${variantClass(a.variant)}.h-11.px-5.w-full.sm:w-auto`,
            {
              onclick: async (ev) => {
                ev.preventDefault();
                if (a.onClick) await a.onClick(close);
                else close();
              },
            },
            [a.label]
          )
        )
      )
    : null;

  const card = h(
    [
      // Mobile: bottom-sheet styling (full width, rounded top). Desktop:
      // centered card. We use a single element with responsive classes to
      // keep the DOM small.
      'div.w-full',
      SIZE_CLASS[size] ?? SIZE_CLASS.md,
      // Solid background so nothing behind shows through (requested
      // explicitly by the user; our old `glass` was too transparent on
      // phones).
      'bg-bg-900.border.border-white/10.rounded-t-2xl.sm:rounded-2xl',
      'shadow-2xl.shadow-black/70.p-5.sm:p-6.flex.flex-col.gap-4',
      'translate-y-4.sm:translate-y-0.transition-transform.duration-150',
    ].join('.'),
    { onclick: (e) => e.stopPropagation() },
    [
      title ? h('h2.text-lg.sm:text-xl.font-semibold.heading-grad', {}, [title]) : null,
      body != null ? h('div.text-sm.text-white/80.flex.flex-col.gap-3', {}, body) : null,
      actionBar,
    ]
  );

  const overlay = h(
    // End-align on mobile (bottom sheet), center on >= sm. Backdrop is
    // opaque enough to clearly separate modal from page.
    'div.fixed.inset-0.z-50.flex.items-end.sm:items-center.justify-center.bg-black/70.backdrop-blur-md.p-0.sm:p-4.opacity-0.transition-opacity.duration-150',
    {
      onclick: (e) => {
        if (e.target === overlay) close();
      },
    },
    [card]
  );
  root.appendChild(overlay);
  // Animate in on the next frame so the browser actually paints the
  // starting state before we transition.
  requestAnimationFrame(() => {
    overlay.classList.remove('opacity-0');
    card.classList.remove('translate-y-4');
  });

  const onKey = (e) => {
    if (e.key === 'Escape') close();
  };
  document.addEventListener('keydown', onKey);

  return close;
}

function variantClass(v) {
  if (v === 'primary') return 'btn-primary';
  if (v === 'danger')  return 'btn-danger';
  return 'btn-ghost';
}

export function confirmModal({
  title,
  message,
  confirmLabel = 'Confirm',
  cancelLabel = 'Cancel',
  danger = false,
}) {
  return new Promise((resolve) => {
    const body = message
      ? [h('p.text-sm.text-white/80.leading-relaxed', {}, [message])]
      : [];
    openModal({
      title,
      body,
      actions: [
        { label: cancelLabel, onClick: (close) => { close(); resolve(false); } },
        {
          label: confirmLabel,
          variant: danger ? 'danger' : 'primary',
          onClick: (close) => { close(); resolve(true); },
        },
      ],
      onClose: () => resolve(false),
    });
  });
}

/**
 * Mobile-friendly prompt. Resolves to the trimmed input string, or null on
 * cancel. Numeric mode (`type: 'number'`) uses inputmode="numeric" so
 * phones show the digit pad.
 */
export function promptModal({
  title,
  message,
  placeholder = '',
  defaultValue = '',
  type = 'text',
  min,
  max,
  step,
  confirmLabel = 'Confirm',
  cancelLabel = 'Cancel',
  validate,
}) {
  return new Promise((resolve) => {
    const input = h(
      'input.w-full.h-12.px-3.rounded-xl.bg-white/[0.06].border.border-white/15.text-base.text-white.placeholder-white/40.focus:outline-none.focus:border-accent-cyan/70.focus:bg-white/[0.08]',
      {
        type: type === 'number' ? 'text' : type, // keep parseInt control ourselves
        inputmode: type === 'number' ? 'numeric' : undefined,
        autocomplete: 'off',
        autocapitalize: 'off',
        spellcheck: 'false',
        placeholder,
        value: defaultValue ?? '',
      },
      []
    );
    const errEl = h('p.text-xs.text-accent-rose.min-h-[1em]', {}, ['']);

    const confirm = (close) => {
      const raw = (input.value ?? '').trim();
      if (!raw) {
        errEl.textContent = 'Please enter a value.';
        return;
      }
      if (type === 'number') {
        const n = Number(raw);
        if (!Number.isFinite(n)) { errEl.textContent = 'Must be a number.'; return; }
        if (min != null && n < min) { errEl.textContent = `Must be at least ${min}.`; return; }
        if (max != null && n > max) { errEl.textContent = `Must be at most ${max}.`; return; }
        if (step != null && Math.round(n / step) * step !== n) {
          errEl.textContent = `Must be a multiple of ${step}.`;
          return;
        }
      }
      if (typeof validate === 'function') {
        const msg = validate(raw);
        if (msg) { errEl.textContent = msg; return; }
      }
      close();
      resolve(raw);
    };

    // Enter submits; shift+enter inserts a newline if we ever move to
    // textarea. Works for <input> where newlines are impossible anyway.
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        confirm(() => closeRef.close && closeRef.close());
      }
    });

    const body = [];
    if (message) body.push(h('p.text-sm.text-white/80.leading-relaxed', {}, [message]));
    body.push(input, errEl);

    const closeRef = {};
    closeRef.close = openModal({
      title,
      body,
      actions: [
        { label: cancelLabel, onClick: (close) => { close(); resolve(null); } },
        {
          label: confirmLabel,
          variant: 'primary',
          onClick: (close) => confirm(close),
        },
      ],
      // Cancel via backdrop / escape resolves to null.
      onClose: () => resolve(null),
    });

    // Focus the input once the modal is painted. iOS Safari needs a
    // microtask delay or the keyboard won't pop up.
    setTimeout(() => input.focus({ preventScroll: true }), 60);
  });
}
