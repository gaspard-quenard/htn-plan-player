// Builds everything the views need from raw file contents.
// Domain and problem are optional; without them the tree and player still work.
(function (root) {
  'use strict';
  const HTNV = root.HTNV = root.HTNV || {};

  function build({ planText, domainText, problemText }) {
    const issues = [];
    const plan = HTNV.plan.parsePlan(planText);
    issues.push(...plan.issues);

    const schedule = HTNV.schedule.forPlan(plan);
    HTNV.schedule.computeSpans(plan, schedule);

    let domain = null, problem = null, ctx = null, sim = null;
    if (domainText) {
      domain = HTNV.hddl.parseDomain(domainText);
      issues.push(...domain.warnings);
      HTNV.bind.bindAll(plan, domain);
    }
    if (domain && problemText) {
      problem = HTNV.hddl.parseProblem(problemText);
      issues.push(...problem.warnings);
      if (problem.domain && problem.domain !== domain.name) {
        issues.push(`The problem is for domain "${problem.domain}" but the loaded domain is "${domain.name}"`);
      }
      ctx = HTNV.state.context(domain, problem);
      sim = new HTNV.state.Simulation(plan, schedule, ctx);
      issues.push(...sim.issues);
    }

    const counts = { action: 0, task: 0, method: 0 };
    let depth = 0;
    (function walk(n, d) {
      counts[n.kind] = (counts[n.kind] || 0) + 1;
      depth = Math.max(depth, d);
      n.children.forEach(c => walk(c, d + 1));
    })(plan.root, 0);

    const objects = new Set();
    plan.nodes.forEach(n => n.args.forEach(a => objects.add(a)));
    if (ctx) Object.keys(ctx.types.objects).forEach(o => objects.add(o));

    return { plan, schedule, domain, problem, ctx, sim, issues, counts, depth, objects: [...objects].sort() };
  }

  HTNV.model = { build };
})(typeof window !== 'undefined' ? window : globalThis);
