/**
 * dom.js
 * Minimal DOM helpers (we don't pull in a framework).
 */

/**
 * Create an element with attributes and children.
 * @param {string} tag - tag name, can include "tag.cls1.cls2#id"
 * @param {Object} [props] - attributes / event listeners (on*)
 * @param {Array<Node|string>} [children]
 * @returns {HTMLElement}
 */
export function h(tag, props = {}, children = []) {
  const { tagName, className, id } = parseSelector(tag);
  const el = document.createElement(tagName);
  if (className) el.className = className;
  if (id) el.id = id;

  for (const [key, value] of Object.entries(props || {})) {
    if (value == null || value === false) continue;
    if (key === 'class' || key === 'className') {
      el.className = (el.className ? el.className + ' ' : '') + value;
    } else if (key === 'style' && typeof value === 'object') {
      Object.assign(el.style, value);
    } else if (key === 'dataset' && typeof value === 'object') {
      Object.assign(el.dataset, value);
    } else if (key.startsWith('on') && typeof value === 'function') {
      el.addEventListener(key.slice(2).toLowerCase(), value);
    } else if (key === 'html') {
      el.innerHTML = value;
    } else if (typeof value === 'boolean') {
      if (value) el.setAttribute(key, '');
    } else {
      el.setAttribute(key, String(value));
    }
  }

  appendChildren(el, children);
  return el;
}

function parseSelector(tag) {
  // Tag name = leading letters/digits/dashes. Rest = sequence of
  // .className or #id segments. Class names may contain Tailwind
  // characters: `/` (opacity modifiers), `[` `]` (arbitrary values),
  // `:` (variants), `%`, `,`, etc. — anything except `.` or `#`.
  const tagMatch = tag.match(/^([a-zA-Z][\w-]*)/);
  const tagName = tagMatch ? tagMatch[1] : 'div';
  const rest = tag.slice(tagMatch ? tagMatch[1].length : 0);
  const classes = [];
  let id;
  // Split keeping leading delimiter, e.g. ".foo.bar/40#x" -> [".foo", ".bar/40", "#x"]
  for (const seg of rest.split(/(?=[.#])/)) {
    if (!seg) continue;
    if (seg[0] === '.') classes.push(seg.slice(1));
    else if (seg[0] === '#') id = seg.slice(1);
  }
  return { tagName, className: classes.join(' '), id };
}

function appendChildren(el, children) {
  if (children == null) return;
  if (!Array.isArray(children)) children = [children];
  for (const c of children) {
    if (c == null || c === false) continue;
    if (Array.isArray(c)) appendChildren(el, c);
    else if (c instanceof Node) el.appendChild(c);
    else el.appendChild(document.createTextNode(String(c)));
  }
}

export function clear(node) {
  while (node.firstChild) node.removeChild(node.firstChild);
}

export function mount(parent, child) {
  clear(parent);
  if (child) parent.appendChild(child);
}

export function on(target, event, handler, opts) {
  target.addEventListener(event, handler, opts);
  return () => target.removeEventListener(event, handler, opts);
}
