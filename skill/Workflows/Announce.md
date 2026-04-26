# Workflow: Announce

Post the structured release note to Discord and the tracking issue. Always the **last** step in the release sequence.

> **Day-one scope:** grove only. The Discord channel and the tracking-issue repo are hard-coded to `releases` and `the-metafactory/grove` respectively. Generalisation is v0.2.

## Pre-flight

- `DeployStaged --env production` has emitted a `system.deploy.production` event for this version.
- The release URL from `CutRelease` is on hand.
- The grouped changelog (from `prepare-changelog.ts`) is available, or the auto-generated GitHub release notes will be re-used.

## Action

1. Compose the announcement. Required structure:
   - **Lead bold:** `**Grove v<X.Y.Z> — <description>**`
   - **Paragraph summary:** 1–3 sentences, what changed at the user-visible level.
   - **Bullet list:** features / fixes / chores grouped by prefix (use `prepare-changelog.ts` output or the GitHub auto-generated notes, trimmed).
   - **Links footer:** GitHub release URL, dashboard URL if relevant, tracking issue URL.
2. Post to Discord:
   ```bash
   discord post --channel releases "<composed message>"
   ```
3. Comment on the tracking issue with the release URL:
   ```bash
   gh issue comment <tracking-issue> --repo the-metafactory/grove \
     --body "Released v<X.Y.Z> — <release-url>"
   ```
4. (Optional) Comment on the matching `grove/<entity>` Discord thread per the control-vs-data plane rule (control plane = Discord one-liner, data plane = GitHub).

## Verify

- The Discord message appears in `#releases` with all four sections populated.
- The tracking issue has a new comment linking the release URL.
- The release URL itself resolves and shows the correct tag.

## Anti-pattern

- **Never announce before the prod deploy completes.** The announce step assumes the bits are live; if it lands first, users follow links to a release whose backend hasn't shipped.
- Never announce without the structured form (lead / summary / bullets / links). A flat one-line "v0.X.Y shipped" is not the contract — the readers (operators, agents, users) rely on the structure for skim + drill-down.
- Never duplicate the announcement across multiple Discord channels. One canonical channel (`releases`) plus one entity-thread one-liner is the entire communication surface for a release.
- Never include unredacted secrets, internal-only URLs, or pre-release artefacts in the public announce.
