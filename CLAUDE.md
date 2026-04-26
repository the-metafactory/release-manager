<!-- Generated from metafactory ecosystem template. Customize sections marked with {PLACEHOLDER}. -->

# release-manager -- Release SOP walker — bump → tag → bundle → publish → deploy → announce. The skill bundle Forge composes for end-to-end releases.

Release SOP walker — bump → tag → bundle → publish → deploy → announce. The skill bundle Forge composes for end-to-end releases.

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


## Naming

- **metafactory** -- always lowercase, one word. Not "Metafactory", not "Meta Factory". The GitHub org is `the-metafactory`, the repo name may be hyphenated (technical constraint), and the domains are `meta-factory.ai/.dev/.io` (DNS constraint). But the brand name is always `metafactory`.

## Critical Rules

- NEVER describe code you haven't read. Use Read/Glob/Grep to verify before making claims.
- NEVER fabricate file names, class names, or architecture. If unsure, read the source.
- Fix ALL errors found during type checks, tests, or linting -- even if pre-existing or introduced by another developer. Never dismiss errors as "not from our changes." If you see it, fix it.
- Before fixing a bug or implementing a feature, ALWAYS check open PRs (`gh pr list`) and issues (`gh issue list`) first. Someone may already be working on it, or there may be a PR ready to merge that addresses it. Don't duplicate work -- review what exists before racing to write code.
- Before merging a PR, verify the branch is up to date with the base branch. If other PRs have merged since the branch was created, rebase or merge base into the branch first. Squash merges on stale branches silently overwrite changes that landed in the interim -- this has caused data loss (PR #120 overwrote real page implementations with stubs).

- **Production deploys are ALWAYS a separate workflow run.** Never inline a prod deploy step inside `CutRelease`, `BumpVersion`, or any other workflow. Per forge#1 §"Two-phase gates for irreversible operations" — the operator must consciously initiate `DeployStaged` for production, after dev has been observed.
- **Trust-gate failures are blocking, not advisory.** `TrustGateCheck` halts the release on the first failing row. Do not add a `--force` flag to any workflow. If a gate is wrong, fix the gate (or remove it from the table with rationale) — never skip it.
- **Day-one scope is grove only.** Do NOT add per-repo `if repo == ...` branches to workflows in Phase 3. Generalising to other repos is a Phase G iteration that introduces a config layer.
- **`arc publish --dry-run` runs FIRST.** Real publish only after the operator confirms in-thread. The dry-run output (sha256 + scope of files that would land) must be surfaced to the operator before any commit-modifying or registry-writing step.
- **Never edit `arc-manifest.yaml` of the target repo without first showing the diff and the bump rationale.** Patch / minor / major must be derived from the commit log since the last tag (via `list-releases-since-tag.ts`) and shown to the operator before the bump commit.


## GitHub Labels (ecosystem standard)

All metafactory ecosystem repos use a shared label set. Do not create ad-hoc labels.

| Label | Description | Color | Purpose |
|-------|-------------|-------|---------|
| `bug` | Something isn't working | `#d73a4a` | Defect tracking |
| `documentation` | Improvements or additions to documentation | `#0075ca` | Docs work |
| `feature` | Feature specification | `#1D76DB` | Feature work |
| `infrastructure` | Cross-cutting infrastructure work | `#5319E7` | Infra/tooling |
| `now` | Currently being worked | `#0E8A16` | Priority: active |
| `next` | Next up after current work | `#FBCA04` | Priority: queued |
| `future` | Planned but not yet scheduled | `#C5DEF5` | Priority: backlog |
| `handover` | NZ/EU timezone bridge -- work session summary | `#F9D0C4` | Async handoffs |



Every issue must have at least one type label (`bug`, `feature`, `infrastructure`, `documentation`) and one priority label (`now`, `next`, `future`) if open.

## GitHub Issue Tracking
When working on a GitHub issue in this repo, keep the issue updated as you work. This is default agent behavior, not optional.

**On starting work:**
- Comment on the issue: what you're working on.
- Example: `gh issue comment 1 --body "Starting: implement initial project structure"`

**During work:**
- Link every PR to its issue with `Closes #N` in the PR body (or `gh pr create` with an issue reference).
- If the issue body has a flat checkbox list, tick items as you complete them.

**On completing work:**
- Comment with a summary: what was done, what changed, any follow-up needed.
- Merging the PR auto-closes the issue via `Closes #N`. For iteration umbrellas, the sub-issue rollup updates automatically.
- If the issue is not PR-closable (e.g. a tracking or umbrella issue), close it manually once every child is done.

### Iteration umbrellas (sub-issues, not flat checkboxes)

Iterations with more than ~3 slices use GitHub's native **sub-issues**:

```
Iteration umbrella issue (parent)
  ├── sub-issue: slice A feature issue → closed by its PR
  ├── sub-issue: slice B feature issue → closed by its PR
  └── sub-issue: slice C feature issue → closed by its PR
```

- The umbrella links the `iterations/iteration-{n}.md` file in its body. Slice issues are added as sub-issues, not as markdown bullets.
- Each slice is a real issue (assignable, commentable, PR-linkable). Its PR closes it.
- The parent aggregates progress automatically — no manual ticking of nested checkboxes.
- Update both the repo iteration file and the umbrella when slices are added, split, or reprioritised.

**Tooling:** `gh extension install yahsan2/gh-sub-issue` gives `gh sub-issue add <parent> <child>`. Otherwise use the "Sub-issues" section on any issue page or the REST API (`POST /repos/{owner}/{repo}/issues/{n}/sub_issues`).

**Why:** GitHub is the shared collaboration surface. Team members and agents all read it. If you do work but don't update the issue, it looks like nothing happened.

## Standard Operating Procedures

This repo follows ecosystem SOPs defined in [compass](https://github.com/the-metafactory/compass). **Before starting work, identify which SOPs apply and Read them. Output the pre-flight line from each loaded SOP.**

| SOP | Activate when | File |
|-----|--------------|------|
| **Dev pipeline** | Creating branches, making PRs, starting any feature/fix work | `compass/sops/dev-pipeline.md` |
| **Versioning** | After merging PRs, before deploying, any version bump | `compass/sops/versioning.md` |
| **Deployment** | Deploying to dev or production after a release | `compass/sops/deployment.md` |
| **Worktree discipline** | Starting feature work (always — even solo) | `compass/sops/worktree-discipline.md` |
| **Design process** | Creating specs, design docs, or research docs | `compass/sops/design-process.md` |
| **Retrospective** | Post-work review, extracting process patterns | `compass/sops/retrospective-and-process-mining.md` |
| **New repo** | Bootstrapping a new repository in the ecosystem | `compass/metafactory/sops/new-repo.md` |
| **PR review** | Reviewing a PR, before approving or merging | `compass/sops/pr-review.md` |
| **Security incident response** | Detecting, containing, or investigating a security finding | `compass/metafactory/sops/security-incident-response.md` |

### Examples

**Starting a feature:**
```
Task: "Add a dashboard panel"
→ Activate: dev-pipeline + worktree
→ Read both SOPs
→ Output: "SOP: dev-pipeline | Branch: feat/g-300-panel | Prefix: feat:"
→ Output: "SOP: worktree | Worktree: ../release-manager-panel | Branch: feat/g-300-panel | Main: untouched"
```

**After merging a PR:**
```
Task: "Merge PR #42"
→ After merge, activate: versioning
→ Read SOP
→ Output: "SOP: versioning | Current: v0.2.0 | Bump: patch → v0.2.1"
```


## Blueprint-Driven Development

All ecosystem repos track features in `blueprint.yaml`. Before starting feature work, check the dependency graph:

```bash
# What's ready to work on? (dependencies satisfied)
blueprint ready

# Claim a feature
blueprint update release-manager:{ID} --status in-progress

# After PR merges
blueprint update release-manager:{ID} --status done
blueprint lint   # Validate graph integrity
```

**Statuses:** Only `planned`, `in-progress`, and `done` are settable. `ready`, `blocked`, and `next` are computed from the dependency graph.

**Cross-repo dependencies:** Use `{repo}:{ID}` format (e.g., `grove:G-200`, `arc:A-100`). A feature is `blocked` if any dependency in another repo isn't `done`.

## Versioning & Releases

See `compass/sops/versioning.md` for the full procedure. Key repo-specific details:

- Version source of truth: `arc-manifest.yaml`
- Release title format: `"release-manager vX.Y.Z -- Short Description"`
- Deploy command: `arc upgrade release-manager`


## Multi-Agent Worktree Discipline

See `compass/sops/worktree-discipline.md` for the full procedure. Key repo-specific details:

- Worktree directory pattern: `../release-manager-{slug}`
- Example: `git worktree add ../release-manager-feature -b feat/{branch-name} main`

## Bun

Default to using Bun instead of Node.js.

- Use `bun <file>` instead of `node <file>` or `ts-node <file>`
- Use `bun test` instead of `jest` or `vitest`
- Use `bun build` instead of `webpack` or `esbuild`
- Use `bun install` instead of `npm install` or `yarn install` or `pnpm install`
- Use `bun run <script>` instead of `npm run <script>`
- Use `bunx <package> <command>` instead of `npx <package> <command>`
- Bun automatically loads .env, so don't use dotenv.
