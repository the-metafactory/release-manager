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
4. **MANDATORY — confidentiality-scan the composed release notes** (compass#92,
   design doc §4 L6 "Release notes") before publishing. This reconstructs
   exactly what `--generate-notes` will publish (tag + name + PR-title body)
   and scans it with the shared confidentiality engine (tiers 2+3 — shapes +
   denylist):
   ```bash
   bun scripts/scan-release-notes.ts the-metafactory/grove v<X.Y.Z> --previous-tag v<last>
   ```
   - **Exit 0** — clean. Proceed to step 5.
   - **Exit 1** — BLOCK finding(s) in the composed notes. **Do not proceed.**
     Fix the offending PR title(s) (or escalate per
     `compass/metafactory/sops/data-leak-response.md` if the release already
     shipped) before cutting the release.
   - **Exit 3** — fail-closed: the scan engine isn't installed, or the notes
     couldn't be composed (`gh api` failure). Resolve (`arc install
     metafactory-actions`) before proceeding — do not treat a fail-closed
     result as clean.

   **Disclaimer (also printed by the script on every run):** this scan covers
   the composed **release-notes text only**. It does **not** prevent
   publication of the tag's full **source-archive** (the tarball/zipball
   GitHub serves for every tag) — tree cleanliness is owned by the git-side
   layers (L1 CI gate, L2 structural hygiene, L5 pre-commit/pre-push hooks),
   not this step.

   **This step is mandatory-but-advisory**, not release-blocking: it is not
   wired to auto-abort `gh release create` in step 5. A BLOCK/fail-closed
   result is a stop-and-escalate signal for the operator/agent driving the
   release. Flipping this to a hard, auto-aborting gate is a parked,
   principal-only decision (design doc §4 L6 sequencing).
5. Cut the GitHub release:
   ```bash
   gh release create v<X.Y.Z> \
     --repo the-metafactory/grove \
     --title "<resolved-title>" \
     --generate-notes \
     --notes-start-tag v<last>
   ```
6. Confirm the release URL.

## Verify

- `gh release view v<X.Y.Z> --repo the-metafactory/grove` returns the release.
- The release tag points at the bump commit SHA (`gh release view ... --json targetCommitish`).
- `git tag -l v<X.Y.Z>` returns the tag locally after `git fetch --tags`.

## Anti-pattern

- **Never create a release before the bump commit is on the default branch.** Tags must point at the bump commit, not at any other commit.
- Never hand-write tag names; always go through `gh release create`.
- Never mix `--generate-notes` with `--notes` (the flags conflict). If overriding, pass `--notes-file` instead.
- Never re-tag an existing version. If the release was wrong, do a patch bump and a new release.
- Never skip step 4 (confidentiality scan) or treat its exit-3 fail-closed result as a pass — it means the scan didn't run, not that the notes are clean.
