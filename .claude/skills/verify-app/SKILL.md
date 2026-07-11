---
name: verify-app
description: Serve the page locally and run the Playwright e2e suite. Use before every commit that touches appFE/ or tests/, and whenever asked to run, test, or verify the app.
---

# Verify the app

## Run the e2e suite (the primary check)

From the repository root:

```bash
# One-time per machine: install the headless Chromium for Python Playwright
uv run --with playwright playwright install chromium

# Run the suite
uv run --with playwright --with pytest pytest tests/
```

Notes:
- The tests serve `appFE/` themselves on port 8123 — no server needed beforehand.
- The `page` fixture fails a test on **any** console or page error, so a green suite
  also means a clean console.
- If `uv` is missing: `pip install playwright pytest && playwright install chromium`
  then `pytest tests/`.
- If Chromium download is blocked, retry `playwright install chromium` a few times;
  as a fallback launch with an existing system Chromium via
  `p.chromium.launch(executable_path=...)` only for local debugging — never commit
  that change.

## Manual smoke test

```bash
cd appFE && python3 -m http.server 8000
```

Open http://localhost:8000/ (or drive it with Playwright/screenshots when headless).
Check: each tool produces results, no console errors, layout holds at ~375px width,
using one tool doesn't disturb another.

## When it fails

- Fix the app, not the assertion, unless the test itself is wrong about intended
  behavior (the PRD in `.ai/prd.md` is the arbiter).
- Flaky animation waits: prefer `page.wait_for_function` on the result text with a
  generous timeout (the wheel test uses 8s) over sleeps.
