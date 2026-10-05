// Tree layout, computed in abstract (breadth, depth) coordinates and mapped to
// screen axes at the end, so both orientations share the same code:
//   lr: depth grows to the right, siblings stacked vertically (one row per leaf)
//   td: depth grows downwards, siblings side by side
(function (root) {
  'use strict';
  const HTNV = root.HTNV = root.HTNV || {};

  const FONT = 'system-ui, -apple-system, "Segoe UI", Roboto, sans-serif';
  const M = {
    font: FONT,
    nameFont: `600 12px ${FONT}`,
    argsFont: `11px ${FONT}`,
    methodFont: `italic 11px ${FONT}`,
    padX: 9, accent: 4, maxW: 250, minW: 30,
    h: { full: 40, nameOnly: 26, method: 22, methodLine: 14 },
    gap: { lr: { breadth: 6, depth: 34 }, td: { breadth: 10, depth: 44 } },
  };

  let ctx2d = null;
  const widthCache = new Map();
  function textWidth(text, font) {
    const key = font + '|' + text;
    if (!widthCache.has(key)) {
      ctx2d = ctx2d || document.createElement('canvas').getContext('2d');
      ctx2d.font = font;
      widthCache.set(key, ctx2d.measureText(text).width);
    }
    return widthCache.get(key);
  }

  // The tree actually drawn: technical actions filtered out, collapsed
  // subtrees cut, and methods optionally merged into their task.
  //   VNode { node, children, hiddenCount, methodName }
  function visibleTree(plan, { methodsAsNodes, showTechnical, isCollapsed }) {
    const keep = c => showTechnical || !c.technical;
    function count(n) { return n.children.filter(keep).reduce((s, c) => s + 1 + count(c), 0); }
    return (function visit(node) {
      const v = { node, children: [], hiddenCount: 0, methodName: null };
      let kids = node.children;
      if (!methodsAsNodes && node.kind === 'task' && node.method) {
        v.methodName = node.method.name;
        kids = node.method.children;
      }
      kids = kids.filter(keep);
      if (kids.length && isCollapsed(node)) {
        v.hiddenCount = kids.reduce((s, c) => s + 1 + count(c), 0);
        return v;
      }
      v.children = kids.map(visit);
      return v;
    })(plan.root);
  }

  function argsText(node) { return node.args.join(' '); }

  function measure(v) {
    const n = v.node;
    const isAction = n.kind === 'action';
    if (n.kind === 'method') {
      v.w = Math.min(M.maxW, Math.max(M.minW, textWidth(n.name, M.methodFont) + 2 * M.padX + (n.children.length ? 0 : 16)));
      v.h = M.h.method;
      return;
    }
    const w = Math.max(textWidth(n.name, M.nameFont),
      n.args.length ? textWidth(argsText(n), M.argsFont) : 0,
      v.methodName ? textWidth('via ' + v.methodName, M.methodFont) : 0);
    v.w = Math.min(M.maxW, Math.max(M.minW, w + 2 * M.padX + (isAction ? M.accent : 0)));
    v.h = (n.args.length ? M.h.full : M.h.nameOnly) + (v.methodName ? M.h.methodLine : 0);
  }

  function layout(vroot, orientation) {
    const lr = orientation === 'lr';
    const gap = M.gap[orientation];
    const all = [];
    (function walk(v, depth) {
      v.depth = depth;
      measure(v);
      all.push(v);
      v.children.forEach(c => walk(c, depth + 1));
    })(vroot, 0);
    const bSize = v => (lr ? v.h : v.w);
    const dSize = v => (lr ? v.w : v.h);

    // Breadth: leaves packed in order. Parents sit on their first child's row
    // in lr (outline style: a chain reads as a sentence) and are centred over
    // their children in td. Children shift when a parent is larger than them.
    (function place(v) {
      if (!v.children.length) { v.width = bSize(v); v.rel = v.width / 2; return; }
      let x = 0;
      v.children.forEach(c => { place(c); c.offset = x; x += c.width + gap.breadth; });
      const first = v.children[0], last = v.children[v.children.length - 1];
      let center = lr ? first.offset + first.rel : (first.offset + first.rel + last.offset + last.rel) / 2;
      const shift = Math.max(0, bSize(v) / 2 - center);
      v.children.forEach(c => { c.offset += shift; });
      center += shift;
      v.rel = center;
      v.width = Math.max(x - gap.breadth + shift, center + bSize(v) / 2);
    })(vroot);
    (function assign(v, base) {
      v.b = base + v.rel;
      v.children.forEach(c => assign(c, base + c.offset));
    })(vroot, 0);

    // Depth: chained after the parent in lr (compact columns), per level in td
    // (aligned rows).
    if (lr) {
      (function chain(v, start) {
        v.d = start + dSize(v) / 2;
        v.children.forEach(c => chain(c, start + dSize(v) + gap.depth));
      })(vroot, 0);
    } else {
      const extent = [];
      all.forEach(v => { extent[v.depth] = Math.max(extent[v.depth] || 0, dSize(v)); });
      const startOf = [0];
      extent.forEach((e, i) => { startOf[i + 1] = startOf[i] + e + gap.depth; });
      all.forEach(v => { v.d = startOf[v.depth] + extent[v.depth] / 2; });
    }

    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    all.forEach(v => {
      v.x = lr ? v.d : v.b;
      v.y = lr ? v.b : v.d;
      x0 = Math.min(x0, v.x - v.w / 2); x1 = Math.max(x1, v.x + v.w / 2);
      y0 = Math.min(y0, v.y - v.h / 2); y1 = Math.max(y1, v.y + v.h / 2);
    });
    const edges = [];
    all.forEach(v => v.children.forEach(c => edges.push({ from: v, to: c })));
    return { nodes: all, edges, orientation, bounds: { x0, y0, x1, y1 } };
  }

  HTNV.layout = { visibleTree, layout, textWidth, metrics: M };
})(typeof window !== 'undefined' ? window : globalThis);
