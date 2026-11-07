# Plan — light/dark mode toggle (top right)

## Findings
- Dark mode already exists, but only via `@media (prefers-color-scheme: dark)` — the user
  cannot choose. 5 such blocks in `appFE/style.css` (tokens l.40, Bootstrap button
  re-tints l.213, status tokens l.1105, Group Draw team names l.1568, Group Draw selects l.1689).
- Colours are already CSS tokens (`--bg`, `--surface`, `--ink`, …), so theming = swapping tokens.
- No JS reads the colour scheme (wheel/canvas has no theme-dependent colours) → no JS redraw needed.
- Top-left already has a fixed round `.home-link` button (hard-coded white bg, `!important`
  rules, l.1626+; mobile override l.1583). The toggle mirrors it on the right.
- Only existing `localStorage` use is guarded try/catch (wheel, group draw) — same pattern here.

## Design
- Theme lives in `<html data-theme="light|dark">`. Default = system preference; an explicit
  click is saved to `localStorage` (guarded; page works without it).
- Tiny inline `<script>` in `<head>` (before CSS paint) sets `data-theme` → no flash of the wrong theme.
- Convert the 5 media blocks from `@media (prefers-color-scheme: dark) { … }` to
  `:root[data-theme="dark"] …` selectors — one source of truth, no duplicated token sets.
  Trade-off: with JS disabled the page is light-only (the page needs JS anyway).
- If the user never chose, follow live OS changes (`matchMedia` change listener).
- Toggle = round fixed button, top right, same size/shadow/hover as `.home-link`; sun icon
  in dark mode / moon icon in light mode (Font Awesome already bundled — verify glyphs exist),
  `aria-label` "Switch to dark/light mode", `aria-pressed`, ≥44px touch target,
  icon swap/rotate animation (disabled under `prefers-reduced-motion`).
- Restyle `.home-link` for dark so both corner buttons match (use tokens, not `#fff`).
- Mobile (≤576px): same corner position as home-link, mirrored; header padding already reserves space.

## Steps
- [ ] 1. `index.html`: head inline theme script; `<button id="theme-toggle">` after `.home-link`.
- [ ] 2. New `appFE/theme.js` (toggle handler, storage, system-change listener); load at bottom of `index.html`.
- [ ] 3. `style.css`: convert 5 media blocks to `[data-theme="dark"]`; add `.theme-toggle` styles; token-ise `.home-link`.
- [ ] 4. Tests in `tests/test_app.py`: toggle present top-right; click flips `data-theme` and computed
        body background; choice survives reload; default follows `color_scheme="dark"` emulation;
        tools unaffected by toggling; no console errors.
- [ ] 5. `ux-polisher` pass: contrast in both themes on every tool + Group Draw view, 375px, reduced motion.
- [ ] 6. Docs: tick "Dark mode" in `ROADMAP.md` (note manual toggle), add `theme.js` to README project structure.
- [ ] 7. Verify (`verify-app` skill: full Playwright suite + screenshots light/dark desktop & 375px), then commit + push.

## Out of scope
- A third "System" option in the toggle (could be added later as a 3-state control).
- Changing the palette itself.
