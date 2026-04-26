# Workflow: TrustGateCheck

Walk the trust-gate table for the current milestone (`compass/sops/release-checklist.md` Phase 0). Halt on first failure.

> **Day-one scope:** grove only. The script reads the live `compass/sops/release-checklist.md` and runs each gate's `How To Verify` command against grove. Generalisation is v0.2.

## Pre-flight

- Determine which milestone the release maps to. Today the recognised values are `S2-22`, `S2-30`, `S2-32`, and `external-onramp` (Gates 1, 3, 2, 4 respectively).
- If no gate applies (release is mid-milestone, no external promise attached), skip this workflow and move on.

## Action

1. Run the bundled gate-checker:
   ```bash
   bun scripts/check-gate-table.ts --milestone <S2-22|S2-30|S2-32|external-onramp>
   ```
2. The script:
   - parses the gate table from `compass/sops/release-checklist.md`
   - selects the rows for the named milestone
   - executes each row's `How To Verify` command via Bash, **only if the
     command matches the verify-command allowlist** (see Trust boundary
     below) — non-matching commands are recorded as `fail`
   - returns JSON `{gates: [{name, status, output}], allPassed: bool, reason?: string, manualGatesPending: number}`
3. **On any `status: fail`, halt the entire release.** Surface the failing row name + command output to the operator.
4. **On `allPassed: false` with empty `gates`**, the table did not parse — halt and surface `reason` to the operator. Empty rows = fail-closed, never a green light.
5. **On `manualGatesPending > 0`**, the operator must explicitly acknowledge each manual (skipped) gate before treating the milestone as cleared. `allPassed: true` requires at least one executed pass; all-manual milestones do NOT pass automatically.

### Trust boundary

The verify cells originate in `compass/sops/release-checklist.md`, which is internal but operator-editable markdown. The script treats those cells as **untrusted code** and refuses to execute commands that don't match `VERIFY_COMMAND_ALLOWLIST` in `scripts/check-gate-table.ts`. The current allowlist permits only: `gh`, `git`, `bun`, `bunx`, `test`, `[`, `!`, `find`, `grep`, `cat`, `wc`, `stat`, `ls`, `echo`, `curl`, `true`, `false`. Adding new prefixes to the allowlist requires a code-review PR — never widen it to make a single failing cell pass.

## Verify

- The script's `allPassed` field is `true`.
- All gates show `status: pass` with non-empty output.
- `manualGatesPending` is `0` (or every pending manual gate has been explicitly acknowledged in the release thread).
- The operator has acknowledged the gate report (paste the JSON into the release thread).

## Anti-pattern

- **Never continue past a fail.** The whole point of the gate is binary halt-or-proceed; downgrading a fail to a warning defeats the protection.
- **Never treat `allPassed: false` with empty `gates` as "no gates apply".** Empty rows = the table failed to parse. That is the loudest possible halt signal, not a permissive one.
- **Never silently ignore `manualGatesPending`.** Manual gates require human acknowledgement; skipping them is the same as skipping a fail.
- Never hand-execute the gate commands and self-attest the result. The script is the audit record.
- Never run the gates against a different repo. Today the gates encode grove-specific issue numbers; running them against another repo silently passes irrelevant checks.
- Never edit the gate table to make it pass. Either the gate's intent is satisfied (issue closed, page deployed) or it is not.
- **Never widen `VERIFY_COMMAND_ALLOWLIST` to bypass a failing cell.** If a verify cell can't be expressed within the allowlist, the cell is wrong (or the work it claims to verify is too dynamic to be automated and should be a manual gate).
