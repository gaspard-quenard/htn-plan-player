#!/usr/bin/env node
// Tests for the core modules (no browser, no dependencies).
//   node tests/run.js                 fixtures in tests/fixtures
//   node tests/run.js <dir>           also every <name>.log in <dir> that has a
//                                     <name>.files companion ("domain|problem")
'use strict';
const fs = require('fs');
const path = require('path');

const HERE = __dirname;
const VIEWER = path.join(HERE, '..');
['sexpr', 'hddl', 'plan', 'schedule', 'state', 'bind', 'model']
  .forEach(m => require(path.join(VIEWER, 'js/core', m + '.js')));
const HTNV = globalThis.HTNV;

let failures = 0, passed = 0;
function check(cond, msg) {
  if (cond) passed++;
  else { failures++; console.log('  FAIL ' + msg); }
}
const read = p => fs.readFileSync(p, 'utf8');
const exists = p => fs.existsSync(p);

function build(planFile, domainFile, problemFile) {
  return HTNV.model.build({
    planText: read(planFile),
    domainText: domainFile && read(domainFile),
    problemText: problemFile && read(problemFile),
  });
}

// Structural invariants that must hold for any plan.
function checkInvariants(name, m, { totalOrder = false, replay = true, timed = false } = {}) {
  const { plan } = m;
  if (!timed) plan.actions.forEach((a, i) => check(a.start === i && a.end === i + 1, `${name}: action ${a.id} span`));
  const leaves = [];
  HTNV.plan.forEachNode(plan.root, n => {
    n.children.forEach((c, i) => {
      check(c.start >= n.start && c.end <= n.end, `${name}: ${c.id} span outside parent ${n.id}`);
      if (i) check(n.children[i - 1].start <= c.start, `${name}: children of ${n.id} not sorted`);
    });
    if (n.kind === 'action') leaves.push(n.execIndex);
  });
  check(leaves.length === plan.actions.length, `${name}: ${plan.actions.length - leaves.length} actions not in tree`);
  if (totalOrder) check(leaves.every((x, i) => x === i), `${name}: DFS leaf order differs from execution order`);
  if (m.sim && replay) {
    const bad = plan.actions.filter(a => a.preconditionHolds === false);
    check(bad.length === 0, `${name}: ${bad.length} precondition failures (first ${bad[0] && bad[0].id} ${bad[0] && bad[0].name})`);
    check(m.sim.goalHolds !== false, `${name}: goal does not hold`);
    const unbound = [...plan.nodes.values()].filter(n => n.issues.some(i => /not defined|do not match|does not decompose/.test(i)));
    check(unbound.length === 0, `${name}: binding issues, e.g. ${unbound[0] && unbound[0].id + ' ' + unbound[0].issues[0]}`);
  }
}

function section(title, fn) {
  console.log(title);
  try { fn(); } catch (e) { failures++; console.log('  FAIL threw: ' + (e.stack || e)); }
}

const FX = path.join(HERE, 'fixtures');

section('sexpr / hddl', () => {
  const forms = HTNV.sexpr.parse('(a (b c) ; comment\n D)');
  check(JSON.stringify(forms) === '[["a",["b","c"],"d"]]', 'sexpr parse + case folding + comments');
  const d = HTNV.hddl.parseDomain(read(path.join(FX, 'po_domain.hddl')));
  check(Object.keys(d.methods).length === 5 && Object.keys(d.actions).length === 5, 'po domain counts');
  check(d.methods['m-breakfast'].ordering.length === 2 && !d.methods['m-breakfast'].totallyOrdered, 'partial ordering parsed');
  check(d.methods['m-coffee'].totallyOrdered && d.methods['m-coffee'].ordering.length === 1, 'ordered-subtasks parsed');
  check(HTNV.hddl.classify('(define (domain x))') === 'domain' && HTNV.hddl.classify('==>\n1 a') === 'plan', 'classify');
});

section('partial-order fixture (hand-written, interleaved)', () => {
  const m = build(path.join(FX, 'po_plan.txt'), path.join(FX, 'po_domain.hddl'), path.join(FX, 'po_problem.hddl'));
  checkInvariants('po', m);
  const { nodes } = m.plan;
  const st = (id, t) => HTNV.schedule.status(nodes.get(id), t);
  check(st('11', 2) === 'active' && st('12', 2) === 'active', 'coffee and toast both active at step 3');
  check(st('13', 3) === 'future' && st('13', 4) === 'done', 'empty tidy method placed after its siblings');
  check(nodes.get('11/m').binding['?b'] === 'arabica', 'extra method variable bound from subtasks');
  check(nodes.get('13/m').children.length === 0 && nodes.get('13').start === 4, 'empty method zero-length span');
  check(m.sim.finalState.has('coffee cup1') && m.sim.finalState.has('clean'), 'replay incl. forall/when effects');
  check(m.sim.goalHolds === true, 'goal holds');
  const ex = HTNV.state.explain(nodes.get('3').def.precondition, nodes.get('3').binding, m.sim.stateAt(nodes.get('3').start), m.ctx);
  check(ex.type === 'atom' && ex.text === 'ground arabica' && ex.value === true, 'explain grounded precondition');
});

section('partial-order fixture (planner output, not interleaved)', () => {
  const m = build(path.join(FX, 'po_plan_sibylsat.txt'), path.join(FX, 'po_domain.hddl'), path.join(FX, 'po_problem.hddl'));
  checkInvariants('po-sibylsat', m);
  check(m.plan.root.children[0].children[0].name === 'make-toast', 'children re-sorted by execution time');
});

section('corrupted plan is flagged', () => {
  const text = read(path.join(FX, 'po_plan.txt')).replace('4 toast bread1', '4 toast bread1\n9 toast bread1');
  const m = HTNV.model.build({ planText: text.replace('2 slice bread1\n', ''),
    domainText: read(path.join(FX, 'po_domain.hddl')), problemText: read(path.join(FX, 'po_problem.hddl')) });
  check(m.plan.actions.some(a => a.preconditionHolds === false), 'precondition failure detected');
  check(m.issues.some(i => /not part of the decomposition/.test(i)), 'unreachable action reported');
});

section('total-order fixture (raw planner log: colours, recursion, empty methods)', () => {
  const m = build(path.join(FX, 'to_plan_sibylsat.log'), path.join(FX, 'to_domain.hddl'), path.join(FX, 'to_problem.hddl'));
  check(m.plan.actions.length === 13, `13 actions (got ${m.plan.actions.length})`);
  check(m.plan.root.name === 'deliver-all', 'single root task is the root');
  checkInvariants('to', m, { totalOrder: true });
  const empty = [...m.plan.nodes.values()].filter(n => n.kind === 'method' && n.name === 'm-goto-here');
  check(empty.length === 6 && empty.every(n => n.start === n.end), 'empty methods have zero-length spans');
  const deliver = [...m.plan.nodes.values()].find(n => n.kind === 'method' && n.name === 'm-deliver');
  check(deliver.binding['?src'] === 'depot' && deliver.binding['?dst'] === 'c', 'method variables bound from subtasks');
  check(m.sim.finalState.has('reported r1') && m.sim.goalHolds === true, 'replay reaches the goal');
});

section('timed plan (start/end times, durations, parallel actions)', () => {
  const files = [path.join(FX, 'po_plan_timed.txt'), path.join(FX, 'po_domain.hddl'), path.join(FX, 'po_problem.hddl')];
  const m = build(...files);
  const { plan, schedule, sim } = m;
  const at = t => schedule.timePoints.indexOf(t);
  check(plan.timed && schedule.temporal && schedule.timePoints.join() === '0,1,2,3,4', 'time points are the starts and ends');
  check(schedule.actionsAt(2).map(a => a.name).sort().join() === 'brew,toast', 'brew (3 units) runs together with toast');
  const st = (id, t) => HTNV.schedule.status(plan.nodes.get(id), t);
  check(st('11', 2) === 'active' && st('12', 2) === 'active' && st('12', 3) === 'done' && st('11', 3) === 'active', 'statuses follow the intervals');
  check(plan.nodes.get('13').start === 4, 'empty method placed after its siblings');
  check(sim.stateAt(at(1)).has('ground arabica') && !sim.stateAt(at(0)).has('ground arabica'), 'effects applied at the end');
  check(sim.stateAt(at(3)).has('clean'), 'conditional effect evaluated in the state at the end (beans still ground at t = 3)');
  check(!sim.stateAt(at(3)).has('coffee cup1') && sim.stateAt(at(4)).has('coffee cup1') && !sim.stateAt(at(4)).has('ground arabica'),
    'long action takes effect only when it ends');
  check(sim.pendingAt(at(2)).add.has('coffee cup1') && sim.pendingAt(at(2)).add.has('toasted bread1'), 'pending effects of running actions');
  check(plan.actions.every(a => a.preconditionHolds === true) && sim.goalHolds === true, 'replay valid, goal holds');
  check(HTNV.schedule.assignLanes(plan.actions).lanes === 2, 'two lanes in the timeline');
  checkInvariants('timed', m, { replay: true, timed: true });

  // Two actions ending together, one adding what the other deletes.
  const conflict = HTNV.model.build({ planText: read(files[0]).replace('4 toast bread1 2 3', '4 toast bread1 2 3\n9 grind arabica 3 4'),
    domainText: read(files[1]), problemText: read(files[2]) });
  check(conflict.plan.actions.find(a => a.id === '9').issues.some(i => /Conflicting effects/.test(i)), 'simultaneous add/delete reported');

  const mixed = HTNV.model.build({ planText: read(files[0]).replace('3 slice bread1 1 2', '3 slice bread1') });
  check(!mixed.plan.timed && mixed.issues.some(i => /start\/end times/.test(i)), 'partially timed plan falls back to sequential');
});

section('timeline lanes', () => {
  const m = build(path.join(FX, 'to_plan_sibylsat.log'));
  check(HTNV.schedule.assignLanes(m.plan.actions).lanes === 1, 'sequential plan uses one lane');
  // Overlapping intervals, as a parallel schedule would produce.
  const acts = [[0, 2], [1, 3], [2, 4], [3, 5], [1, 2]].map(([start, end]) => ({ start, end }));
  const { lanes, laneOf } = HTNV.schedule.assignLanes(acts);
  check(lanes === 3, `overlapping actions get separate lanes (got ${lanes})`);
  check(acts.every(a => acts.every(b => a === b || laneOf.get(a) !== laneOf.get(b) || a.end <= b.start || b.end <= a.start)),
    'no two actions in the same lane overlap');
});

section('compiled quantifier arguments', () => {
  // Some planners compile forall preconditions away and append the objects as
  // extra action arguments, e.g. "report-done r1 p1 p2 p3".
  const text = read(path.join(FX, 'to_plan_sibylsat.log')).replace('255 report-done r1', '255 report-done r1 p1 p2 p3');
  const m = HTNV.model.build({ planText: text,
    domainText: read(path.join(FX, 'to_domain.hddl')), problemText: read(path.join(FX, 'to_problem.hddl')) });
  const report = m.plan.actions.find(a => a.name === 'report-done');
  check(report.binding['?r'] === 'r1' && report.extraArgs.join(' ') === 'p1 p2 p3', 'extra arguments kept apart');
  checkInvariants('to-compiled', m, { totalOrder: true });
});

const benchDir = process.argv[2];
if (benchDir) {
  section(`benchmark corpus in ${benchDir}`, () => {
    let n = 0;
    for (const f of fs.readdirSync(benchDir).filter(f => f.endsWith('.log')).sort()) {
      const name = f.replace('.log', '');
      const filesPath = path.join(benchDir, name + '.files');
      const text = read(path.join(benchDir, f));
      if (!exists(filesPath) || !text.includes('==>')) continue;
      const [domainFile, problemFile] = read(filesPath).trim().split('|');
      const t0 = Date.now();
      const m = build(path.join(benchDir, f), domainFile, problemFile);
      checkInvariants(name, m, { totalOrder: name.startsWith('total') });
      n++;
      console.log(`  ok-ish ${name}: ${m.plan.actions.length} actions, depth ${m.depth}, ${Date.now() - t0} ms` +
        (m.issues.length ? `  [${m.issues.length} issue(s): ${m.issues[0]}]` : ''));
    }
    console.log(`  ${n} plans checked`);
  });
}

console.log(`\n${passed} checks passed, ${failures} failed`);
process.exit(failures ? 1 : 0);
