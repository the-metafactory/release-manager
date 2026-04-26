# Workflow: CutRelease

Tag the bump commit, push, and create the GitHub release with generated notes.

> **Day-one scope:** grove only. Repo is hard-coded to `the-metafactory/grove` for the `gh release create` invocation. Generalisation is v0.2.

## Pre-flight

- The bump commit from `BumpVersion` is already on the default branch.
- `git status` clean; `HEAD` is on the default branch and matches `origin/<default>`.
- The new version is read from `arc-manifest.yaml` and matches the bump commit message.

## Action

1. Read `release_title_format` from `compass.config.yaml` if present at the target repo. Fall back to `"Grove vX.Y.Z"` when absent.
2. Resolve the previous tag:
   ```bash
   gh release view --repo the-metafactory/grove --json tagName -q .tagName
   ```
3. Optional: produce a richer changelog with the bundled script (used as `--notes-file` if the operator wants the grouped form rather than `--generate-notes`):
   ```bash
   bun scripts/prepare-changelog.ts <repo-path> v<X.Y.Z> > /tmp/release-notes.md
   ```
4. Cut the GitHub release:
   ```bash
   gh release create v<X.Y.Z> \
     --repo the-metafactory/grove \
     --title "<resolved-title>" \
     --generate-notes \
     --notes-start-tag v<last>
   ```
5. Confirm the release URL.

## Verify

- `gh release view v<X.Y.Z> --repo the-metafactory/grove` returns the release.
- The release tag points at the bump commit SHA (`gh release view ... --json targetCommitish`).
- `git tag -l v<X.Y.Z>` returns the tag locally after `git fetch --tags`.

## Anti-pattern

- **Never create a release before the bump commit is on the default branch.** Tags must point at the bump commit, not at any other commit.
- Never hand-write tag names; always go through `gh release create`.
- Never mix `--generate-notes` with `--notes` (the flags conflict). If overriding, pass `--notes-file` instead.
- Never re-tag an existing version. If the release was wrong, do a patch bump and a new release.
