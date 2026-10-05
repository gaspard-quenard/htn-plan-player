// Tiny DOM helpers. File contents are only ever inserted as text, never as HTML.
(function (root) {
  'use strict';
  const HTNV = root.HTNV = root.HTNV || {};
  const SVG_NS = 'http://www.w3.org/2000/svg';

  function apply(node, attrs, children) {
    for (const [k, v] of Object.entries(attrs || {})) {
      if (v === undefined || v === null || v === false) continue;
      if (k === 'text') node.textContent = v;
      else if (k === 'on') Object.entries(v).forEach(([ev, fn]) => node.addEventListener(ev, fn));
      else if (k === 'dataset') Object.assign(node.dataset, v);
      else if (k === 'class') node.setAttribute('class', v);
      else node.setAttribute(k, v === true ? '' : v);
    }
    children.flat(Infinity).forEach(c => {
      if (c === null || c === undefined || c === false) return;
      node.appendChild(typeof c === 'string' || typeof c === 'number' ? document.createTextNode(String(c)) : c);
    });
    return node;
  }

  const el = (tag, attrs, ...children) => apply(document.createElement(tag), attrs, children);
  const svg = (tag, attrs, ...children) => apply(document.createElementNS(SVG_NS, tag), attrs, children);
  // Like Node.append, but skips null/false and flattens arrays.
  const append = (node, ...children) => apply(node, null, children);
  const clear = node => { while (node.firstChild) node.removeChild(node.firstChild); return node; };

  HTNV.dom = { el, svg, clear, append };
})(typeof window !== 'undefined' ? window : globalThis);
