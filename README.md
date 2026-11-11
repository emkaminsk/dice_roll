# Dice Roll & Random Picker

A lightweight, browser-based collection of fair random-selection tools. No login, no
installation, nothing stored — reload the page to start fresh. It bundles nine
independent quick tools on one tab, plus a rule-based **Group Draw** view on a second
tab (linkable as `#group-draw`) and an **Assign Options** view on a third (`#assign-options`):

- **🎲 Dice Roller** — roll one or several dice with any number of sides; see each
  die and the total.
- **🎡 Wheel of Fortune** — type a list of names and spin an animated wheel to pick a winner, complete with a full-screen winner announcement and confetti burst. The name list is remembered between reloads (via `localStorage`, when available).
- **🪙 Coin Flip** — flip a coin with an animated 3D toss (heads/tails), plus a session streak counter that tracks the current run and total flips.
- **🎱 Magic 8-Ball** — ask a yes/no question, shake the ball, and get one of the 20 classic answers revealed in its triangle window. For entertainment only.
- **🥤 Draw Straws** — a colourful bundle of straws in a cup; pick how many, then tap to pull one at a time until the short straw turns up. The short straw is chosen fairly up front; "New round" reshuffles.
- **👥 Team Splitter** — paste a list of names and split them fairly into N random teams (uniform Fisher–Yates shuffle, then round-robin dealing so team sizes differ by at most one). Re-splitting reshuffles.
- **🎰 Lucky Numbers** — draw k unique numbers from 1..N with presets for common
  lotteries (6 from 49, 5 from 50, …); the draw is a uniform k-combination (partial
  Fisher–Yates), revealed as ball-machine style balls and shown sorted ascending.
- **🥠 Fortune Cookie** — crack open an animated cookie to reveal a playful fortune
  plus six "lucky numbers" (unique, from 1..69). Both are chosen fairly up front; the
  crack is pure decoration. For entertainment only.
- **🎯 Random Picker** — enter options and draw one at random; add as many independent picker sections as you like.
- **🧩 Group Draw** (second tab) — define people with custom attributes, then draw them
  into groups under per-group rules (size, counts incl. combined `a = x and b = y` conditions, sums, keep apart/together,
  spread evenly, pin a person, pair two people together/apart), each rule a *must* or a *nice to have*. Mark people away
  for a day, draw several rounds with as few repeat pairings as possible, fix a result by hand (tap to swap/move, re-checked
  live) and reveal it on the big screen in presenter mode. Strict
  mode explains impossible setups; "best effort" returns the closest split. Setups can
  be pasted, imported/exported as JSON, and are autosaved in this browser only. Full
  behaviour, algorithm and fairness notes: [`.ai/spec-group-draw.md`](.ai/spec-group-draw.md).
- **🏷️ Assign Options** (third tab) — hand out labels (chores, roles, topics…) to people over
  several rounds: slots per round for each label, labels per person per round, "once per person"
  labels, prefer variety, keep a round and redraw the rest, by-person / by-label views, copy/CSV,
  and a full-screen presenter (all at once or person by person). People can be pasted or imported
  from a Group Draw export. Independent of Group Draw. Spec:
  [`.ai/spec-assign-options.md`](.ai/spec-assign-options.md).

All randomness uses the browser's `crypto.getRandomValues()` with rejection sampling
for uniform, unbiased results. The wheel is rendered on a `<canvas>` with
`requestAnimationFrame`. There is **no back-end** — everything runs client-side.

## Website

You can try out the app at [https://diceroll.byst.re/](https://diceroll.byst.re/)

## Run / test the page locally

The app is a set of static files in `appFE/`. Any static web server works — no build
step is needed.

```bash
cd appFE
python3 -m http.server 8000
```

Then open `http://localhost:8000/` in your browser and try the three tools. Reload the
page to reset everything.

> Tip: open the file directly (`file://.../appFE/index.html`) and it mostly works too,
> but serving over HTTP is recommended so the manifest/icons resolve correctly.

For automated browser tests, see [Tests](#tests) below.

## Deploy to a VPS (nginx)

The app is static, so deployment is just copying the contents of `appFE/` to the web
root that nginx serves. No application server, Docker, or open API ports are required.

1. **Copy the files to the server** (from your machine):

   ```bash
   sudo rsync -av --delete /home/marcin/gitrepos/dice_roll/appFE/ /var/www/diceroll
   ```
   ```bash
   rsync -av --delete appFE/ user@your-server:/var/www/diceroll/
   ```

   `--delete` keeps the web root in sync with `appFE/` by removing stale files.

2. **Point an nginx server block at that directory** (e.g. `/etc/nginx/sites-available/diceroll`):

   ```nginx
   server {
       listen 80;
       server_name diceroll.example.com;
       root /var/www/diceroll;
       index index.html;

       location / {
           try_files $uri $uri/ =404;
       }
   }
   ```

3. **Enable the site and reload nginx** (on the server):

   ```bash
   sudo ln -s /etc/nginx/sites-available/diceroll /etc/nginx/sites-enabled/
   sudo nginx -t && sudo systemctl reload nginx
   ```

4. **Add HTTPS** (recommended) with Let's Encrypt:

   ```bash
   sudo certbot --nginx -d diceroll.example.com
   ```

To publish updates later, re-run the `rsync` command from step 1 — no restart needed.

## Tech stack

HTML5, Bootstrap 4, and vanilla JavaScript (ES2015+). No build step, no framework, no
server-side code. See [`.ai/tech-stack.md`](.ai/tech-stack.md) for the rationale.

## Project structure

```
appFE/
  index.html         # single page: Quick Tools tab (nine tools) + Group Draw + Assign Options tabs
  style.css          # modern-clean custom theme
  random.js          # shared uniform RNG (crypto.getRandomValues)
  page_utils.js      # neutral shared helpers (window.PageUtils): CSV cell, download, copy, notice, confetti, Worker runner
  celebration.js     # full-screen winner overlay + confetti (used by the wheel)
  dice_roll.js       # dice roller
  value_selector.js  # add/remove independent picker sections
  theme.js           # light/dark toggle (follows OS by default, choice saved locally)
  wheel.js           # canvas Wheel of Fortune (name persistence + celebration)
  coin_flip.js       # animated 3D coin flip with a session streak counter
  eight_ball.js      # Magic 8-Ball (shake + reveal a classic answer)
  draw_straws.js     # draw straws — bundle in a cup, one short straw per round
  team_splitter.js   # team splitter — Fisher–Yates shuffle + round-robin dealing
  lottery.js         # lucky numbers — unique k-combination draw with a ball reveal
  fortune_cookie.js  # fortune cookie — crack animation, fortune + lucky numbers reveal
  view_tabs.js       # view tab switcher (URL hash, arrow keys)
  group_draw_solver.js # Group Draw solver — pure, DOM-free (window.GroupDrawSolver)
  group_draw.js      # Group Draw UI — editors, paste/import, Worker draw, reveal, history
  assign_options_solver.js # Assign Options solver — pure, DOM-free (window.AssignOptionsSolver)
  assign_options.js  # Assign Options UI — people/labels editors, draw, results, presenter
  assign_options.css # Assign Options look (ao-* classes, light/dark)
  data/              # content datasets for content-driven tools
    eightball.js     # the 20 classic Magic 8-Ball answers (EIGHTBALL_ANSWERS)
    fortunes.js      # the fortune-cookie fortunes (FORTUNES)
    group_draw_example.js # "Load example" setup for Group Draw (GROUP_DRAW_EXAMPLE)
tests/
  test_app.py        # Playwright end-to-end tests (quick tools, Group Draw)
  test_assign_options.py # Assign Options tests (own server on port 8124)
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
