\
# Workflow & Operating Principles

Working agreement for how Claude Code operates in this project.
Read at session start. Applies to every task unless explicitly overridden.

---

## Core Principles

These three override everything below. When a rule in this document conflicts with one of
these, these win.

| Principle | Meaning |
|---|---|
| **Simplicity First** | Make every change as simple as possible. Impact minimal code. |
| **No Laziness** | Find root causes. No temporary fixes. Senior developer standards. |
| **Minimal Impact** | Only touch what's necessary. No side effects that introduce new bugs. |

---

## 1. Plan Mode Default

- Enter plan mode for **any** non-trivial task — 3+ steps, or any architectural decision.
- If something goes sideways, **STOP and re-plan immediately**. Do not push through a plan
  that has already been invalidated.
- Use plan mode for **verification steps**, not just for building.
- Write detailed specs upfront to reduce ambiguity.

> Ambiguity resolved before writing code costs minutes. Ambiguity discovered after costs hours.

---

## 2. Subagent Strategy

- Use subagents liberally to keep the main context window clean.
- Offload research, exploration, and parallel analysis to subagents.
- For complex problems, throw more compute at it via subagents.
- **One task per subagent** for focused execution.

---

## 3. Self-Improvement Loop

- After **any** correction from the user: update `tasks/lessons.md` with the pattern.
- Write rules for yourself that prevent the same mistake recurring.
- Ruthlessly iterate on these lessons until the mistake rate drops.
- Review lessons at session start for the relevant project.

The loop is: **correction → pattern → rule → lower mistake rate.**
A correction that produces no written rule has been wasted.

---

## 4. Verification Before Done

- **Never mark a task complete without proving it works.**
- Diff behaviour between main and your changes when relevant.
- Run tests, check logs, demonstrate correctness.
- Ask: *"Would a staff engineer approve this?"*

Acceptable proof: passing tests, captured output, a screenshot, a reproduced-then-fixed error.
Not acceptable: "it should work", "the change looks correct", silence.

---

## 5. Demand Elegance (Balanced)

- For non-trivial changes: pause and ask *"is there a more elegant way?"*
- If a fix feels hacky: *"Knowing everything I know now, implement the elegant solution."*
- **Skip this for simple, obvious fixes** — don't over-engineer.
- Challenge your own work before presenting it.

The balance matters in both directions. Elegance on a one-line fix is waste; a hack in a core
abstraction is debt.

---

## 6. Autonomous Bug Fixing

- When given a bug report: **just fix it.** Don't ask for hand-holding.
- Point at logs, errors, failing tests — then resolve them.
- Zero context switching required from the user.
- Go fix failing CI tests without being told how.

---

## Task Management

Six steps, in order, for every tracked piece of work:

1. **Plan First** — write the plan to `tasks/todo.md` with checkable items.
2. **Verify Plan** — check in before starting implementation.
3. **Track Progress** — mark items complete as you go.
4. **Explain Changes** — high-level summary at each step.
5. **Document Results** — add a review section to `tasks/todo.md`.
6. **Capture Lessons** — update `tasks/lessons.md` after corrections.

### Files

| Path | Purpose |
|---|---|
| `tasks/todo.md` | Current plan, checkable items, and the review section on completion |
| `tasks/lessons.md` | Accumulated correction patterns and the rules derived from them |

---

## Quick Checklist

Before starting:
- [ ] Reviewed `tasks/lessons.md` for relevant patterns
- [ ] Plan written to `tasks/todo.md` and checked in
- [ ] Non-trivial work is in plan mode

Before saying done:
- [ ] Proved it works — tests, logs, or demonstrated output
- [ ] Asked whether a staff engineer would approve
- [ ] Only necessary files touched, no incidental side effects
- [ ] `tasks/todo.md` items marked complete, review section added
- [ ] Any correction from this session captured in `tasks/lessons.md`
