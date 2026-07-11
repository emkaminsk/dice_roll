---
name: add-tool
description: Step-by-step recipe for adding a new tool/game card (coin flip, 8-ball, tarot, horoscope, …) to the entertainment page. Use whenever implementing a new tool, game, or fortune-telling feature from ROADMAP.md or a user request.
---

# Add a new tool to the page

Follow this recipe exactly; it keeps every tool consistent with the existing three
(dice, wheel, picker). Read `CLAUDE.md` constraints first — no build step, no
back-end, fair RNG only.

## 1. Logic: one JS file per tool

- Create `appFE/<tool_name>.js` (snake_case, like `dice_roll.js`). Plain script, no
  modules/imports — files are loaded via `<script>` tags in order.
- Wrap in an IIFE or use `document.addEventListener('DOMContentLoaded', …)` consistent
  with the existing files; never leak globals other than what's intentional.
- **All outcomes come from `randomIndex(n)` / `randomInt(min, max)`** (defined in
  `random.js`, already loaded). See skill `fair-random`. Pick the outcome first, then
  animate toward it — study `wheel.js` for the pattern (winner chosen up front, the
  canvas animation is steered to land on it).
- Content-driven tools (8-ball answers, fortunes, horoscope phrases, tarot meanings)
  keep their dataset in a separate file `appFE/data/<name>.js` defining one global
  `const`, loaded before the tool's script. Delegate dataset writing to the
  `fortune-content-writer` agent.

## 2. Markup: a tool-card section in index.html

- Add a `<section class="tool-card" aria-labelledby="<id>-title">` inside
  `<div class="tools-grid">`, with an emoji + `<h2>` title matching the existing style
  (`🎲 Roll the dice`, `🎡 Spin the wheel`).
- Reuse existing classes: `form-group`, `btn btn-primary`, `btn-row`, `result-line`,
  `narrow-input`. Results go in a `<p class="result-line" id="<tool>-result">`.
- Add `<script src="<tool_name>.js"></script>` at the bottom, **after** `random.js`
  (and after its data file, if any).
- Keep it accessible: labels on inputs, `aria-label` on canvases, buttons are real
  `<button>`s, result announced via text (consider `aria-live="polite"`).

## 3. Style

- Reuse `style.css` classes first; add new rules only for what's genuinely new, in the
  same section-commented style as the existing file. Must look right on mobile
  (the grid already wraps) — verify at ~375px width.

## 4. Tests (required — a tool without tests is not done)

Add tests to `tests/test_app.py` following its existing patterns:
- Use the `page` fixture (it serves `appFE/` itself and fails on any console error).
- Cover at minimum: (a) happy path produces a valid result, (b) invalid/empty input
  shows guidance without crashing, (c) if animated, the result appears within a
  timeout via `page.wait_for_function(...)` like `_rolled_value` / the wheel test.
- Run the suite per skill `verify-app` and make it pass.

## 5. Docs

- Tick the item in `ROADMAP.md`.
- Add the tool to the bullet list and "Project structure" tree in `README.md`.
- Fortune-telling tools get a visible "for entertainment only" note in their card.

## Definition of done

Suite green, no console errors, tool works at mobile width, other tools unaffected
(the independence tests must still pass), docs updated.
