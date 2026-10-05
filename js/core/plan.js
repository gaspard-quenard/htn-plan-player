// Reader for the IPC-2020 hierarchical plan format:
//   ==>
//   <id> <action> <args...> [<start> <end>]        (primitive actions, execution order)
//   root <ids...>
//   <id> <task> <args...> -> <method> <subtask ids...>
//   <==
// Accepts a raw planner log (ANSI colours, timestamps) as well as a bare plan.
//
// Timed plans: an action line may end with two integers, its start and end
// times (end > start). Object names cannot start with a digit, so they cannot
// be mistaken for arguments. Without times, action i runs on [i, i + 1).
(function (root) {
  'use strict';
  const HTNV = root.HTNV = root.HTNV || {};

  const VIRTUAL_ROOT = '__root';

  function makeNode(id, kind, name, args) {
    return {
      id, kind, name, args,
      children: [], parent: null, issues: [],
      technical: /^(__|<)/.test(name), // method-precondition / surrogate pseudo actions
      start: null, end: null,          // filled by HTNV.schedule.computeSpans
    };
  }

  function planBody(text) {
    const clean = text.replace(/\x1b\[[0-9;]*m/g, '').replace(/\r/g, '');
    const start = clean.lastIndexOf('==>');
    if (start < 0) return clean;
    const end = clean.indexOf('<==', start);
    return clean.slice(start + 3, end >= 0 ? end : undefined);
  }

  function parsePlan(text) {
    const nodes = new Map();
    const actions = [];
    const issues = [];
    const decompositions = [];
    let rootIds = null;

    for (const raw of planBody(text).split('\n')) {
      const tokens = raw.trim().toLowerCase().split(/\s+/);
      if (tokens[0] === 'root') { rootIds = tokens.slice(1); continue; }
      if (!/^\d+$/.test(tokens[0]) || tokens.length < 2) continue; // log noise
      const id = tokens[0];
      if (nodes.has(id)) { issues.push(`Id ${id} is defined twice; the second line is ignored`); continue; }
      const arrow = tokens.indexOf('->');
      if (arrow < 0) {
        const args = tokens.slice(2);
        let timing = null;
        if (args.length >= 2 && /^\d+$/.test(args[args.length - 2]) && /^\d+$/.test(args[args.length - 1])) {
          timing = args.splice(-2).map(Number);
        }
        const node = makeNode(id, 'action', tokens[1], args);
        node.timing = timing;
        node.execIndex = actions.length;
        actions.push(node);
        nodes.set(id, node);
      } else {
        const node = makeNode(id, 'task', tokens[1], tokens.slice(2, arrow));
        nodes.set(id, node);
        decompositions.push({ node, method: tokens[arrow + 1], subIds: tokens.slice(arrow + 2) });
      }
    }
    if (nodes.size === 0) throw new Error('No plan found (expected lines between "==>" and "<==")');
    const timed = resolveTiming(actions, issues);

    // task -> method -> subtasks
    for (const { node, method, subIds } of decompositions) {
      if (!method) { node.issues.push('Decomposition line without a method name'); continue; }
      const m = makeNode(node.id + '/m', 'method', method, []);
      m.parent = node;
      m.subIds = subIds;
      node.method = m;
      node.children = [m];
      nodes.set(m.id, m);
      for (const sid of subIds) {
        let child = nodes.get(sid);
        if (!child) {
          child = makeNode(sid, 'missing', '?' + sid, []);
          child.issues.push(`Subtask ${sid} is referenced but never defined`);
          nodes.set(sid, child);
        }
        if (child.parent) { m.issues.push(`Subtask ${sid} already belongs to ${child.parent.id}; ignored here`); continue; }
        child.parent = m;
        m.children.push(child);
      }
    }

    // Root: the single initial task, or a virtual node for an initial task network.
    let roots;
    if (rootIds) {
      roots = rootIds.map(id => nodes.get(id)).filter(Boolean);
      if (roots.length !== rootIds.length) issues.push('Some root ids are not defined in the plan');
    } else {
      roots = [...nodes.values()].filter(n => !n.parent && n.kind !== 'method');
      if (decompositions.length) issues.push('No "root" line: parentless nodes are used as roots');
    }
    let rootNode;
    if (roots.length === 1) {
      rootNode = roots[0];
    } else {
      rootNode = makeNode(VIRTUAL_ROOT, 'root', decompositions.length ? 'initial task network' : 'plan', []);
      roots.forEach(r => { r.parent = rootNode; rootNode.children.push(r); });
      nodes.set(VIRTUAL_ROOT, rootNode);
    }

    // Detect cycles and nodes unreachable from the root.
    const reached = new Set();
    (function walk(n) {
      reached.add(n.id);
      n.children = n.children.filter(c => {
        if (reached.has(c.id)) { n.issues.push(`Cycle through ${c.id} cut`); return false; }
        walk(c);
        return true;
      });
    })(rootNode);
    const unreachable = actions.filter(a => !reached.has(a.id));
    if (unreachable.length) {
      issues.push(`${unreachable.length} action(s) are not part of the decomposition tree: ` +
        unreachable.slice(0, 5).map(a => a.id + ' ' + a.name).join(', ') + (unreachable.length > 5 ? ', …' : ''));
      unreachable.forEach(a => a.issues.push('Not reachable from the root task'));
    }

    return { root: rootNode, nodes, actions, issues, timed };
  }

  // A plan is timed when every action has times. Actions are then ordered by
  // start time (execIndex follows that order).
  function resolveTiming(actions, issues) {
    const withTimes = actions.filter(a => a.timing).length;
    if (withTimes === 0) return false;
    if (withTimes < actions.length) {
      issues.push(`Only ${withTimes} of ${actions.length} actions have start/end times; times are ignored`);
      actions.forEach(a => { a.timing = null; });
      return false;
    }
    actions.forEach(a => {
      if (a.timing[1] <= a.timing[0]) {
        a.issues.push(`End time ${a.timing[1]} is not after start time ${a.timing[0]}; a duration of 1 is used`);
        a.timing[1] = a.timing[0] + 1;
      }
    });
    actions.sort((a, b) => a.timing[0] - b.timing[0] || a.timing[1] - b.timing[1] || a.execIndex - b.execIndex);
    actions.forEach((a, i) => { a.execIndex = i; });
    return true;
  }

  // Walk helpers shared by the views.
  function ancestors(node) {
    const out = [];
    for (let n = node; n; n = n.parent) out.unshift(n);
    return out;
  }

  function forEachNode(node, fn) {
    fn(node);
    node.children.forEach(c => forEachNode(c, fn));
  }

  // Objects a node mentions (arguments, plus the method's grounded variables when known).
  function objectsOf(node) {
    const objs = new Set(node.args);
    if (node.binding) Object.values(node.binding).forEach(v => { if (v && v[0] !== '?') objs.add(v); });
    return objs;
  }

  HTNV.plan = { parsePlan, ancestors, forEachNode, objectsOf, VIRTUAL_ROOT };
})(typeof window !== 'undefined' ? window : globalThis);
