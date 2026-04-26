# Workflow: DeployStaged

Deploy to dev, smoke-test, then (in a **separate** workflow run) deploy to production.

> **Day-one scope:** grove only. The deploy commands target the grove cloud Worker / dashboard. Generalisation is v0.2.

## Pre-flight

- The release tag from `CutRelease` exists on `origin`.
- `TrustGateCheck` (if applicable to this milestone) has reported `allPassed: true`.
- The operator has explicitly invoked this workflow with an `env` argument: `dev` or `production`.

## Action

### env = `dev`

1. Deploy:
   ```bash
   bunx wrangler deploy --env dev
   ```
2. Smoke-test:
   - `curl -fsS https://<dev-url>/health` returns 200
   - Tail logs for 60 seconds: `bunx wrangler tail --env dev` — no `error` / `panic` lines
   - Spot-check one user-facing endpoint per app surface
3. Record the dev-deploy timestamp in the events table (`system.deploy.dev` event with `version`, `sha`, `operator`).
4. Stop. **Do not chain into production from the same invocation.**

### env = `production`

1. **Refuse unless** the events table shows a `system.deploy.dev` event for this version within the last 4 hours. If absent, halt with: `prior dev deploy not found for v<X.Y.Z> within 4h window`.
2. Confirm operator intent with an explicit second prompt — `ship` keyword required.
3. Deploy:
   ```bash
   bunx wrangler deploy --env production
   ```
4. Smoke-test against production health endpoints; watch logs 15 minutes.
5. Record `system.deploy.production` event.

## Verify

- Health endpoints return 200 under both envs.
- No error spike in the logs window.
- Events table has the matching `system.deploy.<env>` row with version + SHA.

## Anti-pattern

- **Never deploy prod in the same workflow run as dev.** Two separate invocations, two separate operator confirmations. This is the single most important rule in this workflow.
- Never deploy prod without the dev-deploy guard within the 4h window — staleness invalidates the smoke signal.
- Never skip the `wrangler tail` log watch. Errors that only show under load won't surface in `curl /health`.
- Never deploy with a dirty working tree. If you need a hotfix, do a patch bump + new release first.
