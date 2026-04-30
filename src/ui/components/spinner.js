/**
 * spinner.js
 */
import { h } from '../../utils/dom.js';

export function spinner(size = 24) {
  const s = `${size}px`;
  return h(
    'div.inline-block.align-middle',
    {
      style: {
        width: s,
        height: s,
        borderRadius: '50%',
        border: '2px solid rgba(255,255,255,0.15)',
        borderTopColor: '#22e1ff',
        animation: 'spin 0.7s linear infinite',
      },
    },
    []
  );
}

if (typeof document !== 'undefined' && !document.getElementById('spin-kf')) {
  const style = document.createElement('style');
  style.id = 'spin-kf';
  style.textContent = '@keyframes spin{to{transform:rotate(360deg)}}';
  document.head.appendChild(style);
}
