# Workflow: BumpVersion

Decide the next semver and edit `arc-manifest.yaml` for the target repo.

> **Day-one scope:** grove only. The agent assumes `~/Developer/grove` (or `$MF_TARGET_REPO`) as the target. Generalising to other repos is a v0.2 follow-up — see `// TODO(v0.2): generalize for non-grove repos` markers in scripts.

## Pre-flight

- Confirm target repo path. Default: `~/Developer/grove`.
- Confirm working tree is clean and on the default branch.
- Read the current `version` from `arc-manifest.yaml` at the target repo.

## Action

1. Resolve the previous release tag:
   ```bash
   gh release view --repo the-metafactory/grove --json tagName -q .tagName
   ```
2. Enumerate commits + merged PRs since that tag using the bundled script:
   ```bash
   bun scripts/list-releases-since-tag.ts <repo-path> v<last>
   ```
3. Decide the bump from the commit-prefix distribution:
   - any `!` breaking marker or `BREAKING CHANGE:` footer → **major**
   - any `feat:` or `feat(scope):` → **minor**
   - else (only `fix:`, `chore:`, `docs:`, etc.) → **patch**
4. Present the proposed bump with rationale (counts of feat/fix/chore/breaking) and **wait for operator confirmation** before editing.
5. On confirm, edit `arc-manifest.yaml` `version:` field. No other changes in the same commit.
6. Commit with `chore: bump to v<X.Y.Z>` on the default branch.

## Verify

- `grep -E "^version:" <repo>/arc-manifest.yaml` returns the new version.
- `git log -1 --pretty=format:%s` matches `chore: bump to v<X.Y.Z>`.
- Working tree clean.

## Anti-pattern

- **Never edit `arc-manifest.yaml` without operator confirm.** The bump rationale must be acknowledged before the file changes.
- Never bundle the bump commit with feature commits.
- Never bump on a feature branch — bump commits go directly to the default branch (per `compass/sops/versioning.md`).
- Never skip the rationale step "because it's obviously a patch" — the prefix scan is the gate, not the agent's intuition.
