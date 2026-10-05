// Action timeline: one block per primitive action, placed by its schedule
// interval [start, end), with overlapping actions on separate lanes. A
// sequential plan gives a single row; a parallel or temporal schedule gives
// several lanes without any change here.
(function (root) {
  'use strict';
  const HTNV = root.HTNV = root.HTNV || {};
  const { el, clear } = HTNV.dom;

  const MIN_BLOCK = 112; // pixels for the shortest action
  const LANE_H = 40;
  const AXIS_H = 18;

  class TimelineView {
    // handlers: onPick(action)
    constructor(container, handlers) {
      this.h = handlers;
      this.scroll = el('div', { class: 'tl-scroll' });
      this.inner = el('div', { class: 'tl-inner' });
      this.scroll.appendChild(this.inner);
      container.appendChild(this.scroll);
      this.blocks = new Map(); // action id -> element
      // A vertical wheel scrolls the timeline sideways.
      this.scroll.addEventListener('wheel', e => {
        if (Math.abs(e.deltaY) > Math.abs(e.deltaX)) { e.preventDefault(); this.scroll.scrollLeft += e.deltaY; }
      }, { passive: false });
    }

    render(model, { showTechnical }) {
      clear(this.inner);
      this.blocks.clear();
      if (!model) return;
      const actions = model.plan.actions.filter(a => showTechnical || !a.technical);
      const { lanes, laneOf } = HTNV.schedule.assignLanes(actions);
      const { timePoints: points, temporal } = model.schedule;
      const end = points[points.length - 1];
      // Scale so that the shortest action stays readable.
      const shortest = actions.reduce((m, a) => Math.min(m, a.end - a.start), Infinity);
      const unit = this.unit = Math.max(4, Math.min(128, MIN_BLOCK / (isFinite(shortest) ? shortest : 1)));
      this.inner.style.width = `${end * unit + 16}px`;
      this.inner.style.height = `${AXIS_H + lanes * LANE_H}px`;

      // Axis: step numbers for sequential plans; times for timed plans (one
      // tick per time unit, thinned out when units are narrow).
      if (temporal) {
        const every = Math.ceil(40 / unit);
        for (let t = 0; t <= end; t += every) {
          this.inner.appendChild(el('span', { class: 'tl-tick', style: `left:${t * unit + 8}px`, text: String(t) }));
        }
      } else {
        points.slice(0, -1).forEach((t, k) => {
          this.inner.appendChild(el('span', { class: 'tl-tick', style: `left:${t * unit + 8}px`, text: String(k + 1) }));
        });
      }
      actions.forEach(a => {
        const block = el('div', {
          class: 'tl-block',
          style: `left:${a.start * unit + 8}px; width:${(a.end - a.start) * unit - 4}px; top:${AXIS_H + laneOf.get(a) * LANE_H}px`,
          title: (temporal ? `t = ${a.start} → ${a.end}` : `Step ${a.execIndex + 1}`) + `: ${[a.name].concat(a.args).join(' ')}` +
            (a.issues.length ? '\n⚠ ' + a.issues.join('\n⚠ ') : ''),
          on: { click: () => this.h.onPick(a) },
        }, el('span', { class: 'tl-name', text: a.name }), a.args.length ? el('span', { class: 'tl-args', text: a.args.join(' ') }) : null);
        this.inner.appendChild(block);
        this.blocks.set(a.id, { block, action: a });
      });
      this.playhead = el('div', { class: 'tl-playhead' });
      this.inner.appendChild(this.playhead);
    }

    // ctx: { time, currentIds, selectedId, matches(node) | null, follow }
    update(ctx) {
      if (!this.playhead) return;
      this.scroll.classList.toggle('highlighting', Boolean(ctx.matches));
      for (const { block, action } of this.blocks.values()) {
        const cls = ['tl-block', 's-' + HTNV.schedule.status(action, ctx.time)];
        if (ctx.currentIds.has(action.id)) cls.push('current');
        if (action.id === ctx.selectedId) cls.push('sel');
        if (ctx.matches && ctx.matches(action)) cls.push('hl');
        if (action.issues.length) cls.push('issue');
        block.className = cls.join(' ');
      }
      const x = ctx.time * this.unit + 8;
      this.playhead.style.left = `${x - 2}px`;
      if (ctx.follow) {
        const { scrollLeft, clientWidth } = this.scroll;
        if (x < scrollLeft + 40 || x + MIN_BLOCK > scrollLeft + clientWidth - 40) {
          this.scroll.scrollTo({ left: x - clientWidth / 3, behavior: ctx.animate === false ? 'auto' : 'smooth' });
        }
      }
    }
  }

  HTNV.TimelineView = TimelineView;
})(typeof window !== 'undefined' ? window : globalThis);
