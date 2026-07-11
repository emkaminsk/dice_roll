---
name: deploy
description: How this app is released to production (the VPS behind https://diceroll.byst.re). Use when asked about deploying, releasing, or why the live site differs from the repo.
---

# Deploy

The site is static files; production is nginx on a VPS serving `/var/www/diceroll`.

## The normal path — merge to master

`.github/workflows/deploy.yml` runs on every push to `master` (and via manual
`workflow_dispatch`): it SSHes to the VPS, `git pull`s the repo there, and rsyncs
`appFE/` into the web root with `--delete`.

So the release process is simply:

1. Get the change onto `master` (via PR from a feature branch — never commit to
   master directly from an agent session unless explicitly told to).
2. The workflow deploys automatically. Verify via the Actions run and by loading
   https://diceroll.byst.re/ (hard-refresh; assets aren't fingerprinted, so browsers
   may cache aggressively).

## Rules

- **Only `appFE/` ships.** Anything not meant for production (docs, tests, .claude)
  stays outside `appFE/`; anything the page needs (fonts, data files, icons) must be
  inside it — `--delete` removes stale files from the web root.
- Never touch or print the `VPS_*` secrets; don't edit `deploy.yml` (host, port,
  paths are environment-specific) without an explicit user request.
- No build step exists on the server: whatever is in `appFE/` at HEAD of master is
  exactly what's served. External CDN links in `index.html` (Bootstrap, Google Fonts)
  must stay valid.
- Before merging to master, the e2e suite must be green (skill `verify-app`).
