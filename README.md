# Dice Roll & Random Picker

A lightweight, browser-based collection of fair random-selection tools. No login, no
installation, nothing stored — reload the page to start fresh. It bundles three
independent tools on a single page:

- **🎲 Dice Roller** — roll a die with any number of sides.
- **🎡 Wheel of Fortune** — type a list of names and spin an animated wheel to pick a winner.
- **🎯 Random Picker** — enter options and draw one at random; add as many independent picker sections as you like.

All randomness uses the browser's `crypto.getRandomValues()` with rejection sampling
for uniform, unbiased results. The wheel is rendered on a `<canvas>` with
`requestAnimationFrame`. There is **no back-end** — everything runs client-side.

## Website

You can try out the app at [https://diceroll.byst.re/](https://diceroll.byst.re/)

## How to run it

The app is a set of static files in `appFE/`. Any static web server works.

```bash
cd appFE
python3 -m http.server 8000
```

Then open `http://localhost:8000/` in your browser.

In production it is served as static files by nginx — deployment is simply copying
the contents of `appFE/` to the web root.

## Tech stack

HTML5, Bootstrap 4, and vanilla JavaScript (ES2015+). No build step, no framework, no
server-side code. See [`.ai/tech-stack.md`](.ai/tech-stack.md) for the rationale.

## Project structure

```
appFE/
  index.html         # single page, three tools
  style.css          # modern-clean custom theme
  random.js          # shared uniform RNG (crypto.getRandomValues)
  dice_roll.js       # dice roller
  value_selector.js  # add/remove independent picker sections
  wheel.js           # canvas Wheel of Fortune
tests/
  test_app.py        # Playwright end-to-end tests
```

## Tests

End-to-end tests live in `tests/` and use [Playwright](https://playwright.dev/python/)
to drive a headless browser against the static front-end (served automatically by the
test fixture). They cover the dice, picker, and wheel tools and assert there are no
console errors.

Run from the repository root with [uv](https://docs.astral.sh/uv/):

```bash
# One-time: install the headless Chromium browser binary
uv run --with playwright playwright install chromium

# Run the suite
uv run --with playwright --with pytest pytest tests/
```

The tests serve `appFE/` on a local port, so no server needs to be running beforehand.

## License

This project is licensed under the MIT License.
