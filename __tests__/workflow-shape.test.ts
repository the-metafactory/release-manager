/**
 * workflow-shape.test.ts
 *
 * Structural test: every Workflow MD must contain Action / Verify /
 * Anti-pattern sections. Drift from this convention is the intended failure
 * mode — agents reading the bundle expect the triplet.
 */

import { describe, expect, it } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

const WORKFLOWS_DIR = resolve(import.meta.dir, "..", "skill", "Workflows");

const EXPECTED_WORKFLOWS = [
  "BumpVersion.md",
  "CutRelease.md",
  "TrustGateCheck.md",
  "DeployStaged.md",
  "Rollback.md",
  "Announce.md",
];

describe("workflow shape", () => {
  it("ships exactly the six MVP workflows (no more, no less)", () => {
    const files = readdirSync(WORKFLOWS_DIR).filter((f) => f.endsWith(".md")).sort();
    expect(files).toEqual([...EXPECTED_WORKFLOWS].sort());
  });

  for (const filename of EXPECTED_WORKFLOWS) {
    const path = resolve(WORKFLOWS_DIR, filename);

    describe(filename, () => {
      const content = readFileSync(path, "utf8");

      it("has an Action section", () => {
        expect(content).toMatch(/^##\s+Action\s*$/m);
      });

      it("has a Verify section", () => {
        expect(content).toMatch(/^##\s+Verify\s*$/m);
      });

      it("has an Anti-pattern section", () => {
        // Match either "Anti-pattern" or "Anti-patterns" tolerantly.
        expect(content).toMatch(/^##\s+Anti-pattern[s]?\s*$/m);
      });

      it("declares the day-one grove-only scope", () => {
        // Each workflow MD calls out the day-one limitation so an agent
        // reading just one file knows not to generalise.
        expect(content.toLowerCase()).toMatch(/day-one scope/);
        expect(content.toLowerCase()).toMatch(/grove/);
      });

      it("has non-trivial body length", () => {
        // Drop the front-matter / title and ensure there's real content.
        expect(content.length).toBeGreaterThan(400);
      });
    });
  }
});
