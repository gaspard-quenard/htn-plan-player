# HTN Plan Player

A browser player for hierarchical (HTN) plans. It shows the decomposition tree
(initial task → method → subtasks → … → actions) and plays the plan step by step,
colouring what is done, in progress, executing and upcoming. It works for
total-order and partial-order plans, and for plans with durations and parallel
actions.

No installation, build step or server is needed. Open `index.html` in a browser,
or host this folder as-is on any static web server.

## Using it

1. Run any HTN planner that writes its solution in the
   [IPC-2020 hierarchical plan format](https://ipc2020.hierarchical-task.net/),
   such as [SibylSat](https://github.com/gaspard-quenard/sibylsat/) or [PANDA](https://github.com/panda-planner-dev/pandaPIengine). Save its output to a file. The full log
   is fine, because the viewer extracts the last `==> … <==` block.
2. Open `index.html` and drop the plan file on the page. You can also add the
   domain and problem `.hddl` files, in any order or all at once, since the file
   type is detected from the content.

The welcome screen also has two small built-in examples. *Close* (top bar) goes
back to it. *Which files can I load?* on the welcome screen describes the
accepted formats. It is the same content as the [file formats](#file-formats)
section below.

### What you get

The plan alone gives:

- the decomposition tree, left to right or top to bottom (`O`);
- the player, and a breadcrumb that reads from the root task down to the current
  action;
- a timeline of the actions in execution order (`T`);
- a focus mode that collapses everything not in progress;
- object highlighting: click an object name (such as `r1`) anywhere to highlight
  everything involving it.

With the domain and problem you also get:

- **Details** of any node:
  - its grounded definition;
  - its preconditions, each marked ✓ / ✗ in the state where it is checked;
  - its effects;
  - for methods: their variables (including those deduced from the state),
    their subtasks, and their ordering constraints drawn as a small diagram.
- **World state**: the facts true at the current step. The changes the running
  actions will make are marked, and static facts are folded away.
- **Checks**:
  - actions started while their precondition is false (red marks on the step bar);
  - conflicting simultaneous effects;
  - a goal that does not hold;
  - subtasks that do not match their method.

When an action is selected, the details follow the action being executed as the plan
plays or steps; a selected task or method stays selected.

Press `?` in the viewer for the help and keyboard shortcuts.

When the folder is hosted, a view can be shared with URL parameters:
`index.html?plan=URL&domain=URL&problem=URL&t=12&hl=r1&orient=td&focus=1&methods=0&timeline=0&theme=light`.
Files opened from disk are kept in the browser's local storage, so they come back
on reload until you press *Close*. They are never uploaded.

## File formats

### Plan

```
==>
1 pick-up r1 p1 depot
2 move r1 depot a
root 10
10 deliver-all r1 -> m-deliver-next 11 12
11 deliver r1 p1 -> m-deliver 1 2
12 deliver-all r1 -> m-deliver-finished
<==
```

- `<id> <action> <args>`: the primitive actions, in execution order.
- `root <ids>`: the initial task(s).
- `<id> <task> <args> -> <method> <subtask ids>`: one decomposition per abstract
  task. A method without subtask ids is an empty decomposition.

Partial-order plans use the same format. Their actions may interleave between
subtasks.

### Timed plans (durations, parallel actions)

An action line may end with its start and end times, two integers with
`end > start`:

```
==>
1 grind arabica 0 1
2 brew arabica cup1 1 4
3 slice bread1 1 2
4 toast bread1 2 3
...
```

Object names cannot start with a digit, so the times cannot be mistaken for
arguments. Without times, the actions run one after the other, one time unit
each. If only some actions have times, the times are ignored and a warning is
shown. The rules are:

- the precondition of an action is checked when it starts;
- its effects are applied when it ends;
- when some actions end and others start at the same time, the effects come
  first;
- an atom added by one action and deleted by another at the same time is
  reported as a conflict.

The player steps through the times where an action starts or ends, and the
timeline puts actions that overlap in time on separate lanes.

### Domain and problem

HDDL, as in the IPC hierarchical tracks. Supported:

- types, constants, objects, initial state, goal, initial task network;
- tasks; methods with totally or partially ordered subtasks, preconditions and
  constraints;
- actions with negative, disjunctive (`or`, `imply`), quantified (`forall`,
  `exists`) and equality preconditions, and conditional (`when`) and quantified
  effects.

Numeric fluents and durative actions in the domain are not supported yet.
