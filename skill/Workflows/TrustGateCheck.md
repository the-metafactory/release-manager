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
   - executes each row's `How To Verify` command via Bash
   - returns JSON `{gates: [{name, status, output}], allPassed: bool}`
3. **On any `status: fail`, halt the entire release.** Surface the failing row name + command output to the operator.

## Verify

- The script's `allPassed` field is `true`.
- All gates show `status: pass` with non-empty output.
- The operator has acknowledged the gate report (paste the JSON into the release thread).

## Anti-pattern

- **Never continue past a fail.** The whole point of the gate is binary halt-or-proceed; downgrading a fail to a warning defeats the protection.
- Never hand-execute the gate commands and self-attest the result. The script is the audit record.
- Never run the gates against a different repo. Today the gates encode grove-specific issue numbers; running them against another repo silently passes irrelevant checks.
- Never edit the gate table to make it pass. Either the gate's intent is satisfied (issue closed, page deployed) or it is not.
