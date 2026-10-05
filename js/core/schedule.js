// Time model. A schedule maps every primitive action to an interval [start, end)
// and lists the time points the player steps through. Everything else (spans,
// status, state replay) only uses these intervals, so a parallel or temporal
// schedule can be added later without touching the views.
(function (root) {
  'use strict';
  const HTNV = root.HTNV = root.HTNV || {};

  // One action per step, in plan order: action i occupies [i, i + 1).
  class SequentialSchedule {
    constructor(plan) {
      this.plan = plan;
      this.temporal = false;
      this.timePoints = plan.actions.map((_, i) => i).concat(plan.actions.length);
    }
    interval(action) { return [action.execIndex, action.execIndex + 1]; }
    actionsStartingAt(time) { const a = this.plan.actions[time]; return a ? [a] : []; }
    actionsEndingAt(time) { const a = this.plan.actions[time - 1]; return a ? [a] : []; }
    // Actions running at a time point: start <= time < end.
    actionsAt(time) { return this.actionsStartingAt(time); }
  }

  // Times given in the plan: action a occupies a.timing = [start, end).
  // Actions may overlap (parallel) and last more than one time unit. The time
  // points are the moments where some action starts or ends.
  class TemporalSchedule {
    constructor(plan) {
      this.plan = plan;
      this.temporal = true;
      const times = new Set();
      this.starting = new Map();
      this.ending = new Map();
      plan.actions.forEach(a => {
        const [s, e] = a.timing;
        times.add(s).add(e);
        (this.starting.get(s) || this.starting.set(s, []).get(s)).push(a);
        (this.ending.get(e) || this.ending.set(e, []).get(e)).push(a);
      });
      this.timePoints = [...times].sort((x, y) => x - y);
    }
    interval(action) { return action.timing; }
    actionsStartingAt(time) { return this.starting.get(time) || []; }
    actionsEndingAt(time) { return this.ending.get(time) || []; }
    actionsAt(time) { return this.plan.actions.filter(a => a.timing[0] <= time && time < a.timing[1]); }
  }

  // Gives every node a [start, end) span. Abstract spans cover their children;
  // children are re-sorted by start so the tree reads in execution order (this
  // matters for partial-order plans). Nodes without any action (empty methods)
  // get a zero-length span right after all their previously declared siblings.
  function computeSpans(plan, schedule) {
    (function up(n) {
      n.children.forEach(up);
      if (n.kind === 'action') {
        [n.start, n.end] = schedule.interval(n);
        return;
      }
      const spans = n.children.filter(c => c.start !== null);
      n.start = spans.length ? Math.min(...spans.map(c => c.start)) : null;
      n.end = spans.length ? Math.max(...spans.map(c => c.end)) : null;
    })(plan.root);

    (function down(n) {
      if (n.start === null) n.start = n.end = n.parent ? n.parent.start : 0;
      let cursor = n.start;
      n.children.forEach((c, i) => {
        c.declaredIndex = i;
        if (c.start === null) c.start = c.end = cursor;
        else cursor = Math.max(cursor, c.end);
      });
      n.children.forEach(down);
      n.children.sort((a, b) => a.start - b.start || a.declaredIndex - b.declaredIndex);
    })(plan.root);
  }

  // 'done' | 'active' | 'future' at a time point. Zero-length nodes count as
  // done as soon as their position is reached.
  function status(node, time) {
    if (node.end <= time) return 'done';
    if (node.start <= time) return 'active';
    return 'future';
  }

  // Packs actions into lanes so that actions overlapping in time never share a
  // lane (greedy, by start time). A sequential plan uses a single lane.
  // Returns { lanes: number, laneOf: Map(action -> lane index) }.
  function assignLanes(actions) {
    const laneEnds = [];
    const laneOf = new Map();
    [...actions].sort((a, b) => a.start - b.start || a.end - b.end).forEach(a => {
      let lane = laneEnds.findIndex(end => end <= a.start);
      if (lane < 0) lane = laneEnds.length;
      laneEnds[lane] = a.end;
      laneOf.set(a, lane);
    });
    return { lanes: Math.max(1, laneEnds.length), laneOf };
  }

  // The schedule matching the plan: timed plans keep their own times.
  function forPlan(plan) {
    return plan.timed ? new TemporalSchedule(plan) : new SequentialSchedule(plan);
  }

  HTNV.schedule = { SequentialSchedule, TemporalSchedule, forPlan, computeSpans, status, assignLanes };
})(typeof window !== 'undefined' ? window : globalThis);
