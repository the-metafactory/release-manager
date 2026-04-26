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
  parseCliArgs,
  parseGateTable,
  runChecklist,
  runGateRow,
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
