// Formula evaluation, effect application and plan replay.
// States are Sets of ground atoms written "pred arg1 arg2".
// Evaluation is three-valued: true, false, or null when a variable is unbound.
(function (root) {
  'use strict';
  const HTNV = root.HTNV = root.HTNV || {};
  const { print } = HTNV.sexpr;

  const NUMERIC = new Set(['<', '>', '<=', '>=', 'increase', 'decrease', 'assign', 'scale-up', 'scale-down']);

  function context(domain, problem) {
    return { domain, problem, types: HTNV.hddl.typeIndex(domain, problem) };
  }

  function term(t, b) { return t[0] === '?' && b[t] !== undefined ? b[t] : t; }

  // Ground atom key, or null when some argument is still a variable.
  function atomKey(f, b) {
    const args = f.slice(1).map(t => term(t, b));
    if (args.some(a => a[0] === '?')) return null;
    return [f[0]].concat(args).join(' ');
  }

  // Every extension of b over a typed variable list.
  function* bindings(varList, b, ctx) {
    const vars = HTNV.hddl.typedList(varList);
    function* rec(i, acc) {
      if (i === vars.length) { yield acc; return; }
      for (const o of ctx.types.objectsOf(vars[i].type)) yield* rec(i + 1, Object.assign({}, acc, { [vars[i].name]: o }));
    }
    yield* rec(0, b);
  }

  function and3(values) {
    let unknown = false;
    for (const v of values) { if (v === false) return false; if (v === null) unknown = true; }
    return unknown ? null : true;
  }
  function or3(values) {
    let unknown = false;
    for (const v of values) { if (v === true) return true; if (v === null) unknown = true; }
    return unknown ? null : false;
  }
  function not3(v) { return v === null ? null : !v; }

  function evaluate(f, b, state, ctx) {
    if (!Array.isArray(f) || f.length === 0) return true;
    switch (f[0]) {
      case 'and': return and3(f.slice(1).map(g => evaluate(g, b, state, ctx)));
      case 'or': return or3(f.slice(1).map(g => evaluate(g, b, state, ctx)));
      case 'not': return not3(evaluate(f[1], b, state, ctx));
      case 'imply': return or3([not3(evaluate(f[1], b, state, ctx)), evaluate(f[2], b, state, ctx)]);
      case 'forall': return and3([...bindings(f[1], b, ctx)].map(e => evaluate(f[2], e, state, ctx)));
      case 'exists': return or3([...bindings(f[1], b, ctx)].map(e => evaluate(f[2], e, state, ctx)));
      case '=': {
        const x = term(f[1], b), y = term(f[2], b);
        return x[0] === '?' || y[0] === '?' ? null : x === y;
      }
      default: {
        if (NUMERIC.has(f[0])) return null;
        const key = atomKey(f, b);
        return key === null ? null : state.has(key);
      }
    }
  }

  // Same as evaluate, but returns a tree the details panel can render.
  //   { type: 'atom' | 'eq' | 'op' | 'quant' | 'other', text, value, negated?, children?, total? }
  function explain(f, b, state, ctx) {
    if (!Array.isArray(f) || f.length === 0) return { type: 'op', text: 'and', value: true, children: [] };
    const value = evaluate(f, b, state, ctx);
    switch (f[0]) {
      case 'and': case 'or': case 'imply':
        return { type: 'op', text: f[0], value, children: f.slice(1).map(g => explain(g, b, state, ctx)) };
      case 'not': {
        const inner = explain(f[1], b, state, ctx);
        if (inner.type === 'atom' || inner.type === 'eq') return Object.assign(inner, { negated: !inner.negated, value });
        return { type: 'op', text: 'not', value, children: [inner] };
      }
      case 'forall': case 'exists': {
        // Show only the instances that decide the outcome (failing ones for forall).
        const all = [...bindings(f[1], b, ctx)];
        const decisive = all.filter(e => evaluate(f[2], e, state, ctx) === (f[0] === 'forall' ? false : true));
        return {
          type: 'quant', text: `${f[0] === 'forall' ? 'for all' : 'exists'} ${f[1].join(' ')}`, value,
          total: all.length, body: groundText(f[2], b),
          children: decisive.slice(0, 5).map(e => explain(f[2], e, state, ctx)),
        };
      }
      case '=':
        return { type: 'eq', text: `${term(f[1], b)} = ${term(f[2], b)}`, value };
      default:
        if (NUMERIC.has(f[0])) return { type: 'other', text: groundText(f, b), value: null };
        return { type: 'atom', text: [f[0]].concat(f.slice(1).map(t => term(t, b))).join(' '), value };
    }
  }

  function groundText(f, b) {
    return print(JSON.parse(JSON.stringify(f), (k, v) => typeof v === 'string' ? term(v, b) : v));
  }

  // Ground effect of an operator in a state: { add: [], del: [], warnings: [] }.
  function effects(eff, b, state, ctx) {
    const out = { add: [], del: [], warnings: [] };
    (function collect(e, bb) {
      if (!Array.isArray(e) || e.length === 0) return;
      switch (e[0]) {
        case 'and': e.slice(1).forEach(x => collect(x, bb)); break;
        case 'not': out.del.push(atomKey(e[1], bb)); break;
        case 'forall': for (const ext of bindings(e[1], bb, ctx)) collect(e[2], ext); break;
        case 'when': if (evaluate(e[1], bb, state, ctx) === true) collect(e[2], bb); break;
        default:
          if (NUMERIC.has(e[0])) out.warnings.push(`Numeric effect ${print(e)} ignored`);
          else out.add.push(atomKey(e, bb));
      }
    })(eff, b);
    out.add = out.add.filter(Boolean);
    out.del = out.del.filter(Boolean);
    return out;
  }

  // Replays the plan from the initial state, as a sequence of events at the
  // schedule's time points. At each time point:
  //   1. actions ending now apply their effects (all computed in the same state,
  //      deletions before additions; an atom added by one action and deleted by
  //      another is reported as a conflict);
  //   2. actions starting now have their precondition checked in the new state.
  // This is where at-start / at-end effects and over-all conditions would go.
  // Stores the transitions plus periodic full-state checkpoints, so large
  // plans stay cheap in memory.
  class Simulation {
    constructor(plan, schedule, ctx) {
      this.plan = plan;
      this.schedule = schedule;
      this.ctx = ctx;
      this.checkpointEvery = 64;
      this.diffs = [];        // diffs[k]: { add, del } applied when reaching time point k + 1
      this.checkpoints = [];  // full states at time-point indices 0, 64, 128, ...
      this.issues = [];
      this.run();
    }

    run() {
      const { plan, schedule, ctx } = this;
      let state = new Set(ctx.problem.init);
      const points = schedule.timePoints;
      for (let k = 0; k < points.length; k++) {
        if (k > 0) {
          const { add, del } = this.endEvents(schedule.actionsEndingAt(points[k]), state);
          this.diffs.push({ add, del });
          state = new Set(state);
          del.forEach(f => state.delete(f));
          add.forEach(f => state.add(f));
        }
        if (k % this.checkpointEvery === 0) this.checkpoints.push(new Set(state));
        for (const a of schedule.actionsStartingAt(points[k])) {
          if (!a.def) continue;
          a.preconditionHolds = evaluate(a.def.precondition, a.binding, state, ctx);
          if (a.preconditionHolds === false) a.issues.push('Precondition does not hold when the action starts');
        }
      }
      const failing = plan.actions.filter(a => a.preconditionHolds === false);
      if (failing.length) {
        const where = schedule.temporal ? `t = ${failing[0].start}` : `step ${failing[0].execIndex + 1}`;
        this.issues.push(`${failing.length} action(s) start while their precondition is false (first: ${where}, ${failing[0].name})`);
      }
      this.finalState = state;
      this.goalHolds = evaluate(ctx.problem.goal, {}, state, ctx);
      if (this.goalHolds === false) this.issues.push('The goal of the problem does not hold in the final state');
    }

    // Effects of the actions ending together, all evaluated in the same state.
    // Each action keeps its own ground effects (action.appliedEffects).
    endEvents(ending, state) {
      const add = new Set(), del = new Set();
      const adder = new Map(), deleter = new Map();
      for (const a of ending) {
        if (!a.def) continue;
        const eff = effects(a.def.effect, a.binding, state, this.ctx);
        a.appliedEffects = eff;
        eff.warnings.forEach(w => this.issues.push(w));
        eff.del.forEach(f => { del.add(f); deleter.set(f, a); });
        eff.add.forEach(f => { add.add(f); adder.set(f, a); });
      }
      for (const [f, a] of adder) {
        const b = deleter.get(f);
        if (b && b !== a) {
          const msg = `Conflicting effects on "${f}": ${a.name} adds it while ${b.name} deletes it at the same time`;
          a.issues.push(msg);
          b.issues.push(msg);
        }
      }
      return { add, del };
    }

    // State at time-point index k: after the effects of the actions ending
    // there, i.e. the state in which actions starting at k are checked.
    stateAt(k) {
      const c = Math.floor(k / this.checkpointEvery);
      const state = new Set(this.checkpoints[c]);
      for (let i = c * this.checkpointEvery; i < k; i++) {
        this.diffs[i].del.forEach(f => state.delete(f));
        this.diffs[i].add.forEach(f => state.add(f));
      }
      return state;
    }

    // Effects still to come from the actions running at time-point index k
    // (applied when each of them ends).
    pendingAt(k) {
      const add = new Set(), del = new Set();
      const time = this.schedule.timePoints[k];
      this.schedule.actionsAt(time).forEach(a => {
        if (!a.appliedEffects) return;
        a.appliedEffects.add.forEach(f => add.add(f));
        a.appliedEffects.del.forEach(f => del.add(f));
      });
      return { add, del };
    }
  }

  HTNV.state = { context, evaluate, explain, effects, bindings, groundText, Simulation };
})(typeof window !== 'undefined' ? window : globalThis);
