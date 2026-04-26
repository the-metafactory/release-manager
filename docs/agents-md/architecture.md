## Architecture

ReleaseManager is an arc-installable **skill bundle** — no long-running process, no service. Forge (and any operator with the skill loaded) invokes its workflows in sequence to drive a release end-to-end.

The bundle ships seven workflows and three scripts. Each workflow is an authored Markdown SOP that the agent walks; the scripts are bun-runnable TypeScript helpers the workflows call out to.

### Workflows (`skill/Workflows/`)

| Workflow | Purpose |
|---|---|
| `BumpVersion.md` | Inspect the commit log since the last tag, derive bump kind (patch / minor / major), edit `arc-manifest.yaml`, commit. |
| `CutRelease.md` | Tag the bump commit, push the tag, create the GitHub release with notes from the changelog. |
| `TrustGateCheck.md` | Run the gate table (tests, type-check, lint, secret scan, etc.). Halts the release on the first failing row. |
| `DeployStaged.md` | Deploy to dev first, observe, then prompt the operator before staging production. Production deploys are a separate workflow run. |
| `Rollback.md` | Revert a deploy: re-tag the previous version, redeploy, post the rollback announcement. |
| `Announce.md` | Post the release announcement to the matching Discord entity thread (control plane) with a deep link to the GitHub release (data plane). |
| `ScaffoldInstance.md` | Create per-instance state folders for a fresh install. Calls `AgentState/ScaffoldFolders`. |

### Scripts (`scripts/`)

| Script | Purpose |
|---|---|
| `list-releases-since-tag.ts` | Enumerate merged PRs / commits between the last release tag and HEAD. Feeds `BumpVersion` and `prepare-changelog`. |
| `prepare-changelog.ts` | Build the release-notes body from the PR list, grouped by label (feat / fix / chore / docs). Output is fed to `gh release create`. |
| `check-gate-table.ts` | Execute the trust-gate table (per-repo configurable) and emit a structured pass/fail report. Returns non-zero on any failure so `TrustGateCheck` can halt deterministically. |

### Composition

Forge's day-one role uses the following `allowedSkills`:

```
["ReleaseManager", "AgentState", "PackageBuilder", "BlueprintTracker"]
```

ReleaseManager calls `PackageBuilder` (existing inside `arc`) to actually bundle and publish, and `AgentState` for instance scaffolding. It does not own those concerns.

### Day-one scope

**grove only.** No per-repo branching in any workflow. When a second repo joins, that's a Phase G iteration that introduces a config layer — until then, hardcoding grove keeps the workflows readable and the trust-gate table grounded in one real release pipeline.

### Authority model

The bundle does **not** carry authority. `bot.yaml` (on Forge's host) declares which skills are allowed and which directories / tools the agent can touch. Removing the bundle from `allowedSkills` instantly disables every release workflow without touching this repo.
