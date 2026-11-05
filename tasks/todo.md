# Plan — label attributes in Group Draw rules

Scope (confirmed): **count rule only** for label attributes (min/max per group of
people whose label equals a chosen value). Exact-text matching. Empty values ignored.
Out of scope: keep apart / keep together on labels, size/sum (n/a). Spec reference:
`.ai/spec-group-draw.md` (§4.1 label kind, §4.3 rules, §9 parked item).

## Why this is small
The solver already treats count rules generically through `keyOf(value)` string
comparison (`group_draw_solver.js` `normalizeRules` counts, `validateHints`, `evaluate`,
`violationList`). Label support is mostly *un-blocking* the label kind and giving the UI
a way to pick a value. No change to the search algorithm.

## Changes

1. **Solver** (`appFE/group_draw_solver.js`)
   - `usable()` (~l.69-77): drop the `a.kind === 'label'` rejection for `count` rules;
     keep rejecting label for `sum`/`apart`/`together` (so `apart`/`together` stay
     category/integer only).
   - Verify `keyOf` compares labels as exact strings (no trim/case-fold) and that
     `describeRule` / hint messages read well for labels (“surname = Smith”).
   - Leave empty labels ignored (`keyOf` -> null) — already the behaviour.

2. **UI rule form** (`appFE/group_draw.js`)
   - `ruleAttrs(type)` (~l.795): for `count`, include labels; for `apart`/`together`
     keep `kind !== 'label'`.
   - `renderValueField()` (~l.884): for a label attribute, fill the value `<select>` with
     the **distinct non-empty values currently present in people**, sorted; show a hint
     “No values yet — add people first” and disable Add when there are none.
   - Re-run `renderValueField()` when people change (so new surnames appear) via the
     existing `changed()` path.
   - Help text l.828: replace “labels are display-only” with accurate wording per type.
   - `cleanRule()` (~l.208): allow label for `count` (import/autosave validation);
     validate that `value` is a non-empty string. Keep rejecting for other types.
   - Rule list / `ruleTarget()` labels: make sure label rules render like category ones.
   - Stale rules: if the last person with a rule's value is removed, keep the rule and let
     `validateHints` show the existing “Nobody has … — the rule has no effect” warning.

3. **Spec/README**: spec §4.1 (label: usable in count rules), §4.3 (rule table), §9
   (remove parked item, note keep-apart/together on labels still parked); README Group
   Draw entry needs no change (links to spec).

4. **Tests** (`tests/test_app.py`, Playwright, existing `_gd_*` helpers)
   - Solver via `page.evaluate`: label count rule (max 1 “Smith” per group) is honoured
     over many draws; infeasible case (3 Smiths, 2 groups, max 1) reports the rule;
     empty labels never match; exact-text (“smith” != “Smith”).
   - UI: add label attr + people, label appears as a rule target with a value dropdown
     of distinct values; rule can be added; draw satisfies it; value dropdown updates
     after adding a person; label still absent for sum/apart/together.
   - Export/import + autosave round trip keeps a label count rule; import with a label
     `apart` rule is still dropped.
   - Regression: whole existing suite (80 tests) passes.

5. **Verify & ship**: run `uv run --with playwright --with pytest pytest tests/`; ux-polisher
   quick look at the dropdown (dark mode, 375px); fairness-auditor not needed (no RNG or
   search changes). Branch `feature/group-draw-label-rules`, PR to master (note: `gh` is
   not logged in here, direct pushes to master worked last time).

## Risks / decisions to watch
- Exact matching means “Smith ” (trailing space) ≠ “Smith”; mitigated by the dropdown
  listing distinct values verbatim. Consider showing a note if two values differ only by
  case/whitespace (cheap hint, optional).
- Free-text labels can have hundreds of distinct values (e.g. unique surnames); the
  dropdown stays usable up to ~100 people, which matches real use.

## Review (done)
- [x] Solver: label allowed in count rules only (`usable()`); exact-text via `keyOf`.
- [x] UI: labels listed for count rules; value dropdown = distinct values of named people,
      sorted, refreshed on every change (selection kept); "No values yet" + Add disabled
      when empty; help text notes exact matching and flags case/space look-alikes.
- [x] Import/autosave: label count rules kept (blank value refused); label apart/together
      still refused — note: the whole import is rejected with an error (existing behaviour),
      not silently dropped.
- [x] Value select capped at 14rem (long surnames no longer stretch the form).
- [x] 5 new Playwright tests; full suite 85 passed. Dark mode checked at 1100/375px.
