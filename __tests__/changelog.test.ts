/**
 * changelog.test.ts
 *
 * Unit tests for prepare-changelog.ts grouping logic, plus an end-to-end
 * dry render with synthetic PR + commit data.
 */

import { describe, expect, it } from "bun:test";
import {
  classifyTitle,
  groupChangelog,
  renderMarkdown,
} from "../scripts/prepare-changelog.ts";
import {
  parseGhPrList,
  parseGitLogOneline,
  shouldAllowGhFailure,
} from "../scripts/list-releases-since-tag.ts";

describe("classifyTitle", () => {
  it("recognises feat: as feat group", () => {
    expect(classifyTitle("feat: add gate parser")).toBe("feat");
  });

  it("recognises feat(scope): as feat group", () => {
    expect(classifyTitle("feat(rm-001): add workflows")).toBe("feat");
  });

  it("recognises fix: as fix group", () => {
    expect(classifyTitle("fix: handle empty tag list")).toBe("fix");
  });

  it("recognises chore: as chore group", () => {
    expect(classifyTitle("chore: bump to v0.2.0")).toBe("chore");
  });

  it("recognises docs: as docs group", () => {
    expect(classifyTitle("docs: explain trust gate")).toBe("docs");
  });

  it("buckets unknown prefixes into other", () => {
    expect(classifyTitle("wip: random thought")).toBe("other");
  });

  it("treats breaking-change marker as still in its base group", () => {
    // Breaking-major detection is BumpVersion's job; classifyTitle just
    // routes to the changelog section. feat!: still belongs in "feat".
    expect(classifyTitle("feat!: rewrite API")).toBe("feat");
  });
});

describe("groupChangelog", () => {
  it("groups merged PRs by prefix and preserves order", () => {
    const prs = parseGhPrList(JSON.stringify([
      { number: 10, title: "feat: add A", mergedAt: "2026-01-01T00:00:00Z", labels: [] },
      { number: 11, title: "fix: B",      mergedAt: "2026-01-02T00:00:00Z", labels: [] },
      { number: 12, title: "feat: C",     mergedAt: "2026-01-03T00:00:00Z", labels: [] },
      { number: 13, title: "chore: bump", mergedAt: "2026-01-04T00:00:00Z", labels: [] },
    ]));
    const commits = parseGitLogOneline([
      "abc1 feat: add A (#10)",
      "abc2 fix: B (#11)",
      "abc3 feat: C (#12)",
      "abc4 chore: bump (#13)",
    ].join("\n"));

    const groups = groupChangelog(prs, commits);
    const keys = groups.map((g) => g.key);
    expect(keys).toEqual(["feat", "fix", "chore"]);
    const feat = groups.find((g) => g.key === "feat");
    expect(feat?.entries.length).toBe(2);
    expect(feat?.entries[0]?.prNumber).toBe(10);
  });

  it("includes orphan commits with no associated PR", () => {
    const prs = parseGhPrList("[]");
    const commits = parseGitLogOneline("deadbee fix: hotfix without PR\n");
    const groups = groupChangelog(prs, commits);
    expect(groups.length).toBe(1);
    expect(groups[0]?.key).toBe("fix");
    expect(groups[0]?.entries[0]?.title).toBe("fix: hotfix without PR");
    expect(groups[0]?.entries[0]?.prNumber).toBeUndefined();
  });

  it("returns empty array when there are no entries", () => {
    expect(groupChangelog([], [])).toEqual([]);
  });

  it("does not duplicate entries when commit references a PR already in the list", () => {
    const prs = parseGhPrList(JSON.stringify([
      { number: 99, title: "feat: only once", mergedAt: "2026-01-01T00:00:00Z", labels: [] },
    ]));
    const commits = parseGitLogOneline("abc1 feat: only once (#99)\n");
    const groups = groupChangelog(prs, commits);
    expect(groups[0]?.entries.length).toBe(1);
  });
});

describe("renderMarkdown", () => {
  it("renders version header + groups + bullets", () => {
    const md = renderMarkdown(
      "v0.24.5",
      "v0.24.4",
      [
        {
          key: "feat",
          label: "Features",
          entries: [{ title: "feat: add gate parser", prNumber: 7 }],
        },
        {
          key: "fix",
          label: "Fixes",
          entries: [{ title: "fix: edge case", prNumber: 8 }],
        },
      ],
    );
    expect(md).toContain("# v0.24.5");
    expect(md).toContain("Changes since `v0.24.4`");
    expect(md).toContain("## Features");
    expect(md).toContain("## Fixes");
    expect(md).toContain("[#7](https://github.com/the-metafactory/grove/pull/7)");
  });

  it("normalises bare version to v-prefixed header", () => {
    const md = renderMarkdown("0.24.5", "v0.24.4", []);
    expect(md).toContain("# v0.24.5");
  });

  it("emits empty-state notice when there are no groups", () => {
    const md = renderMarkdown("v0.24.5", "v0.24.4", []);
    expect(md).toContain("_No changes._");
  });
});

describe("parseGitLogOneline + parseGhPrList", () => {
  it("parseGitLogOneline extracts SHA + subject + PR number", () => {
    const out = parseGitLogOneline(
      "abc1234 feat: add thing (#12)\nabc5678 chore: bump\n",
    );
    expect(out.length).toBe(2);
    expect(out[0]).toEqual({ sha: "abc1234", subject: "feat: add thing (#12)", prNumber: 12 });
    expect(out[1]?.prNumber).toBeUndefined();
  });

  it("parseGitLogOneline handles empty output", () => {
    expect(parseGitLogOneline("")).toEqual([]);
  });

  it("parseGhPrList normalises label objects to strings", () => {
    const out = parseGhPrList(JSON.stringify([
      { number: 1, title: "x", mergedAt: "t", labels: [{ name: "feature" }, { name: "now" }] },
    ]));
    expect(out[0]?.labels).toEqual(["feature", "now"]);
  });

  it("parseGhPrList handles missing labels field", () => {
    const out = parseGhPrList(JSON.stringify([
      { number: 1, title: "x", mergedAt: "t" },
    ]));
    expect(out[0]?.labels).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Echo's review on release-manager#2 — gh failure must propagate by default
// (release-critical tool failing open is the wrong default).
// ---------------------------------------------------------------------------

describe("shouldAllowGhFailure (Echo major #4)", () => {
  it("returns false by default (gh failure propagates)", () => {
    expect(shouldAllowGhFailure({})).toBe(false);
    expect(shouldAllowGhFailure({ MF_ALLOW_GH_FAILURE: "" })).toBe(false);
    expect(shouldAllowGhFailure({ MF_ALLOW_GH_FAILURE: "0" })).toBe(false);
    expect(shouldAllowGhFailure({ MF_ALLOW_GH_FAILURE: "true" })).toBe(false);
  });

  it("returns true only when MF_ALLOW_GH_FAILURE === '1'", () => {
    expect(shouldAllowGhFailure({ MF_ALLOW_GH_FAILURE: "1" })).toBe(true);
  });
});
