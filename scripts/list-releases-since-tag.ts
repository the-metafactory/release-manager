#!/usr/bin/env bun
/**
 * list-releases-since-tag.ts
 *
 * Enumerate commits + merged PRs in a repo since a given tag.
 *
 * Usage:
 *   bun scripts/list-releases-since-tag.ts <repo-path> <tag> [--json]
 *
 * Defaults:
 *   <repo-path> -> $MF_TARGET_REPO or ~/Developer/grove
 *
 * Output:
 *   JSON {
 *     repo: <abs-path>,
 *     since: <tag>,
 *     commits: [{ sha, subject, prNumber? }],
 *     prs:     [{ number, title, mergedAt, labels: string[] }]
 *   }
 *
 * TODO(v0.2): generalize for non-grove repos. Today the GH search uses
 * `gh pr list` against whatever remote `origin` resolves to, which works for
 * any repo with a configured `origin`, but downstream workflows still hard-code
 * `the-metafactory/grove` for `gh release create` etc. Drop those when we
 * generalise the bundle in v0.2.
 */

import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { resolve } from "node:path";

export interface CommitEntry {
  sha: string;
  subject: string;
  prNumber?: number;
}

export interface PrEntry {
  number: number;
  title: string;
  mergedAt: string;
  labels: string[];
}

export interface ListReleasesResult {
  repo: string;
  since: string;
  commits: CommitEntry[];
  prs: PrEntry[];
}

export function defaultRepoPath(): string {
  const env = process.env["MF_TARGET_REPO"];
  if (env && env.length > 0) return env;
  return resolve(homedir(), "Developer", "grove");
}

/** Parse `git log --oneline TAG..HEAD` output into commit entries. */
export function parseGitLogOneline(output: string): CommitEntry[] {
  const lines = output.split("\n").filter((l) => l.trim().length > 0);
  return lines.map((line) => {
    const space = line.indexOf(" ");
    if (space < 0) {
      return { sha: line.trim(), subject: "" };
    }
    const sha = line.slice(0, space);
    const subject = line.slice(space + 1).trim();
    const prMatch = subject.match(/\(#(\d+)\)\s*$/);
    const entry: CommitEntry = { sha, subject };
    if (prMatch && prMatch[1]) entry.prNumber = Number(prMatch[1]);
    return entry;
  });
}

/** Parse `gh pr list --json number,title,mergedAt,labels` JSON output. */
export function parseGhPrList(jsonText: string): PrEntry[] {
  const raw = JSON.parse(jsonText) as Array<{
    number: number;
    title: string;
    mergedAt: string;
    labels?: Array<{ name: string }>;
  }>;
  return raw.map((row) => ({
    number: row.number,
    title: row.title,
    mergedAt: row.mergedAt,
    labels: (row.labels ?? []).map((l) => l.name),
  }));
}

/** Resolve the merge date of a tag — used to scope the gh pr list search. */
export function tagDate(repoPath: string, tag: string): string | undefined {
  const result = spawnSync("git", ["log", "-1", "--format=%cI", tag], {
    cwd: repoPath,
    encoding: "utf8",
  });
  if (result.status !== 0) return undefined;
  const stdout = result.stdout?.trim();
  if (!stdout || stdout.length === 0) return undefined;
  return stdout;
}

export function listReleasesSinceTag(
  repoPath: string,
  tag: string,
): ListReleasesResult {
  if (!existsSync(repoPath)) {
    throw new Error(`repo path does not exist: ${repoPath}`);
  }

  const logResult = spawnSync(
    "git",
    ["log", "--oneline", `${tag}..HEAD`],
    { cwd: repoPath, encoding: "utf8" },
  );
  if (logResult.status !== 0) {
    const stderr = logResult.stderr?.trim() ?? "";
    throw new Error(`git log failed: ${stderr || "unknown error"}`);
  }
  const commits = parseGitLogOneline(logResult.stdout ?? "");

  const since = tagDate(repoPath, tag);
  let prs: PrEntry[] = [];
  if (since) {
    const search = `merged:>${since}`;
    const ghResult = spawnSync(
      "gh",
      [
        "pr",
        "list",
        "--state",
        "merged",
        "--search",
        search,
        "--limit",
        "200",
        "--json",
        "number,title,mergedAt,labels",
      ],
      { cwd: repoPath, encoding: "utf8" },
    );
    if (ghResult.status === 0 && ghResult.stdout) {
      try {
        prs = parseGhPrList(ghResult.stdout);
      } catch (err) {
        process.stderr.write(
          `list-releases-since-tag: failed to parse gh output (${(err as Error).message})\n`,
        );
      }
    } else if (ghResult.status !== 0) {
      // Don't hard-fail — gh may not be configured in test environments.
      process.stderr.write(
        `list-releases-since-tag: gh pr list failed (status=${ghResult.status}); continuing with empty PR list\n`,
      );
    }
  }

  return { repo: repoPath, since: tag, commits, prs };
}

function main(): number {
  const args = process.argv.slice(2);
  if (args.includes("--help") || args.includes("-h")) {
    process.stdout.write(
      "Usage: bun scripts/list-releases-since-tag.ts <repo-path> <tag>\n",
    );
    return 0;
  }
  const repoPath = args[0] && !args[0].startsWith("--")
    ? resolve(args[0])
    : defaultRepoPath();
  const tag = args[1];
  if (!tag) {
    process.stderr.write(
      "list-releases-since-tag: missing <tag> argument\n",
    );
    return 2;
  }
  try {
    const result = listReleasesSinceTag(repoPath, tag);
    process.stdout.write(JSON.stringify(result, null, 2) + "\n");
    return 0;
  } catch (err) {
    process.stderr.write(`list-releases-since-tag: ${(err as Error).message}\n`);
    return 1;
  }
}

if (import.meta.main) {
  process.exit(main());
}
