// Side and bottom panels: breadcrumb (why is this action happening?), details
// of the selected node (definition, evaluated preconditions, effects) and the
// world state at the current step.
(function (root) {
  'use strict';
  const HTNV = root.HTNV = root.HTNV || {};
  const { el, svg, clear, append } = HTNV.dom;
  const { status } = HTNV.schedule;

  const KIND = { task: 'Abstract task', method: 'Method', action: 'Action', root: 'Task network', missing: 'Missing' };
  const STATUS = { done: 'Done', active: 'In progress', future: 'Upcoming' };

  // "pred a b" with clickable object names.
  function factEl(text, onObject, cls) {
    const [pred, ...args] = text.split(' ');
    return el('span', { class: 'fact ' + (cls || '') }, el('span', { class: 'pred', text: pred }),
      args.map(a => [' ', objEl(a, onObject)]));
  }
  function objEl(name, onObject) {
    if (name[0] === '?') return el('span', { class: 'var', text: name });
    return el('button', { class: 'obj', text: name, title: `Highlight everything involving ${name}`, on: { click: e => { e.stopPropagation(); onObject(name); } } });
  }
  function section(title, ...content) {
    return el('section', { class: 'sec' }, el('h4', { text: title }), ...content);
  }
  // When a node happens: steps for sequential plans, times for timed plans.
  function whenText(n, temporal) {
    if (temporal) {
      return n.start === n.end ? `no action (empty decomposition), at t = ${n.start}` : `from t = ${n.start} to t = ${n.end}`;
    }
    if (n.start === n.end) return `no action (empty decomposition), ${n.start === 0 ? 'before step 1' : `after step ${n.start}`}`;
    return n.end - n.start === 1 ? `step ${n.start + 1}` : `steps ${n.start + 1}–${n.end}`;
  }
  function orderCaption(network) {
    if (network.totallyOrdered) return 'Done one after the other, in this order.';
    if (network.ordering.length) return 'An arrow means "must be finished before". Subtasks not linked by arrows may be done in any order, even interleaved.';
    return 'No ordering constraint: the subtasks may be done in any order, even interleaved.';
  }

  function nodeStatus(n, time, currentIds) {
    if (currentIds.has(n.id)) return { cls: 'now', text: 'Executing now' };
    const s = status(n, time);
    return { cls: s, text: STATUS[s] };
  }

  // Ordering constraints of a task network as a small top-down graph. Each
  // subtask sits on the row given by its longest chain of predecessors, and
  // arrows show the required precedences (redundant ones removed). Subtasks
  // not linked by arrows may happen in any order, even interleaved.
  //   items: [{ id, label, cls, onClick }]    pairs: [[idBefore, idAfter], ...]
  let diagramCount = 0;
  function orderDiagram(items, pairs) {
    const font = `11.5px ${HTNV.layout.metrics.font}`;
    const W = 340, H = 24, GAP_X = 10, GAP_Y = 22;
    const ids = items.map(i => i.id);
    const next = new Map(ids.map(id => [id, new Set()]));
    pairs.forEach(([a, b]) => { if (next.has(a) && next.has(b) && a !== b) next.get(a).add(b); });
    const reach = new Map(ids.map(id => [id, new Set()]));
    const visit = (from, id) => next.get(id).forEach(n => { if (!reach.get(from).has(n)) { reach.get(from).add(n); visit(from, n); } });
    ids.forEach(id => visit(id, id));
    const edges = [];
    next.forEach((succ, a) => succ.forEach(b => {
      if (![...succ].some(c => c !== b && reach.get(c).has(b))) edges.push([a, b]);
    }));
    const level = new Map();
    const levelOf = id => {
      if (level.has(id)) return level.get(id);
      level.set(id, 0); // guards against cycles
      const l = Math.max(0, ...ids.filter(p => next.get(p).has(id)).map(p => levelOf(p) + 1));
      level.set(id, l);
      return l;
    };
    const rows = [];
    items.forEach(it => { const l = levelOf(it.id); (rows[l] = rows[l] || []).push(it); });

    const pos = new Map();
    rows.forEach((row, r) => {
      const maxW = Math.min(230, (W - (row.length - 1) * GAP_X) / row.length);
      row.forEach(it => {
        let label = it.label;
        while (label.length > 1 && HTNV.layout.textWidth(label, font) > maxW - 16) label = label.slice(0, -2) + '…';
        it.text = label;
        it.w = Math.min(maxW, HTNV.layout.textWidth(label, font) + 16);
      });
      let x = (W - row.reduce((sum, it) => sum + it.w, 0) - (row.length - 1) * GAP_X) / 2;
      row.forEach(it => { pos.set(it.id, { x, y: r * (H + GAP_Y), w: it.w }); x += it.w + GAP_X; });
    });

    const marker = 'ord-arrow-' + (++diagramCount);
    const height = rows.length * (H + GAP_Y) - GAP_Y;
    const root = svg('svg', { class: 'order-svg', width: W, height: height + 2, viewBox: `0 -1 ${W} ${height + 2}` },
      svg('defs', {}, svg('marker', { id: marker, viewBox: '0 0 10 10', refX: 9, refY: 5, markerWidth: 7, markerHeight: 7, orient: 'auto-start-reverse' },
        svg('path', { class: 'ord-head', d: 'M0,0 L10,5 L0,10 z' }))));
    root.style.fontFamily = HTNV.layout.metrics.font;
    edges.forEach(([a, b]) => {
      const p = pos.get(a), q = pos.get(b);
      const x1 = p.x + p.w / 2, y1 = p.y + H, x2 = q.x + q.w / 2, y2 = q.y - 1, my = (y1 + y2) / 2;
      root.appendChild(svg('path', { class: 'ord-edge', d: `M${x1},${y1} C${x1},${my} ${x2},${my} ${x2},${y2}`, 'marker-end': `url(#${marker})` }));
    });
    items.forEach(it => {
      const p = pos.get(it.id);
      const g = svg('g', { class: 'ord st-' + it.cls + (it.onClick ? ' clickable' : ''), transform: `translate(${p.x},${p.y})` },
        svg('rect', { width: p.w, height: H, rx: 6 }),
        svg('text', { x: p.w / 2, y: 16, 'text-anchor': 'middle', text: it.text }),
        svg('title', { text: it.label }));
      if (it.onClick) g.addEventListener('click', it.onClick);
      root.appendChild(g);
    });
    return el('div', { class: 'order' }, root);
  }

  // ---------------------------------------------------------------- breadcrumb

  class Breadcrumb {
    constructor(container, handlers) { this.el = container; this.h = handlers; }

    render(model, time, current) {
      clear(this.el);
      if (!model) return;
      if (!current.length) {
        this.el.appendChild(el('span', { class: 'crumb-end', text: time === 0 ? 'Empty plan' : `✓ Plan complete: all ${model.plan.actions.length} actions executed` }));
        return;
      }
      const path = HTNV.plan.ancestors(current[0]);
      path.forEach((n, i) => {
        if (i) this.el.appendChild(el('span', { class: 'sep', text: '›' }));
        this.el.appendChild(el('button', {
          class: 'crumb k-' + n.kind + (i === path.length - 1 ? ' last' : ''),
          title: `${KIND[n.kind]}: ${[n.name].concat(n.args).join(' ')}`,
          text: n.kind === 'method' ? n.name : [n.name].concat(n.args).join(' '),
          on: { click: () => this.h.onSelect(n, true) },
        }));
      });
      if (current.length > 1) this.el.appendChild(el('span', { class: 'more', text: ` (+${current.length - 1} in parallel)` }));
      this.el.scrollLeft = this.el.scrollWidth; // the current action matters most
    }
  }

  // ------------------------------------------------------------------- details

  class DetailsPanel {
    // handlers: onSelect(node, center), onObject(obj), onStep(k)
    constructor(container, handlers) { this.el = container; this.h = handlers; }

    render(model, node, view) {
      clear(this.el);
      if (!model) return;
      if (!node) { this.overview(model); return; }
      const o = this.h.onObject;
      const st = nodeStatus(node, view.time, view.currentIds);
      append(this.el,
        el('div', { class: 'd-head' },
          el('span', { class: 'kind k-' + node.kind, text: KIND[node.kind] || node.kind }),
          el('span', { class: 'chip st-' + st.cls, text: st.text })),
        el('h3', { class: 'd-title', text: node.name }),
        node.args.length ? el('div', { class: 'd-args' }, node.args.map(a => [objEl(a, o), ' '])) : null,
        el('div', { class: 'd-steps' }, whenText(node, model.schedule.temporal), ' ',
          el('button', { class: 'link', text: 'go there', on: { click: () => this.h.onStep(node.start) } })));
      if (node.issues.length) {
        this.el.appendChild(el('ul', { class: 'issues' }, node.issues.map(i => el('li', { text: i }))));
      }
      if (node.kind === 'action') this.action(model, node, view);
      else if (node.kind === 'method') this.method(model, node, view);
      else if (node.kind === 'task') this.task(model, node);
      else if (node.kind === 'root') this.rootNode(model, node, view);
      if (!model.domain && node.kind !== 'root') {
        this.el.appendChild(el('p', { class: 'hint', text: 'Load the domain (and problem) file to see the definition, preconditions and effects.' }));
      }
    }

    overview(model) {
      const { counts, plan, sim } = model;
      const o = this.h.onObject;
      append(this.el,
        el('h3', { class: 'd-title', text: 'Plan overview' }),
        el('div', { class: 'stats' },
          [['actions', counts.action], ['abstract tasks', counts.task], ['methods', counts.method], ['tree depth', model.depth]]
            .map(([k, v]) => el('div', { class: 'stat' }, el('b', { text: String(v) }), el('span', { text: k })))));
      if (sim) {
        this.el.appendChild(section('Goal',
          el('p', { class: sim.goalHolds === false ? 'bad' : 'ok', text: sim.goalHolds === false ? '✗ The goal does not hold at the end of the plan' :
            (model.problem.goal.length ? '✓ The goal holds at the end of the plan' : 'No state goal (only the task network has to be accomplished)') })));
      }
      const issues = model.issues;
      this.el.appendChild(section('Checks', issues.length
        ? el('ul', { class: 'issues' }, issues.map(i => el('li', { text: i })))
        : el('p', { class: 'ok', text: sim ? '✓ Every action is applicable when it is executed and the tree is consistent.' : '✓ The decomposition tree is consistent.' })));
      if (!model.domain) this.el.appendChild(el('p', { class: 'hint', text: 'Tip: also load the domain and problem files to see definitions, check preconditions and follow the world state.' }));
      this.el.appendChild(section('How to read',
        el('p', { text: 'The plan is a tree. The root is the task to accomplish. A method explains how a task is broken down into smaller tasks, until we reach actions that are actually executed, one step at a time.' }),
        el('p', { text: 'Press play: the action being executed is blue, the tasks it belongs to are orange, finished parts are green.' }),
        el('p', {}, 'Click a box for details, or click an object name (for example ',
          plan.actions[0] && plan.actions[0].args[0] ? objEl(plan.actions[0].args[0], o) : 'an argument',
          ') to highlight everything that involves it.')));
    }

    params(def, binding, extra) {
      const o = this.h.onObject;
      if (!def.params.length && !(extra && extra.length)) return el('p', { class: 'muted', text: 'No parameters.' });
      return el('table', { class: 'params' },
        def.params.map(p => el('tr', {},
          el('td', { class: 'var', text: p.name }),
          el('td', {}, binding[p.name] !== undefined ? objEl(binding[p.name], o) : el('span', { class: 'muted', text: 'unbound' })),
          el('td', { class: 'type', text: p.type }))),
        extra && extra.length ? el('tr', {},
          el('td', { class: 'muted', text: '(compiled)' }),
          el('td', { colspan: 2 }, extra.map(a => [objEl(a, o), ' ']),
            el('div', { class: 'muted small', text: 'Extra arguments added by the planner when compiling quantifiers away.' }))) : null);
    }

    formula(f, binding, model, stateIndex) {
      if (!f || !f.length) return el('p', { class: 'muted', text: 'None.' });
      if (!model.sim) return el('pre', { class: 'lifted', text: HTNV.state.groundText(f, binding) });
      const ex = HTNV.state.explain(f, binding, model.sim.stateAt(stateIndex), model.ctx);
      const list = ex.type === 'op' && ex.text === 'and' ? ex.children : [ex];
      return el('ul', { class: 'formula' }, list.map(x => this.formulaItem(x)));
    }

    formulaItem(x) {
      const o = this.h.onObject;
      const mark = x.value === true ? '✓' : x.value === false ? '✗' : '?';
      const cls = x.value === true ? 'ok' : x.value === false ? 'bad' : 'unk';
      const head = [el('span', { class: 'mark ' + cls, text: mark })];
      if (x.type === 'atom') return el('li', {}, head, x.negated ? el('span', { class: 'neg', text: 'not ' }) : null, factEl(x.text, o));
      if (x.type === 'eq') return el('li', {}, head, el('span', { text: (x.negated ? 'not ' : '') + x.text }));
      if (x.type === 'other') return el('li', {}, head, el('code', { text: x.text }));
      if (x.type === 'quant') {
        return el('li', {}, head, el('span', { text: `${x.text} (${x.total} case${x.total === 1 ? '' : 's'}): ` }), el('code', { text: x.body }),
          x.children.length ? el('div', { class: 'muted small', text: x.text.startsWith('for all') ? 'fails for:' : 'true for:' }) : null,
          x.children.length ? el('ul', { class: 'formula' }, x.children.map(c => this.formulaItem(c))) : null);
      }
      const label = { and: 'all of', or: 'one of', imply: 'if … then', not: 'not' }[x.text] || x.text;
      return el('li', {}, head, el('span', { class: 'op', text: label }), el('ul', { class: 'formula' }, x.children.map(c => this.formulaItem(c))));
    }

    action(model, node, view) {
      if (!node.def) return;
      const k = view.stepOfTime(node.start);
      this.el.appendChild(section('Parameters', this.params(node.def, node.binding, node.extraArgs)));
      const temporal = model.schedule.temporal;
      this.el.appendChild(section(!model.sim ? 'Preconditions'
        : temporal ? `Preconditions (checked when it starts, t = ${node.start})` : 'Preconditions (checked just before this step)',
        this.formula(node.def.precondition, node.binding, model, k)));
      if (model.sim) {
        // The effects computed by the replay (conditional effects depend on the state at the end).
        const eff = node.appliedEffects || HTNV.state.effects(node.def.effect, node.binding, model.sim.stateAt(k), model.ctx);
        const o = this.h.onObject;
        this.el.appendChild(section(temporal ? `Effects (applied when it ends, t = ${node.end})` : 'Effects (what this step changes)',
          eff.add.length || eff.del.length ? el('ul', { class: 'effects' },
            eff.add.map(f => el('li', { class: 'add' }, el('span', { class: 'mark', text: '+' }), factEl(f, o))),
            eff.del.map(f => el('li', { class: 'del' }, el('span', { class: 'mark', text: '−' }), factEl(f, o))))
            : el('p', { class: 'muted', text: 'No effect.' })));
      } else {
        this.el.appendChild(section('Effects', this.formula(node.def.effect, node.binding, model, k)));
      }
    }

    method(model, node, view) {
      const task = node.parent;
      this.el.appendChild(section('Decomposes the task',
        el('button', { class: 'nodelink', text: [task.name].concat(task.args).join(' '), on: { click: () => this.h.onSelect(task, true) } })));
      const def = node.def;
      const k = view.stepOfTime(node.start);
      if (def && model.sim) HTNV.bind.completeMethodBinding(node, model.sim.stateAt(k), model.ctx);
      if (def) {
        this.el.appendChild(section('Variables', this.params(def, node.binding)));
        if (node.inferredVars) this.el.appendChild(el('p', { class: 'muted small', text: `${node.inferredVars.join(', ')} not fixed by the plan; deduced from the precondition and the state.` }));
        this.el.appendChild(section(model.sim ? 'Preconditions (checked when the method starts)' : 'Preconditions',
          this.formula(def.precondition, node.binding, model, k)));
        if (def.constraints && def.constraints.length) this.el.appendChild(section('Constraints', this.formula(def.constraints, node.binding, model, k)));
      }
      // Subtasks in declared order, with their ids when the definition is known.
      const declared = def ? def.subtasks.map(s => ({ id: s.id, node: node.children.find(c => c.subtaskId === s.id), s }))
        : node.children.map(c => ({ id: null, node: c }));
      const rows = declared.map(({ id, node: c, s }) => el('li', {},
        id && !id.startsWith('_t') ? el('span', { class: 'sid', text: id }) : null,
        c ? el('button', { class: 'nodelink st-' + nodeStatus(c, view.time, view.currentIds).cls, text: [c.name].concat(c.args).join(' '), on: { click: () => this.h.onSelect(c, true) } })
          : el('code', { text: s ? HTNV.state.groundText([s.name].concat(s.args), node.binding) : '?' }),
        c ? el('span', { class: 'muted small', text: ' · ' + whenText(c, model.schedule.temporal) }) : null));
      this.el.appendChild(section('Subtasks', rows.length ? el('ol', { class: 'subtasks' }, rows) : el('p', { class: 'muted', text: 'None: this method does nothing (empty decomposition).' })));
      if (def && def.subtasks.length > 1) {
        const items = declared.map(({ id, node: c, s }) => ({
          id,
          label: c ? [c.name].concat(c.args).join(' ') : HTNV.state.groundText([s.name].concat(s.args), node.binding),
          cls: c ? nodeStatus(c, view.time, view.currentIds).cls : 'future',
          onClick: c && (() => this.h.onSelect(c, true)),
        }));
        this.el.appendChild(section('Ordering', el('p', { class: 'muted small', text: orderCaption(def) }), orderDiagram(items, def.ordering)));
      }
    }

    task(model, node) {
      if (node.def) this.el.appendChild(section('Parameters', this.params(node.def, node.binding)));
      if (node.method) {
        this.el.appendChild(section('Decomposed by the method',
          el('button', { class: 'nodelink', text: node.method.name, on: { click: () => this.h.onSelect(node.method, true) } })));
      } else if (node.kind === 'task') {
        this.el.appendChild(el('p', { class: 'muted', text: 'No method is given for this task in the plan.' }));
      }
    }

    rootNode(model, node, view) {
      this.el.appendChild(section('Initial tasks', el('ol', { class: 'subtasks' }, node.children.map(c =>
        el('li', {}, el('button', { class: 'nodelink', text: [c.name].concat(c.args).join(' '), on: { click: () => this.h.onSelect(c, true) } }))))));
      const htn = model.problem && model.problem.htn;
      if (htn && htn.subtasks.length > 1) {
        // Match the problem's initial tasks to the plan's root tasks.
        const free = [...node.children];
        const items = htn.subtasks.map(s => {
          const c = free.find(n => n.name === s.name && n.args.join(' ') === s.args.join(' '));
          if (c) free.splice(free.indexOf(c), 1);
          return {
            id: s.id, label: [s.name].concat(s.args).join(' '),
            cls: c ? nodeStatus(c, view.time, view.currentIds).cls : 'future',
            onClick: c && (() => this.h.onSelect(c, true)),
          };
        });
        this.el.appendChild(section('Ordering', el('p', { class: 'muted small', text: orderCaption(htn) }), orderDiagram(items, htn.ordering)));
      }
    }
  }

  // --------------------------------------------------------------------- state

  // Predicates some action can change; the others are static facts.
  function fluentPredicates(domain) {
    const out = new Set();
    Object.values(domain.actions).forEach(a => (function walk(e) {
      if (!Array.isArray(e) || !e.length) return;
      if (e[0] === 'and') e.slice(1).forEach(walk);
      else if (e[0] === 'not') walk(e[1]);
      else if (e[0] === 'forall') walk(e[2]);
      else if (e[0] === 'when') walk(e[2]);
      else out.add(e[0]);
    })(a.effect));
    return out;
  }

  class StatePanel {
    // handlers: onObject(obj)
    constructor(container, handlers) {
      this.el = container;
      this.h = handlers;
      this.filter = '';
      this.search = el('input', { type: 'search', class: 'state-search', placeholder: 'Filter facts…', on: { input: () => { this.filter = this.search.value.trim().toLowerCase(); this.renderList(); } } });
      this.head = el('div', { class: 'state-head' });
      this.list = el('div', { class: 'state-list' });
      container.append(this.head, this.search, this.list);
    }

    render(model, step, highlight, current) {
      this.args = { model, step, highlight, current };
      clear(this.head);
      if (!model) return;
      if (!model.sim) {
        clear(this.list);
        this.search.hidden = true;
        this.head.appendChild(el('p', { class: 'hint', text: 'Load the domain and the problem files to follow the world state: which facts are true at each step and what each action changes.' }));
        return;
      }
      this.search.hidden = false;
      if (model.fluents === undefined) model.fluents = fluentPredicates(model.domain);
      const points = model.schedule.timePoints;
      const last = step >= points.length - 1;
      const temporal = model.schedule.temporal;
      const names = el('b', { text: current.map(a => a.name).join(', ') });
      const marks = [el('span', { class: 'fact add', text: 'added' }), ' / ', el('span', { class: 'fact del', text: 'removed' }), '.'];
      append(this.head,
        el('div', { class: 'state-title', text: temporal
          ? (last ? `Final state (t = ${points[step]})` : `World state at t = ${points[step]}`)
          : (last ? 'Final state (after the last step)' : `World state before step ${step + 1}`) }),
        current.length ? el('div', { class: 'muted small' }, temporal
          ? ['Effects of the running actions (', names, ', applied when each ends) are marked ', marks]
          : ['Changes made by ', names, ' are marked ', marks]) : null,
        highlight ? el('div', { class: 'small' }, 'Only facts about ', objEl(highlight, this.h.onObject), ' ',
          el('button', { class: 'link', text: 'show all', on: { click: () => this.h.onObject(null) } })) : null);
      this.renderList();
    }

    renderList() {
      clear(this.list);
      const { model, step, highlight, current } = this.args || {};
      if (!model || !model.sim) return;
      const o = this.h.onObject;
      const state = model.sim.stateAt(step);
      const diff = model.sim.pendingAt(step);
      const temporal = model.schedule.temporal;
      const keep = f => (!highlight || f.split(' ').slice(1).includes(highlight)) && (!this.filter || f.includes(this.filter));

      const added = [...diff.add].filter(f => !state.has(f) && keep(f));
      const removed = [...diff.del].filter(f => state.has(f) && !diff.add.has(f) && keep(f));
      if (added.length || removed.length) {
        this.list.appendChild(el('div', { class: 'changes' }, el('h4', { text: temporal ? 'The running actions will change' : 'This step changes' }),
          added.map(f => el('div', {}, factEl(f, o, 'add'))), removed.map(f => el('div', {}, factEl(f, o, 'del')))));
      } else if (current.length && ![...diff.add].some(f => !state.has(f)) && ![...diff.del].some(f => state.has(f) && !diff.add.has(f))) {
        // Make steps like "nop" explicit: the facts listed below are simply still true.
        this.list.appendChild(el('div', { class: 'changes' }, el('h4', { text: temporal ? 'The running actions change nothing' : 'This step changes nothing' }),
          el('div', { class: 'muted small', text: diff.add.size || diff.del.size
            ? `The effects of ${current.map(a => a.name).join(', ')} are already true.`
            : `${current.map(a => a.name).join(', ')} has no effect.` })));
      }

      const groups = new Map();
      [...state].concat(added).filter(keep).sort().forEach(f => {
        const p = f.split(' ')[0];
        if (!groups.has(p)) groups.set(p, []);
        groups.get(p).push(f);
      });
      const render = p => el('details', { class: 'group', open: true },
        el('summary', {}, el('span', { class: 'pred', text: p }), el('span', { class: 'count', text: String(groups.get(p).length) })),
        groups.get(p).slice(0, 400).map(f => el('div', {}, factEl(f, o, !state.has(f) ? 'add' : diff.del.has(f) && !diff.add.has(f) ? 'del' : ''))),
        groups.get(p).length > 400 ? el('div', { class: 'muted small', text: `… ${groups.get(p).length - 400} more` }) : null);
      const preds = [...groups.keys()];
      preds.filter(p => model.fluents.has(p)).forEach(p => this.list.appendChild(render(p)));
      const statics = preds.filter(p => !model.fluents.has(p));
      if (statics.length) {
        const count = statics.reduce((s, p) => s + groups.get(p).length, 0);
        this.list.appendChild(el('details', { class: 'statics', open: Boolean(this.filter || highlight) },
          el('summary', { text: `Static facts, never changed by any action (${count})` }), statics.map(render)));
      }
      if (!groups.size) this.list.appendChild(el('p', { class: 'muted', text: 'No fact matches.' }));
    }
  }

  HTNV.panels = { Breadcrumb, DetailsPanel, StatePanel };
})(typeof window !== 'undefined' ? window : globalThis);
