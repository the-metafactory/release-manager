#!/usr/bin/env bun
/**
 * scan-release-notes.ts
 *
 * Confidentiality scan of composed release notes (compass#92, design doc §4 L6
 * "Non-git publish surfaces" — Release notes).
 *
 * Reconstructs EXACTLY what `gh release create --generate-notes` would
 * publish — tag, release name, and the PR-title body — by calling the same
 * GitHub REST endpoint the `--generate-notes` flag uses internally
 * (`POST /repos/{owner}/{repo}/releases/generate-notes`, exposed via
 * `gh api`). That call is a dry, non-mutating computation: it returns
 * `{name, body}` without creating a release, so this script can run ahead of
 * `gh release create` with zero side effects.
 *
 * The composed text is piped to the shared confidentiality scan engine's
 * `text` mode (metafactory-actions PR#15, tiers 2+3 — shapes + denylist; no
 * gitleaks, there is no git range here). Findings are masked by the engine;
 * this script never prints a raw match.
 *
 * IMPORTANT — scope: this scans the NOTES only. It does NOT, and cannot,
 * prevent publication of the tag's full source-archive (the tarball/zipball
 * GitHub serves for every tag) — tree cleanliness is owned by the git-side
 * layers (L1 CI gate, L2 structural hygiene, L5 pre-commit/pre-push hooks).
 * The disclaimer below is printed on every run, clean or not.
 *
 * This step is MANDATORY-BUT-ADVISORY (design doc §4 L6 sequencing + compass#92
 * AUTO scope): it is wired into `skill/Workflows/CutRelease.md` as a required
 * step, but it does NOT auto-abort `gh release create`. A non-zero exit is a
 * stop-and-escalate signal for the operator/agent driving the release, not an
 * automated hard gate — flipping it to release-blocking is a parked,
 * principal-only decision.
 *
 * Usage:
 *   bun scripts/scan-release-notes.ts <owner/repo> <tag> [--previous-tag <tag>] [--target-commitish <sha>]
 *
 * Exit codes (propagated from the engine, plus this script's own):
 *   0  clean
 *   1  BLOCK finding(s) in the composed notes
 *   2  usage error (missing/malformed arguments)
 *   3  fail-closed — engine missing, or notes could not be composed (gh/API
 *      failure). Mirrors the engine's own fail-closed contract (L5 hooks).
 */

import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

export interface GeneratedNotes {
  name: string;
  body: string;
}

export interface RunResult {
  status: number | null;
  stdout: string;
  stderr: string;
}

/** Injectable process runner — real spawnSync by default, stubbed in tests. */
export type Runner = (cmd: string, args: string[], input?: string) => RunResult;

export const defaultRunner: Runner = (cmd, args, input) => {
  const result = spawnSync(cmd, args, {
    encoding: "utf8",
    input: input ?? undefined,
  });
  return {
    status: result.status,
    stdout: result.stdout ?? "",
    stderr: result.stderr ?? "",
  };
};

export const SOURCE_ARCHIVE_DISCLAIMER =
  "confidentiality-scan(release-notes): this scan covers the composed RELEASE " +
  "NOTES text only (tag + name + PR-title body — exactly what `--generate-notes` " +
  "would publish). It does NOT prevent publication of the tag's full " +
  "source-archive (tarball/zipball) — tree cleanliness is owned by the git-side " +
  "gates (L1 CI + L2 structural hygiene + L5 hooks), not this script. " +
  "See compass/docs/design-software-factory-confidentiality.md §4 L6.";

/**
 * Resolve the previous tag for a repo via `gh release view` (latest published
 * release). Returns undefined when the repo has no prior release — the
 * generate-notes call still works without `previous_tag_name` (GitHub falls
 * back to its own default range).
 */
export function resolvePreviousTag(
  repoSlug: string,
  run: Runner = defaultRunner,
): string | undefined {
  const result = run("gh", [
    "release",
    "view",
    "--repo",
    repoSlug,
    "--json",
    "tagName",
    "-q",
    ".tagName",
  ]);
  if (result.status === 0 && result.stdout.trim()) return result.stdout.trim();
  return undefined;
}

/**
 * Reconstruct exactly what `gh release create --generate-notes` would
 * publish by calling the same REST endpoint (dry — creates nothing).
 */
export function composeGeneratedNotes(
  repoSlug: string,
  tagName: string,
  opts: { previousTag?: string; targetCommitish?: string } = {},
  run: Runner = defaultRunner,
): GeneratedNotes {
  const args = [
    "api",
    `repos/${repoSlug}/releases/generate-notes`,
    "-f",
    `tag_name=${tagName}`,
  ];
  if (opts.previousTag) args.push("-f", `previous_tag_name=${opts.previousTag}`);
  if (opts.targetCommitish) args.push("-f", `target_commitish=${opts.targetCommitish}`);

  const result = run("gh", args);
  if (result.status !== 0) {
    const stderr = result.stderr.trim();
    throw new Error(
      `gh api releases/generate-notes failed (status=${result.status})` +
        (stderr ? `: ${stderr}` : ""),
    );
  }
  let parsed: { name?: string; body?: string };
  try {
    parsed = JSON.parse(result.stdout) as { name?: string; body?: string };
  } catch (err) {
    throw new Error(
      `failed to parse generate-notes response: ${(err as Error).message}`,
    );
  }
  return { name: parsed.name ?? "", body: parsed.body ?? "" };
}

/** The exact text surface published: tag + name + body. */
export function composeScanText(tagName: string, notes: GeneratedNotes): string {
  return [`Tag: ${tagName}`, `Name: ${notes.name}`, "", notes.body].join("\n");
}

/** Resolve the scan engine path — MF_SCAN_ENGINE override, else the conventional installed-pkg path (mirrors metafactory-actions scan/hooks/pre-commit + pre-push). */
export function resolveEnginePath(env: NodeJS.ProcessEnv = process.env): string {
  const override = env["MF_SCAN_ENGINE"];
  if (override && override.length > 0) return override;
  return join(
    homedir(),
    ".config",
    "metafactory",
    "pkg",
    "repos",
    "metafactory-actions",
    "scan",
    "confidentiality-scan.ts",
  );
}

export interface EngineScanResult {
  exitCode: number;
  output: string;
  engineFound: boolean;
}

/** Shell to the installed scan engine's `text` mode (tiers 2+3), content via stdin. */
export function scanText(
  content: string,
  env: NodeJS.ProcessEnv = process.env,
  run: Runner = defaultRunner,
): EngineScanResult {
  const engine = resolveEnginePath(env);
  if (!existsSync(engine)) {
    return {
      exitCode: 3,
      engineFound: false,
      output:
        `scan-release-notes: engine not found (${engine}). Set MF_SCAN_ENGINE or ` +
        `run \`arc install metafactory-actions\`. FAILING CLOSED.`,
    };
  }
  const result = run("bun", [engine, "text"], content);
  return {
    exitCode: result.status ?? 3,
    engineFound: true,
    output: [result.stdout, result.stderr].filter((s) => s.trim().length > 0).join("\n"),
  };
}

interface CliArgs {
  repoSlug: string;
  tagName: string;
  previousTag?: string;
  targetCommitish?: string;
}

export function parseCliArgs(argv: string[]): CliArgs | { error: string } {
  const positional: string[] = [];
  let previousTag: string | undefined;
  let targetCommitish: string | undefined;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--previous-tag") {
      previousTag = argv[++i];
    } else if (a === "--target-commitish") {
      targetCommitish = argv[++i];
    } else if (a && !a.startsWith("--")) {
      positional.push(a);
    }
  }
  const [repoSlug, tagName] = positional;
  if (!repoSlug || !tagName) {
    return { error: "missing required <owner/repo> and/or <tag> argument" };
  }
  const args: CliArgs = { repoSlug, tagName };
  if (previousTag) args.previousTag = previousTag;
  if (targetCommitish) args.targetCommitish = targetCommitish;
  return args;
}

export async function main(argv: string[] = process.argv.slice(2)): Promise<number> {
  if (argv.includes("--help") || argv.includes("-h")) {
    process.stdout.write(
      "Usage: bun scripts/scan-release-notes.ts <owner/repo> <tag> " +
        "[--previous-tag <tag>] [--target-commitish <sha>]\n",
    );
    return 0;
  }

  // Printed unconditionally — clean, blocked, or fail-closed alike.
  process.stdout.write(SOURCE_ARCHIVE_DISCLAIMER + "\n");

  const parsed = parseCliArgs(argv);
  if ("error" in parsed) {
    process.stderr.write(`scan-release-notes: ${parsed.error}\n`);
    return 2;
  }
  const { repoSlug, tagName } = parsed;
  const previousTag = parsed.previousTag ?? resolvePreviousTag(repoSlug);

  let notes: GeneratedNotes;
  try {
    const opts: { previousTag?: string; targetCommitish?: string } = {};
    if (previousTag) opts.previousTag = previousTag;
    if (parsed.targetCommitish) opts.targetCommitish = parsed.targetCommitish;
    notes = composeGeneratedNotes(repoSlug, tagName, opts);
  } catch (err) {
    process.stderr.write(
      `scan-release-notes: failed to compose release notes: ${(err as Error).message}\n`,
    );
    return 3;
  }

  const text = composeScanText(tagName, notes);
  const result = scanText(text);
  process.stdout.write(result.output + "\n");
  return result.exitCode;
}

if (import.meta.main) {
  process.exit(await main());
}
