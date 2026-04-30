/**
 * app-shell.js
 * Renders the page within the navbar + container layout.
 * Used by every authenticated page render function.
 */
import { h } from '../../utils/dom.js';
import { createNavbar } from '../components/navbar.js';

export function appShell(content, { wide = false } = {}) {
  const nav = createNavbar();
  const container = h(
    `main.${wide ? 'max-w-[1400px]' : 'max-w-6xl'}.mx-auto.px-4.py-8.flex.flex-col.gap-6`,
    {},
    [content]
  );

  const root = h('div.min-h-screen.flex.flex-col', {}, [
    nav.el,
    container,
    h('footer.text-center.text-xs.text-muted.py-8', {}, [
      'GITM · social credit gambling · no real money · made for fun ',
      h('span.text-accent-cyan', {}, ['◆']),
    ]),
  ]);

  // dispose nav when the root is detached
  const obs = new MutationObserver(() => {
    if (!document.body.contains(root)) {
      nav.dispose();
      obs.disconnect();
    }
  });
  obs.observe(document.body, { childList: true, subtree: true });

  return root;
}
