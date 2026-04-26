---
name: ReleaseManager
description: |
  Release SOP walker — bump → tag → bundle → publish → deploy → announce.
  The skill bundle Forge composes for end-to-end releases.

  Day-one scope: grove only. Generalising to other ecosystem repos is a
  Phase G iteration; do not add per-repo branching in Phase 3.
triggers:
  - release
  - bump version
  - cut release
  - deploy staged
  - trust gate check
  - rollback release
  - announce release
---

# ReleaseManager

> **Status: scaffold (Phase 1).** Workflows + scripts implementation lands in Phase 3 — see the iteration tracking issue on `the-metafactory/release-manager`.

This file is the entry point an agent loads when any of the trigger phrases above appears. The full implementation is split across `Workflows/` and `scripts/`.

## Overview

ReleaseManager walks the seven release workflows in order:

1. **BumpVersion** — derive patch/minor/major from the commit log, edit `arc-manifest.yaml`, commit.
2. **CutRelease** — tag, push, create the GitHub release with generated notes.
3. **TrustGateCheck** — run the gate table; halt on first failure.
4. **DeployStaged** — dev first, then prompt-then-prod (separate workflow run for prod).
5. **Rollback** — revert a deploy by re-tagging the previous version.
6. **Announce** — post a one-liner to the Discord entity thread linking to the GitHub release.
7. **ScaffoldInstance** — create per-instance state folders (calls `AgentState/ScaffoldFolders`).

## Critical rules

See `docs/agents-md/critical-rules.md` in this repo. Summary:

- Production deploys are **always** a separate workflow run.
- Trust-gate failures are **blocking**, not advisory.
- Day-one scope is **grove only** — no per-repo branching.
- `arc publish --dry-run` runs **first**; real publish only after operator confirm.
- Never edit `arc-manifest.yaml` without showing the diff + bump rationale.

## Phase 3 deliverables

Tracked in the `Iteration 1 — ReleaseManager MVP` issue on this repo:

- 7 workflow files in `Workflows/`
- 3 scripts in `../scripts/`
- Tests for each script
- `arc publish --dry-run` to dev and verified
