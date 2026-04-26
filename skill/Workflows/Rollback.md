# Workflow: Rollback

Codifies `compass/sops/release-checklist.md` lines 212–244. Revert production to a known-good prior tag.

> **Day-one scope:** grove only. The wrangler invocation targets the grove production environment. Generalisation is v0.2.

## Pre-flight

- A `system.deploy.production` event exists for the current bad version.
- The previous tag is determinable via `gh release list --repo the-metafactory/grove --limit 5` (default: tag immediately before the current production tag).
- The operator has acknowledged the rollback decision in writing (Discord thread or PR comment).

## Action

1. Resolve target tag:
   ```bash
   gh release list --repo the-metafactory/grove --limit 5
   ```
   Default to the tag immediately preceding the current production tag unless the operator overrides.
2. Check out the tag in the release worktree (never on main):
   ```bash
   git -C ~/Developer/release-manager-mvp checkout v<previous>
   ```
   Or, for grove specifically:
   ```bash
   git -C ~/Developer/grove checkout v<previous>
   ```
3. Re-deploy production from that tag:
   ```bash
   bunx wrangler deploy --env production
   ```
4. Verify health endpoint + error baseline (per `release-checklist.md` Phase 4 rollback procedure).
5. Record the rollback in the events pipeline:
   - emit `system.deploy.rollback` event with `from_version`, `to_version`, `reason`, `operator`
6. Return the working repo to the default branch:
   ```bash
   git checkout main
   ```
7. Open a `bug` + `now` issue describing the cause if not already open. Fix-forward in a subsequent patch release rather than leaving the rollback as the long-term state.

## Verify

- `gh release view --repo the-metafactory/grove --json tagName -q .tagName` is unchanged (the latest GitHub release still points at the bad version — rollback is a deploy action, not a tag-deletion action).
- The deployed Worker reports the rolled-back version on its `/version` endpoint (or equivalent).
- The events table shows the `system.deploy.rollback` row.
- A tracking issue exists for the cause.

## Anti-pattern

- **Never roll back without recording the cause in the events pipeline.** Silent rollbacks mask repeated failures and break the "every prod deploy is logged" rule from `release-checklist.md`.
- Never delete the bad tag or release. Tags are immutable history; deleting them rewrites the audit trail.
- Never roll back further than one prior version without explicit operator approval — rolling back N versions risks reintroducing closed bugs.
- Never leave the working tree on the rolled-back tag. Always return to the default branch before resuming work.
