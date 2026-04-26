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

> **Status:** MVP (Phase 3 of meta-factory#390). Six workflows + three scripts shipped for the day-one grove scope. ScaffoldInstance lives in the `AgentState` bundle, not here.

This file is the entry point an agent loads when any of the trigger phrases above appears. The full implementation is split across `Workflows/` (action / verify / anti-pattern triplets) and `../scripts/` (bun-runnable CLIs).

## Overview

ReleaseManager walks the six release workflows in order. Each workflow MD has the same structure: **Pre-flight**, **Action**, **Verify**, **Anti-pattern**.

| # | Workflow                                      | Purpose                                                                          |
|---|-----------------------------------------------|----------------------------------------------------------------------------------|
| 1 | [BumpVersion](Workflows/BumpVersion.md)       | Decide patch/minor/major from commit prefixes; edit `arc-manifest.yaml`; commit. |
| 2 | [CutRelease](Workflows/CutRelease.md)         | Tag, push, create the GitHub release with generated notes.                       |
| 3 | [TrustGateCheck](Workflows/TrustGateCheck.md) | Walk the trust-gate table; halt on first failure.                                |
| 4 | [DeployStaged](Workflows/DeployStaged.md)     | Dev first, smoke-test, then prompt-then-prod (separate workflow run for prod).   |
| 5 | [Rollback](Workflows/Rollback.md)             | Revert prod to a known-good prior tag; record cause in events.                   |
| 6 | [Announce](Workflows/Announce.md)             | Post structured release note to Discord + tracking issue. **Always last.**       |

**ScaffoldInstance** (per-instance state folders) is **not** in this bundle — it lives in [AgentState](https://github.com/the-metafactory/agent-state). ReleaseManager assumes the instance state directory already exists.

## Routing

When a trigger phrase appears, route to the relevant workflow file by intent:

- "bump", "version" → BumpVersion
- "cut", "tag", "release" → CutRelease
- "trust gate", "phase 0", "release-checklist" → TrustGateCheck
- "deploy", "ship dev", "ship prod" → DeployStaged
- "rollback", "revert deploy" → Rollback
- "announce", "post release" → Announce

If the operator says "release" without specifying a workflow, walk all six in order, pausing for operator confirm at each gate.

## Scripts

Three bun CLIs ship under `../scripts/`. All accept `<repo-path>` as first arg; default is `$MF_TARGET_REPO` or `~/Developer/grove`.

| Script                       | Purpose                                                                     |
|------------------------------|-----------------------------------------------------------------------------|
| `list-releases-since-tag.ts` | Enumerate commits + merged PRs since a tag; emit JSON.                      |
| `prepare-changelog.ts`       | Group PRs by conventional-commit prefix; emit release-note markdown.        |
| `check-gate-table.ts`        | Parse `compass/sops/release-checklist.md` Phase 0 table; run gates per-row. |

See each script's `--help` for the full usage.

## Critical rules

See `docs/agents-md/critical-rules.md` in this repo. Summary:

- Production deploys are **always** a separate workflow run.
- Trust-gate failures are **blocking**, not advisory.
- Day-one scope is **grove only** — no per-repo branching.
- `arc publish --dry-run` runs **first** for any publish workflow (not in scope for this PR; lands in the next iteration).
- Never edit `arc-manifest.yaml` without showing the diff + bump rationale.
- Production rollbacks must record the cause in the events pipeline.
