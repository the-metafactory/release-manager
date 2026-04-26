#!/usr/bin/env bun
/**
 * prepare-changelog.ts
 *
 * Read merged PRs + commits since the previous tag and emit a release-note
 * markdown grouped by conventional-commit prefix.
 *
 * Usage:
 *   bun scripts/prepare-changelog.ts <repo-path> <new-version>
 *
 * Defaults:
 *   <repo-path>    -> $MF_TARGET_REPO or ~/Developer/grove
 *   <new-version>  -> required (e.g. v0.24.5 or 0.24.5)
 *
 * Output:
 *   markdown to stdout, suitable for `gh release create --notes-file`
 *
 * TODO(v0.2): generalize for non-grove repos. The previous-tag lookup
 * currently uses `gh release view --repo the-metafactory/grove`. We'll lift
 * the repo from `gh repo view --json nameWithOwner` once we generalise.
 */

import { spawnSync } from "node:child_process";
import { resolve } from "node:path";
import {
  defaultRepoPath,
  listReleasesSinceTag,
  type CommitEntry,
  type PrEntry,
} from "./list-releases-since-tag.ts";

const PREFIX_GROUPS: Array<{ key: string; label: string; matchers: RegExp[] }> = [
  { key: "feat", label: "Features", matchers: [/^feat(\(.+?\))?!?:/i] },
  { key: "fix", label: "Fixes", matchers: [/^fix(\(.+?\))?!?:/i] },
  { key: "perf", label: "Performance", matchers: [/^perf(\(.+?\))?!?:/i] },
  { key: "refactor", label: "Refactor", matchers: [/^refactor(\(.+?\))?!?:/i] },
  { key: "docs", label: "Docs", matchers: [/^docs(\(.+?\))?!?:/i] },
  { key: "chore", label: "Chores", matchers: [/^chore(\(.+?\))?!?:/i, /^build(\(.+?\))?!?:/i, /^ci(\(.+?\))?!?:/i, /^test(\(.+?\))?!?:/i] },
];

export type Group = { key: string; label: string; entries: GroupEntry[] };
export type GroupEntry = { title: string; prNumber?: number };

export function classifyTitle(title: string): string {
  for (const group of PREFIX_GROUPS) {
    for (const matcher of group.matchers) {
      if (matcher.test(title)) return group.key;
    }
  }
  return "other";
}

/** Group merged PRs (preferred) or commit subjects (fallback) by prefix. */
export function groupChangelog(prs: PrEntry[], commits: CommitEntry[]): Group[] {
  // Index PRs by number for de-duplication when commits also reference them.
  const prByNumber = new Map<number, PrEntry>();
  for (const pr of prs) prByNumber.set(pr.number, pr);

  // Sources of truth: PRs (preferred) + orphan commits (no PR-link in subject).
  const ordered: GroupEntry[] = [];
  const seenPrs = new Set<number>();

  for (const commit of commits) {
    if (commit.prNumber && prByNumber.has(commit.prNumber)) {
      const pr = prByNumber.get(commit.prNumber)!;
      seenPrs.add(pr.number);
      ordered.push({ title: pr.title, prNumber: pr.number });
    } else if (commit.subject.length > 0) {
      const entry: GroupEntry = { title: commit.subject };
      if (commit.prNumber) entry.prNumber = commit.prNumber;
      ordered.push(entry);
    }
  }
  // Add any PRs that didn't match a commit (rare — possible with squash merges
  // amended after the fact, or PRs landed via different paths).
  for (const pr of prs) {
    if (!seenPrs.has(pr.number)) {
      ordered.push({ title: pr.title, prNumber: pr.number });
    }
  }

  // Bucket each entry into its group.
  const groups: Map<string, Group> = new Map();
  for (const def of PREFIX_GROUPS) {
    groups.set(def.key, { key: def.key, label: def.label, entries: [] });
  }
  groups.set("other", { key: "other", label: "Other", entries: [] });

  for (const entry of ordered) {
    const key = classifyTitle(entry.title);
    groups.get(key)!.entries.push(entry);
  }

  // Drop empty groups, preserve canonical order (feat > fix > perf > refactor > docs > chore > other).
  const order = [...PREFIX_GROUPS.map((g) => g.key), "other"];
  return order
    .map((key) => groups.get(key)!)
    .filter((g) => g.entries.length > 0);
}

export function renderMarkdown(
  newVersion: string,
  previousTag: string,
  groups: Group[],
  repoSlug?: string,
): string {
  const lines: string[] = [];
  const versionLabel = newVersion.startsWith("v") ? newVersion : `v${newVersion}`;
  lines.push(`# ${versionLabel}`);
  lines.push("");
  if (previousTag) {
    lines.push(`Changes since \`${previousTag}\`.`);
    lines.push("");
  }
  if (groups.length === 0) {
    lines.push("_No changes._");
    lines.push("");
    return lines.join("\n");
  }
  for (const group of groups) {
    lines.push(`## ${group.label}`);
    lines.push("");
    for (const entry of group.entries) {
      const prRef = entry.prNumber
        ? ` ([#${entry.prNumber}](${prLink(repoSlug, entry.prNumber)}))`
        : "";
      lines.push(`- ${entry.title}${prRef}`);
    }
    lines.push("");
  }
  return lines.join("\n");
}

function prLink(repoSlug: string | undefined, number: number): string {
  const slug = repoSlug ?? "the-metafactory/grove"; // TODO(v0.2): generalize
  return `https://github.com/${slug}/pull/${number}`;
}

/** Resolve the previous tag via `gh release view`. Falls back to git describe. */
export function resolvePreviousTag(repoPath: string): string | undefined {
  // TODO(v0.2): drop hard-coded repo
  const gh = spawnSync(
    "gh",
    [
      "release",
      "view",
      "--repo",
      "the-metafactory/grove",
      "--json",
      "tagName",
      "-q",
      ".tagName",
    ],
    { cwd: repoPath, encoding: "utf8" },
  );
  if (gh.status === 0 && gh.stdout?.trim()) return gh.stdout.trim();

  const describe = spawnSync(
    "git",
    ["describe", "--tags", "--abbrev=0"],
    { cwd: repoPath, encoding: "utf8" },
  );
  if (describe.status === 0 && describe.stdout?.trim()) {
    return describe.stdout.trim();
  }
  return undefined;
}

function main(): number {
  const args = process.argv.slice(2);
  if (args.includes("--help") || args.includes("-h")) {
    process.stdout.write(
      "Usage: bun scripts/prepare-changelog.ts <repo-path> <new-version>\n",
    );
    return 0;
  }
  const repoPath = args[0] && !args[0].startsWith("--")
    ? resolve(args[0])
    : defaultRepoPath();
  const newVersion = args[1];
  if (!newVersion) {
    process.stderr.write("prepare-changelog: missing <new-version> argument\n");
    return 2;
  }
  const previousTag = resolvePreviousTag(repoPath);
  if (!previousTag) {
    process.stderr.write(
      "prepare-changelog: could not resolve previous tag — emitting empty changelog\n",
    );
    process.stdout.write(renderMarkdown(newVersion, "", []) + "\n");
    return 0;
  }
  try {
    const result = listReleasesSinceTag(repoPath, previousTag);
    const groups = groupChangelog(result.prs, result.commits);
    process.stdout.write(renderMarkdown(newVersion, previousTag, groups) + "\n");
    return 0;
  } catch (err) {
    process.stderr.write(`prepare-changelog: ${(err as Error).message}\n`);
    return 1;
  }
}

if (import.meta.main) {
  process.exit(main());
}
