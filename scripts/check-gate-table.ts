#!/usr/bin/env bun
/**
 * check-gate-table.ts
 *
 * Parse the trust-gate table in `compass/sops/release-checklist.md` (Phase 0)
 * and run each gate row's "How To Verify" command via Bash. Emit a structured
 * JSON report.
 *
 * TRUST BOUNDARY (per Echo's review on release-manager#2):
 *   The verify cells in `release-checklist.md` are operator-editable markdown.
 *   Today compass is internal but the file is still treated as untrusted code
 *   here — anyone who can open a PR against compass would otherwise be able
 *   to run arbitrary shell on the release operator's machine. We mitigate via:
 *     1. Allowlist regex in VERIFY_COMMAND_ALLOWLIST — verify cells whose
 *        command does NOT match are recorded as `fail` with a clear reason
 *        rather than executed.
 *     2. 30-second timeout on each spawnSync.
 *     3. Empty-rows / unparseable-table = fail-closed (NOT fail-open).
 *   See skill/Workflows/TrustGateCheck.md for the documented contract.
 *
 * Usage:
 *   bun scripts/check-gate-table.ts [--milestone <S2-22|S2-30|S2-32|external-onramp>] [--dry-run] [--checklist <path>]
 *
 * Flags:
 *   --milestone   Selects which gate to run. Mapping:
 *                   S2-22         -> Gate 1 ("Every Package Verified")
 *                   S2-32         -> Gate 2 ("Every Publisher Known")
 *                   S2-30         -> Gate 3 ("Trust Story First")
 *                   external-onramp -> Gate 4 ("Dogfood the Pipeline")
 *                 Omit to walk all four (rare; usually one applies per release).
 *   --dry-run     Parse the table and emit the rows without executing the verify commands.
 *   --checklist   Override path to release-checklist.md (default: ~/Developer/compass/sops/release-checklist.md).
 *
 * Output:
 *   JSON {
 *     gates: [{ id, gateNumber, gateLabel, milestone, name, verify, status, output? }],
 *     allPassed: bool,
 *     reason?: string,           // populated when allPassed=false (or empty rows)
 *     manualGatesPending: number // count of skipped non-dry-run rows requiring human follow-up
 *   }
 *
 * TODO(v0.2): generalize for non-grove repos. Several rows hard-code grove
 * issue numbers in their verify commands; that's a property of the SOP, not
 * this script. When v0.2 ships per-repo gate tables, this script will read
 * the appropriate one.
 */

import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { resolve } from "node:path";

export type MilestoneKey = "S2-22" | "S2-32" | "S2-30" | "external-onramp";

export const MILESTONE_TO_GATE: Record<MilestoneKey, number> = {
  "S2-22": 1,
  "S2-32": 2,
  "S2-30": 3,
  "external-onramp": 4,
};

export const GATE_LABELS: Record<number, string> = {
  1: "Every Package Verified",
  2: "Every Publisher Known",
  3: "Trust Story First",
  4: "Dogfood the Pipeline",
};

export const GATE_TO_MILESTONE: Record<number, MilestoneKey> = {
  1: "S2-22",
  2: "S2-32",
  3: "S2-30",
  4: "external-onramp",
};

export interface GateRow {
  id: string;            // e.g. "G1-1"
  gateNumber: number;    // 1..4
  gateLabel: string;
  milestone: MilestoneKey;
  name: string;          // the "Check" cell
  verify: string;        // the "How To Verify" cell, raw markdown
}

export interface GateResult extends GateRow {
  status: "pass" | "fail" | "skipped";
  output?: string;
}

export interface CheckGateReport {
  gates: GateResult[];
  allPassed: boolean;
  /** When allPassed=false, a short human-readable reason. Omitted when allPassed=true. */
  reason?: string;
  /** Count of skipped rows (non-dry-run) that represent manual gates still requiring human follow-up. */
  manualGatesPending: number;
}

/**
 * Allowlist of command prefixes permitted in verify cells (per Echo's review on
 * release-manager#2). Verify cells whose unwrapped command does not match this
 * regex are recorded as `fail` with reason "verify command not in allowlist —
 * manual review required" rather than being executed.
 *
 * Add new prefixes here only after the new command shape is reviewed in the
 * `release-checklist.md` PR — never widen the allowlist to make a single cell
 * pass.
 */
export const VERIFY_COMMAND_ALLOWLIST =
  /^(gh\s|git\s|bun\s|bunx\s|test\s|\[\s|!\s|find\s|grep\s|cat\s|wc\s|stat\s|ls\s|echo\s|curl\s|true|false)/;

export function isVerifyCommandAllowed(command: string): boolean {
  return VERIFY_COMMAND_ALLOWLIST.test(command.trim());
}

export function defaultChecklistPath(): string {
  return resolve(homedir(), "Developer", "compass", "sops", "release-checklist.md");
}

/** Strip a single backtick wrapper if both ends are backticks. */
function unwrapBacktickCommand(verify: string): string {
  const trimmed = verify.trim();
  if (trimmed.startsWith("`") && trimmed.endsWith("`") && trimmed.length >= 2) {
    return trimmed.slice(1, -1).replace(/\\\|/g, "|").trim();
  }
  return trimmed;
}

/** Detect whether the verify cell is an executable command (starts with `). */
export function isExecutable(verify: string): boolean {
  return verify.trim().startsWith("`");
}

/** Parse the Phase 0 gate tables out of the release-checklist markdown. */
export function parseGateTable(markdown: string): GateRow[] {
  const lines = markdown.split("\n");
  const rows: GateRow[] = [];

  let currentGate: number | undefined;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i] ?? "";
    const gateHeader = line.match(/^###\s+Gate\s+(\d+):/i);
    if (gateHeader && gateHeader[1]) {
      currentGate = Number(gateHeader[1]);
      continue;
    }
    // Phase 0 ends at the next H2 header — but only after we've seen at least
    // one gate row, so leading H2s before Phase 0 (e.g. "## Overview") don't
    // terminate the scan early. Per Echo's review on release-manager#2:
    // structurally the contract is "Phase 0 ends at the next H2", not "ends
    // at Phase 1 specifically" — the latter silently swallows reorgs.
    if (rows.length > 0 && /^##\s/.test(line) && !/^###/.test(line)) break;

    if (!currentGate) continue;

    // Match a row: | G1-1 | Check text | Verify text |
    const rowMatch = line.match(/^\|\s*(G\d+-\d+)\s*\|\s*(.+?)\s*\|\s*(.+?)\s*\|\s*$/);
    if (!rowMatch) continue;
    const [, id, name, verify] = rowMatch;
    if (!id || !name || !verify) continue;

    const milestone = GATE_TO_MILESTONE[currentGate];
    if (!milestone) continue;

    rows.push({
      id,
      gateNumber: currentGate,
      gateLabel: GATE_LABELS[currentGate] ?? `Gate ${currentGate}`,
      milestone,
      name,
      verify,
    });
  }
  return rows;
}

export interface RunGateOptions {
  dryRun?: boolean;
  timeoutMs?: number;
}

export function runGateRow(row: GateRow, opts: RunGateOptions = {}): GateResult {
  if (opts.dryRun) {
    return { ...row, status: "skipped", output: "dry-run: not executed" };
  }
  if (!isExecutable(row.verify)) {
    return {
      ...row,
      status: "skipped",
      output: "verify cell is not an executable command (manual gate)",
    };
  }
  const command = unwrapBacktickCommand(row.verify);
  // Per Echo's review on release-manager#2 — verify cells originate in compass
  // markdown which is internal but operator-editable; we treat them as
  // untrusted. Any command not matching VERIFY_COMMAND_ALLOWLIST is rejected
  // here rather than being passed to bash -c.
  if (!isVerifyCommandAllowed(command)) {
    return {
      ...row,
      status: "fail",
      output:
        "verify command not in allowlist — manual review required " +
        "(see VERIFY_COMMAND_ALLOWLIST in scripts/check-gate-table.ts)",
    };
  }
  const result = spawnSync("bash", ["-c", command], {
    encoding: "utf8",
    timeout: opts.timeoutMs ?? 30_000,
  });
  const stdout = (result.stdout ?? "").trim();
  const stderr = (result.stderr ?? "").trim();
  const combined = [stdout, stderr].filter((s) => s.length > 0).join("\n---\n");
  if (result.status === 0) {
    return { ...row, status: "pass", output: combined };
  }
  return { ...row, status: "fail", output: combined };
}

export interface RunChecklistOptions extends RunGateOptions {
  milestone?: MilestoneKey;
}

export function runChecklist(
  rows: GateRow[],
  opts: RunChecklistOptions = {},
): CheckGateReport {
  const filtered = opts.milestone
    ? rows.filter((r) => r.milestone === opts.milestone)
    : rows;

  // FAIL-CLOSED on empty rows. Per Echo's review on release-manager#2: the
  // single most important rule of the trust gate is "halt on first fail" —
  // and an unparseable / missing / restructured table must be the loudest
  // possible failure, never a silent green light. The OLD code returned
  // allPassed=true here because `[].every(...)` returns true; that was the
  // blocker.
  if (filtered.length === 0) {
    const milestoneSuffix = opts.milestone ? ` for milestone ${opts.milestone}` : "";
    return {
      gates: [],
      allPassed: false,
      reason:
        "no gates parsed — milestone table missing or table format unrecognized" +
        milestoneSuffix,
      manualGatesPending: 0,
    };
  }

  const results = filtered.map((row) => runGateRow(row, opts));

  // Distinguish three states (per Echo's review on release-manager#2):
  //   - allPassed=true requires ≥1 executed pass AND zero fails.
  //   - skipped rows do NOT count toward green; they surface as
  //     manualGatesPending so the workflow consumer knows a human gate is
  //     still owed.
  //   - In dry-run mode every row is "skipped" by design, so don't classify
  //     dry-run skips as pending manual work.
  const passes = results.filter((r) => r.status === "pass").length;
  const fails = results.filter((r) => r.status === "fail").length;
  const skipped = results.filter((r) => r.status === "skipped").length;
  const manualGatesPending = opts.dryRun ? 0 : skipped;

  if (opts.dryRun) {
    // Dry-run is informational; don't flip allPassed off just because nothing
    // ran. Operator knows --dry-run means "parse and inspect", not "verify".
    return {
      gates: results,
      allPassed: true,
      manualGatesPending,
    };
  }

  if (fails > 0) {
    return {
      gates: results,
      allPassed: false,
      reason: `${fails} gate row(s) failed — see gates[].status='fail'`,
      manualGatesPending,
    };
  }

  if (passes === 0) {
    return {
      gates: results,
      allPassed: false,
      reason:
        `no executed passes — ${skipped} skipped (manual) row(s) require ` +
        `human follow-up before allPassed can be true`,
      manualGatesPending,
    };
  }

  return {
    gates: results,
    allPassed: true,
    manualGatesPending,
  };
}

interface ParsedArgs {
  milestone?: MilestoneKey;
  dryRun: boolean;
  checklist: string;
  help: boolean;
}

export function parseCliArgs(argv: string[]): ParsedArgs {
  const out: ParsedArgs = {
    dryRun: false,
    checklist: defaultChecklistPath(),
    help: false,
  };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--help" || arg === "-h") out.help = true;
    else if (arg === "--dry-run") out.dryRun = true;
    else if (arg === "--milestone") {
      const v = argv[++i];
      if (v && v in MILESTONE_TO_GATE) out.milestone = v as MilestoneKey;
      else throw new Error(`unknown milestone: ${v}`);
    } else if (arg === "--checklist") {
      const v = argv[++i];
      if (!v) throw new Error("--checklist requires a path argument");
      out.checklist = resolve(v);
    }
  }
  return out;
}

function helpText(): string {
  return [
    "Usage: bun scripts/check-gate-table.ts [--milestone <id>] [--dry-run] [--checklist <path>]",
    "",
    "Milestones:",
    "  S2-22            Gate 1 (Every Package Verified)",
    "  S2-32            Gate 2 (Every Publisher Known)",
    "  S2-30            Gate 3 (Trust Story First)",
    "  external-onramp  Gate 4 (Dogfood the Pipeline)",
  ].join("\n");
}

function main(): number {
  let args: ParsedArgs;
  try {
    args = parseCliArgs(process.argv.slice(2));
  } catch (err) {
    process.stderr.write(`check-gate-table: ${(err as Error).message}\n`);
    return 2;
  }
  if (args.help) {
    process.stdout.write(helpText() + "\n");
    return 0;
  }
  if (!existsSync(args.checklist)) {
    process.stderr.write(`check-gate-table: checklist not found: ${args.checklist}\n`);
    return 1;
  }
  const markdown = readFileSync(args.checklist, "utf8");
  const rows = parseGateTable(markdown);
  if (rows.length === 0) {
    process.stderr.write("check-gate-table: parsed 0 rows from gate table\n");
  }
  const report = runChecklist(rows, {
    dryRun: args.dryRun,
    milestone: args.milestone,
  });
  process.stdout.write(JSON.stringify(report, null, 2) + "\n");
  if (!report.allPassed && report.reason) {
    process.stderr.write(`check-gate-table: ${report.reason}\n`);
  }
  return report.allPassed ? 0 : 1;
}

if (import.meta.main) {
  process.exit(main());
}
