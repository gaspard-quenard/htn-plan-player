// Grounds domain definitions onto plan nodes: node.def (lifted definition) and
// node.binding ({'?var': object}). Methods are bound by unifying their :task
// with the decomposed task, then matching their declared subtasks to the plan's
// subtask ids (which also binds variables that only occur in subtasks).
(function (root) {
  'use strict';
  const HTNV = root.HTNV = root.HTNV || {};

  function unify(pattern, values, binding) {
    const b = Object.assign({}, binding);
    for (let i = 0; i < pattern.length; i++) {
      const p = pattern[i], v = values[i];
      if (v === undefined) return null;
      if (p[0] === '?') {
        if (b[p] !== undefined && b[p] !== v) return null;
        b[p] = v;
      } else if (p !== v) {
        return null;
      }
    }
    return b;
  }

  function positional(params, args) {
    const b = {};
    params.forEach((p, i) => { if (args[i] !== undefined) b[p.name] = args[i]; });
    return b;
  }

  function bindAction(node, domain) {
    const def = domain.actions[node.name];
    if (!def) { if (!node.technical) node.issues.push(`Action "${node.name}" is not defined in the domain`); return; }
    node.def = def;
    node.binding = positional(def.params, node.args);
    if (node.args.length < def.params.length) node.issues.push('Fewer arguments than declared parameters');
    // Planners that compile quantifiers away append extra arguments.
    node.extraArgs = node.args.slice(def.params.length);
  }

  function bindTask(node, domain) {
    const def = domain.tasks[node.name];
    if (!def) { node.issues.push(`Task "${node.name}" is not defined in the domain`); return; }
    node.def = def;
    node.binding = positional(def.params, node.args);
  }

  // Assigns each declared subtask to a distinct child (backtracking).
  function matchSubtasks(subtasks, children, binding) {
    const used = new Set();
    const assignment = new Array(subtasks.length);
    function rec(i, b) {
      if (i === subtasks.length) return b;
      for (const c of children) {
        if (used.has(c) || c.name !== subtasks[i].name) continue;
        const b2 = unify(subtasks[i].args, c.args, b);
        if (!b2) continue;
        used.add(c);
        assignment[i] = c;
        const result = rec(i + 1, b2);
        if (result) return result;
        used.delete(c);
      }
      return null;
    }
    const b = rec(0, binding);
    return b && { binding: b, assignment };
  }

  function bindMethod(method, task, domain) {
    const def = domain.methods[method.name];
    if (!def) { method.issues.push(`Method "${method.name}" is not defined in the domain`); return; }
    method.def = def;
    let b = def.task.name === task.name ? unify(def.task.args, task.args, {}) : null;
    if (!b) {
      method.issues.push(`Method does not decompose this task (${def.task.name} expected)`);
      b = {};
    }
    const match = def.subtasks.length === method.children.length && matchSubtasks(def.subtasks, method.children, b);
    if (match) {
      b = match.binding;
      match.assignment.forEach((c, i) => { c.subtaskId = def.subtasks[i].id; });
    } else {
      method.issues.push('The plan\'s subtasks do not match the method definition');
    }
    method.binding = b;
  }

  function bindAll(plan, domain) {
    for (const node of plan.nodes.values()) {
      if (node.kind === 'action') bindAction(node, domain);
      else if (node.kind === 'task') bindTask(node, domain);
    }
    for (const node of plan.nodes.values()) {
      if (node.kind === 'method') bindMethod(node, node.parent, domain);
    }
  }

  // Method variables bound by nothing in the plan (they only occur in the
  // precondition) are inferred from the state where the method starts: the
  // first assignment making the precondition true is used.
  function completeMethodBinding(method, state, ctx, limit = 20000) {
    if (!method.def || method.bindingCompleted) return;
    method.bindingCompleted = true;
    const free = method.def.params.filter(p => method.binding[p.name] === undefined);
    if (!free.length) return;
    const varList = [];
    free.forEach(p => varList.push(p.name, '-', p.type));
    let tried = 0;
    for (const b of HTNV.state.bindings(varList, method.binding, ctx)) {
      if (++tried > limit) break;
      const pre = ['and', method.def.precondition, method.def.constraints];
      if (HTNV.state.evaluate(pre, b, state, ctx) === true) {
        free.forEach(p => { method.binding[p.name] = b[p.name]; });
        method.inferredVars = free.map(p => p.name);
        return;
      }
    }
  }

  HTNV.bind = { bindAll, completeMethodBinding, unify };
})(typeof window !== 'undefined' ? window : globalThis);
