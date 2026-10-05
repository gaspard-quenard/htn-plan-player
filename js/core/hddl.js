// HDDL domain/problem reader. Produces a lifted model: formulas stay as
// S-expression arrays and are interpreted by state.js.
(function (root) {
  'use strict';
  const HTNV = root.HTNV = root.HTNV || {};
  const { parse } = HTNV.sexpr;

  // (?a ?b - t ?c) -> [{name: '?a', type: 't'}, {name: '?b', type: 't'}, {name: '?c', type: 'object'}]
  function typedList(items) {
    const out = [];
    let pending = [];
    for (let i = 0; i < items.length; i++) {
      if (items[i] === '-') {
        const t = items[++i];
        const type = Array.isArray(t) ? t.slice(1).join('|') : t; // (either a b) -> 'a|b'
        pending.forEach(name => out.push({ name, type }));
        pending = [];
      } else {
        pending.push(items[i]);
      }
    }
    pending.forEach(name => out.push({ name, type: 'object' }));
    return out;
  }

  // Keyword/value pairs of a section such as (:method name :parameters (...) ...).
  function keywords(section, start) {
    const out = {};
    for (let i = start; i < section.length; i++) {
      if (typeof section[i] === 'string' && section[i][0] === ':') out[section[i]] = section[++i];
    }
    return out;
  }

  // (and (t1 (name args)) (name args) ...) -> [{id, name, args}]
  function subtaskList(expr) {
    if (!Array.isArray(expr) || expr.length === 0) return [];
    const list = expr[0] === 'and' ? expr.slice(1) : [expr];
    return list.map((s, i) => Array.isArray(s[1])
      ? { id: s[0], name: s[1][0], args: s[1].slice(1) }
      : { id: '_t' + i, name: s[0], args: s.slice(1) });
  }

  // (and (< a b) ...) -> [[a, b], ...]
  function orderingList(expr) {
    if (!Array.isArray(expr) || expr.length === 0) return [];
    const list = expr[0] === 'and' ? expr.slice(1) : [expr];
    const pairs = [];
    list.forEach(o => {
      if (o[0] === '<') pairs.push([o[1], o[2]]);
      else if (o[1] === '<') pairs.push([o[0], o[2]]);
      else if (o[0] === '>') pairs.push([o[2], o[1]]);
    });
    return pairs;
  }

  // Shared by methods and the problem's initial task network.
  function taskNetwork(kw) {
    const orderedExpr = kw[':ordered-subtasks'] || kw[':ordered-tasks'];
    const subtasks = subtaskList(orderedExpr || kw[':subtasks'] || kw[':tasks']);
    const ordering = orderedExpr
      ? subtasks.slice(1).map((s, i) => [subtasks[i].id, s.id])
      : orderingList(kw[':ordering'] || kw[':order']);
    return { subtasks, ordering, totallyOrdered: Boolean(orderedExpr) || subtasks.length <= 1 };
  }

  function findDefine(text, kind) {
    const def = parse(text).find(f => Array.isArray(f) && f[0] === 'define');
    if (!def || !Array.isArray(def[1]) || def[1][0] !== kind) {
      throw new Error(`Not an HDDL ${kind} file: expected (define (${kind} ...) ...)`);
    }
    return def;
  }

  function parseDomain(text) {
    const def = findDefine(text, 'domain');
    const d = {
      name: def[1][1], requirements: [], types: {}, constants: {}, predicates: {},
      tasks: {}, methods: {}, actions: {}, warnings: [],
    };
    for (const sec of def.slice(2)) {
      const kw = keywords(sec, 2);
      switch (sec[0]) {
        case ':requirements': d.requirements = sec.slice(1); break;
        case ':types':
          typedList(sec.slice(1)).forEach(t => {
            (d.types[t.name] = d.types[t.name] || []).push(...t.type.split('|'));
          });
          break;
        case ':constants': typedList(sec.slice(1)).forEach(c => { d.constants[c.name] = c.type; }); break;
        case ':predicates':
          sec.slice(1).forEach(p => { d.predicates[p[0]] = { name: p[0], params: typedList(p.slice(1)) }; });
          break;
        case ':task':
          d.tasks[sec[1]] = { name: sec[1], params: typedList(kw[':parameters'] || []) };
          break;
        case ':method':
          d.methods[sec[1]] = Object.assign({
            name: sec[1],
            params: typedList(kw[':parameters'] || []),
            task: { name: kw[':task'][0], args: kw[':task'].slice(1) },
            precondition: kw[':precondition'] || [],
            constraints: kw[':constraints'] || [],
          }, taskNetwork(kw));
          break;
        case ':action':
          d.actions[sec[1]] = {
            name: sec[1],
            params: typedList(kw[':parameters'] || []),
            precondition: kw[':precondition'] || [],
            effect: kw[':effect'] || [],
          };
          break;
        default: d.warnings.push(`Domain section ${sec[0]} is ignored by the viewer`);
      }
    }
    return d;
  }

  function parseProblem(text) {
    const def = findDefine(text, 'problem');
    const p = { name: def[1][1], domain: null, objects: {}, init: [], htn: null, goal: [], warnings: [] };
    for (const sec of def.slice(2)) {
      switch (sec[0]) {
        case ':domain': p.domain = sec[1]; break;
        case ':objects': typedList(sec.slice(1)).forEach(o => { p.objects[o.name] = o.type; }); break;
        case ':init':
          sec.slice(1).forEach(f => {
            if (f[0] === '=') p.warnings.push(`Numeric init ${HTNV.sexpr.print(f)} ignored`);
            else p.init.push(f.join(' '));
          });
          break;
        case ':htn': p.htn = taskNetwork(keywords(sec, 1)); break;
        case ':goal': p.goal = sec[1] || []; break;
        default: p.warnings.push(`Problem section ${sec[0]} is ignored by the viewer`);
      }
    }
    return p;
  }

  // Type hierarchy + object universe (problem objects and domain constants).
  function typeIndex(domain, problem) {
    const ancestorsCache = new Map();
    function ancestors(type) {
      if (ancestorsCache.has(type)) return ancestorsCache.get(type);
      const seen = new Set();
      const stack = type.split('|');
      while (stack.length) {
        const t = stack.pop();
        if (seen.has(t)) continue;
        seen.add(t);
        (domain.types[t] || []).forEach(p => stack.push(p));
      }
      seen.add('object');
      ancestorsCache.set(type, seen);
      return seen;
    }
    const objects = Object.assign({}, domain.constants, problem ? problem.objects : {});
    const byTypeCache = new Map();
    function objectsOf(type) {
      if (!byTypeCache.has(type)) {
        const wanted = type.split('|');
        byTypeCache.set(type, Object.keys(objects).filter(o => wanted.some(w => ancestors(objects[o]).has(w))));
      }
      return byTypeCache.get(type);
    }
    return { objects, ancestors, objectsOf };
  }

  // Cheap content sniffing used by the loader.
  function classify(text) {
    if (/\(\s*define\s*\(\s*domain\b/i.test(text)) return 'domain';
    if (/\(\s*define\s*\(\s*problem\b/i.test(text)) return 'problem';
    if (/==>|^\s*root\b/m.test(text)) return 'plan';
    return null;
  }

  HTNV.hddl = { parseDomain, parseProblem, typeIndex, typedList, classify };
})(typeof window !== 'undefined' ? window : globalThis);
