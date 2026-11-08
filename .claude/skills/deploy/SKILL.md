---
name: deploy
description: Deploy/ship this app to production (the VPS behind https://diceroll.byst.re) — run tests, merge the current branch to master, push, verify. Use when asked to deploy, ship, or release, or why the live site differs from the repo.
---

# Deploy

The site is static files; production is nginx on a VPS serving `/var/www/diceroll`.

## The normal path — merge to master

`.github/workflows/deploy.yml` runs on every push to `master` (and via manual
`workflow_dispatch`): it SSHes to the VPS, `git pull`s the repo there, and rsyncs
`appFE/` into the web root with `--delete`.

So the release process is simply: get the change onto `master` and push, then verify.

## When asked to "deploy" or "ship"

Such a request is the explicit go-ahead to merge the current branch into `master`
and push (otherwise never commit/merge to master from an agent session). From the
feature branch:

1. **Pre-flight:** working tree clean (commit or ask about stray changes); note the
   current branch name. If already on `master` with nothing to merge, skip steps 3–4.
2. **Test:** run the full suite (skill `verify-app`: pytest + Playwright e2e). Stop
   and report if anything fails — do not merge.
3. `git checkout master && git pull --rebase`
4. `git merge --no-ff <feature-branch>` (if the merge conflicts, stop and report;
   don't resolve blindly).
5. **Re-test on master**; stop and report on any failure (don't push).
6. `git push`. If rejected, `git pull --rebase` and retry once; if it fails again,
   stop and report.
7. **Verify:** the push triggers the workflow — check the Actions run and load
   https://diceroll.byst.re/ (hard-refresh; assets aren't fingerprinted, so browsers
   may cache aggressively).
8. **Report:** test count, merge commit hash, and the Actions run status.

Don't delete the feature branch or force-push unless asked.

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
