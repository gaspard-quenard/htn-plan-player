// SVG rendering of a layout, with pan/zoom and a camera that can follow nodes.
// Elements are keyed by node id and reused between renders, so CSS transitions
// animate nodes to their new place when the layout changes.
(function (root) {
  'use strict';
  const HTNV = root.HTNV = root.HTNV || {};
  const { svg } = HTNV.dom;
  const { metrics: M, textWidth } = HTNV.layout;

  const KIND_LABEL = { task: 'Abstract task', method: 'Method', action: 'Action', root: 'Initial task network', missing: 'Missing node' };

  function truncate(text, font, maxWidth) {
    if (textWidth(text, font) <= maxWidth) return text;
    let lo = 0, hi = text.length;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (textWidth(text.slice(0, mid) + '…', font) <= maxWidth) lo = mid; else hi = mid - 1;
    }
    return text.slice(0, lo) + '…';
  }

  class TreeView {
    // handlers: onSelect(node), onToggle(node), onObject(name)
    constructor(container, handlers) {
      this.handlers = handlers;
      this.svg = svg('svg', { class: 'tree-svg' });
      this.svg.style.fontFamily = M.font;
      this.viewport = svg('g');
      this.edgeLayer = svg('g', { class: 'edges' });
      this.nodeLayer = svg('g', { class: 'nodes' });
      this.viewport.append(this.edgeLayer, this.nodeLayer);
      this.svg.appendChild(this.viewport);
      container.appendChild(this.svg);
      this.cam = { x: 40, y: 40, k: 1 };
      this.nodeEls = new Map();
      this.edgeEls = new Map();
      this.layout = null;
      this.installPanZoom();
    }

    // ---- rendering -------------------------------------------------------

    render(layout) {
      this.layout = layout;
      this.byId = new Map(layout.nodes.map(v => [v.node.id, v]));
      const seen = new Set();
      layout.nodes.forEach(v => {
        seen.add(v.node.id);
        let g = this.nodeEls.get(v.node.id);
        if (!g) {
          g = svg('g', { dataset: { id: v.node.id } });
          g.addEventListener('click', e => this.onNodeClick(e, v.node.id));
          g.addEventListener('dblclick', e => { e.stopPropagation(); this.handlers.onToggle(this.byId.get(v.node.id).node); });
          this.nodeLayer.appendChild(g);
          this.nodeEls.set(v.node.id, g);
        }
        this.drawNode(g, v, layout.orientation);
      });
      for (const [id, g] of this.nodeEls) if (!seen.has(id)) { g.remove(); this.nodeEls.delete(id); }

      const seenEdges = new Set();
      layout.edges.forEach(({ from, to }) => {
        const key = to.node.id;
        seenEdges.add(key);
        let p = this.edgeEls.get(key);
        if (!p) { p = svg('path', { class: 'edge' }); this.edgeLayer.appendChild(p); this.edgeEls.set(key, p); }
        p.setAttribute('d', this.edgePath(from, to, layout.orientation));
      });
      for (const [id, p] of this.edgeEls) if (!seenEdges.has(id)) { p.remove(); this.edgeEls.delete(id); }
    }

    edgePath(a, b, orientation) {
      if (orientation === 'lr') {
        const x1 = a.x + a.w / 2, x2 = b.x - b.w / 2, mx = (x1 + x2) / 2;
        return `M${x1},${a.y} C${mx},${a.y} ${mx},${b.y} ${x2},${b.y}`;
      }
      const y1 = a.y + a.h / 2, y2 = b.y - b.h / 2, my = (y1 + y2) / 2;
      return `M${a.x},${y1} C${a.x},${my} ${b.x},${my} ${b.x},${y2}`;
    }

    drawNode(g, v, orientation) {
      const n = v.node;
      const { w, h } = v;
      const empty = n.kind === 'method' && n.children.length === 0;
      g.style.transform = `translate(${v.x}px, ${v.y}px)`;
      g.dataset.kind = n.kind;
      while (g.firstChild) g.removeChild(g.firstChild);

      const rx = n.kind === 'method' ? h / 2 : n.kind === 'action' ? 3 : 8;
      g.appendChild(svg('rect', { class: 'ring', x: -w / 2 - 4, y: -h / 2 - 4, width: w + 8, height: h + 8, rx: rx + 4 }));
      g.appendChild(svg('rect', { class: 'box' + (empty ? ' empty' : ''), x: -w / 2, y: -h / 2, width: w, height: h, rx }));
      let left = -w / 2 + M.padX;
      if (n.kind === 'action') {
        g.appendChild(svg('rect', { class: 'accent', x: -w / 2, y: -h / 2, width: M.accent, height: h, rx: 1.5 }));
        left += M.accent;
      }
      const inner = w - 2 * M.padX - (n.kind === 'action' ? M.accent : 0);

      if (n.kind === 'method') {
        const label = truncate(n.name, M.methodFont, inner - (empty ? 16 : 0));
        g.appendChild(svg('text', { class: 'method-name', x: empty ? -8 : 0, y: 4, 'text-anchor': 'middle', text: label }));
        if (empty) g.appendChild(svg('text', { class: 'empty-mark', x: w / 2 - M.padX - 4, y: 4, 'text-anchor': 'middle', text: '∅' }));
      } else {
        const lines = 1 + (n.args.length ? 1 : 0) + (v.methodName ? 1 : 0);
        let y = -((lines - 1) * 14) / 2 + 4;
        g.appendChild(svg('text', { class: 'name', x: left, y, text: truncate(n.name, M.nameFont, inner) }));
        if (n.args.length) {
          y += 14;
          const t = svg('text', { class: 'args', x: left, y });
          let used = 0;
          for (const a of n.args) {
            const piece = (used ? ' ' : '') + a;
            const pw = textWidth(piece, M.argsFont);
            if (used + pw > inner) { t.appendChild(svg('tspan', { text: ' …' })); break; }
            if (used) t.appendChild(document.createTextNode(' '));
            const span = svg('tspan', { class: 'arg', dataset: { obj: a }, text: a });
            t.appendChild(span);
            used += pw;
          }
          g.appendChild(t);
        }
        if (v.methodName) {
          y += 14;
          g.appendChild(svg('text', { class: 'via', x: left, y, text: truncate('via ' + v.methodName, M.methodFont, inner) }));
        }
      }

      if (v.hiddenCount) {
        const bx = orientation === 'lr' ? w / 2 + 14 : 0;
        const by = orientation === 'lr' ? 0 : h / 2 + 12;
        const label = '+' + v.hiddenCount;
        const bw = textWidth(label, M.argsFont) + 10;
        const badge = svg('g', { class: 'badge', transform: `translate(${bx},${by})` },
          svg('rect', { x: -bw / 2, y: -8, width: bw, height: 16, rx: 8 }),
          svg('text', { y: 4, 'text-anchor': 'middle', text: label }));
        badge.addEventListener('click', e => { e.stopPropagation(); this.handlers.onToggle(n); });
        g.appendChild(badge);
      }
      if (n.issues.length) {
        g.appendChild(svg('g', { class: 'issue-mark', transform: `translate(${w / 2},${-h / 2})` },
          svg('circle', { r: 7 }), svg('text', { y: 4, 'text-anchor': 'middle', text: '!' })));
      }
      const full = [n.name].concat(n.args).join(' ');
      g.appendChild(svg('title', { text: `${KIND_LABEL[n.kind] || n.kind}: ${full}` +
        (v.methodName ? `\nvia ${v.methodName}` : '') + (n.issues.length ? '\n⚠ ' + n.issues.join('\n⚠ ') : '') }));
    }

    // Updates classes only (cheap: called at every step).
    //   ctx: { time, currentIds:Set, pathIds:Set, selectedId, matches(node) | null }
    updateClasses(ctx) {
      this.svg.classList.toggle('highlighting', Boolean(ctx.matches));
      for (const [id, g] of this.nodeEls) {
        const n = this.byId.get(id).node;
        const cls = ['n', 'k-' + n.kind, 's-' + HTNV.schedule.status(n, ctx.time)];
        if (ctx.currentIds.has(id)) cls.push('current');
        if (ctx.pathIds.has(id)) cls.push('onpath');
        if (id === ctx.selectedId) cls.push('sel');
        if (ctx.matches && ctx.matches(n)) cls.push('hl');
        if (n.issues.length) cls.push('issue');
        if (this.byId.get(id).hiddenCount) cls.push('collapsed');
        g.setAttribute('class', cls.join(' '));
      }
      for (const [id, p] of this.edgeEls) {
        const n = this.byId.get(id).node;
        const cls = ['edge', 'e-' + HTNV.schedule.status(n, ctx.time)];
        if (ctx.pathIds.has(id)) cls.push('onpath');
        if (ctx.matches && ctx.matches(n)) cls.push('hl');
        p.setAttribute('class', cls.join(' '));
      }
    }

    onNodeClick(e, id) {
      if (this.suppressClick) return;
      e.stopPropagation();
      const obj = e.target.dataset && e.target.dataset.obj;
      if (obj) this.handlers.onObject(obj);
      else this.handlers.onSelect(this.byId.get(id).node);
    }

    // ---- camera ----------------------------------------------------------

    applyCam() {
      const { x, y, k } = this.cam;
      this.viewport.setAttribute('transform', `translate(${x},${y}) scale(${k})`);
    }

    animateTo(target, duration = 380) {
      cancelAnimationFrame(this.anim);
      const from = Object.assign({}, this.cam);
      const t0 = performance.now();
      const step = now => {
        const p = Math.min(1, (now - t0) / duration);
        const e = p < 0.5 ? 2 * p * p : 1 - Math.pow(-2 * p + 2, 2) / 2;
        ['x', 'y', 'k'].forEach(key => { this.cam[key] = from[key] + (target[key] - from[key]) * e; });
        this.applyCam();
        if (p < 1) this.anim = requestAnimationFrame(step);
      };
      this.anim = requestAnimationFrame(step);
    }

    size() { const r = this.svg.getBoundingClientRect(); return { W: r.width || 800, H: r.height || 600 }; }

    fit(animate = true) {
      if (!this.layout) return;
      const { x0, y0, x1, y1 } = this.layout.bounds;
      const { W, H } = this.size();
      const k = Math.max(0.05, Math.min(1.2, (W - 60) / (x1 - x0), (H - 60) / (y1 - y0)));
      const target = { k, x: W / 2 - ((x0 + x1) / 2) * k, y: H / 2 - ((y0 + y1) / 2) * k };
      if (animate) this.animateTo(target); else { this.cam = target; this.applyCam(); }
      return k;
    }

    // Initial view of a big tree: the root in the top-left corner (lr) or top
    // centre (td), at a readable zoom.
    showStart(k) {
      const r = this.layout.nodes[0];
      const { W } = this.size();
      const x = this.layout.orientation === 'lr' ? 30 - (r.x - r.w / 2) * k : W / 2 - r.x * k;
      this.cam = { k, x, y: 30 - (r.y - r.h / 2) * k };
      this.applyCam();
    }

    // Centres a node; with onlyIfOutside, only when it left the comfortable
    // middle part of the view (avoids constant motion while playing).
    focusNode(id, { onlyIfOutside = false, animate = true, k } = {}) {
      const v = this.byId && this.byId.get(id);
      if (!v) return;
      const { W, H } = this.size();
      const kk = k || this.cam.k;
      if (onlyIfOutside) {
        const sx = this.cam.x + v.x * this.cam.k, sy = this.cam.y + v.y * this.cam.k;
        const halfW = (v.w * this.cam.k) / 2, halfH = (v.h * this.cam.k) / 2;
        if (sx - halfW > W * 0.12 && sx + halfW < W * 0.88 && sy - halfH > H * 0.15 && sy + halfH < H * 0.85) return;
      }
      const target = { k: kk, x: W / 2 - v.x * kk, y: H / 2 - v.y * kk };
      if (animate) this.animateTo(target); else { this.cam = target; this.applyCam(); }
    }

    zoomBy(factor, px, py) {
      const { W, H } = this.size();
      if (px === undefined) { px = W / 2; py = H / 2; }
      const k = Math.max(0.05, Math.min(3, this.cam.k * factor));
      this.cam.x = px - ((px - this.cam.x) * k) / this.cam.k;
      this.cam.y = py - ((py - this.cam.y) * k) / this.cam.k;
      this.cam.k = k;
      this.applyCam();
    }

    installPanZoom() {
      const s = this.svg;
      s.addEventListener('wheel', e => {
        e.preventDefault();
        cancelAnimationFrame(this.anim);
        const r = s.getBoundingClientRect();
        if (e.ctrlKey || !e.shiftKey) this.zoomBy(Math.exp(-e.deltaY * (e.ctrlKey ? 0.01 : 0.0015)), e.clientX - r.left, e.clientY - r.top);
        else { this.cam.x -= e.deltaY; this.applyCam(); }
      }, { passive: false });
      let drag = null;
      s.addEventListener('pointerdown', e => {
        if (e.button !== 0) return;
        cancelAnimationFrame(this.anim);
        drag = { x: e.clientX, y: e.clientY, cx: this.cam.x, cy: this.cam.y, moved: false, id: e.pointerId };
      });
      s.addEventListener('pointermove', e => {
        if (!drag) return;
        const dx = e.clientX - drag.x, dy = e.clientY - drag.y;
        if (!drag.moved && Math.hypot(dx, dy) > 4) { drag.moved = true; s.setPointerCapture(drag.id); s.classList.add('panning'); }
        if (drag.moved) { this.cam.x = drag.cx + dx; this.cam.y = drag.cy + dy; this.applyCam(); }
      });
      const end = () => {
        if (drag && drag.moved) { this.suppressClick = true; setTimeout(() => { this.suppressClick = false; }, 0); }
        drag = null;
        s.classList.remove('panning');
      };
      s.addEventListener('pointerup', end);
      s.addEventListener('pointercancel', end);
      s.addEventListener('click', () => { if (!this.suppressClick) this.handlers.onSelect(null); });
    }
  }

  HTNV.TreeView = TreeView;
})(typeof window !== 'undefined' ? window : globalThis);
