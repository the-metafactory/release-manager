/**
 * scan-release-notes.test.ts
 *
 * Unit tests for scripts/scan-release-notes.ts (compass#92, design doc §4 L6
 * "Release notes"). All `gh`/engine interaction is stubbed via the injectable
 * Runner so the suite runs offline and deterministically — no network, no
 * dependency on the installed metafactory-actions package being present.
 *
 * Public-repo discipline: any fixture "confidential" term is RUNTIME-
 * CONSTRUCTED via string concatenation, never written as a literal — this
 * file is itself scanned by the same class of tooling it tests.
 */

import { describe, expect, it, test } from "bun:test";
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import {
  SOURCE_ARCHIVE_DISCLAIMER,
  composeGeneratedNotes,
  composeScanText,
  main,
  parseCliArgs,
  resolveEnginePath,
  resolvePreviousTag,
  scanText,
  type RunResult,
  type Runner,
} from "../scan-release-notes.ts";

// A tier-2 "internal-domain email" shape — the same public-safe fixture class
// the metafactory-actions engine tests itself against. Built at runtime so no
// real-looking literal ever lands in source.
function fixtureBlockTerm(): string {
  return ["leak", "test"].join("") + "@" + ["meta-factory", "ai"].join(".");
}

function fakeRunner(handlers: Record<string, (args: string[], input?: string) => RunResult>): Runner {
  return (cmd, args, input) => {
    const handler = handlers[cmd];
    if (!handler) {
      throw new Error(`fakeRunner: no handler registered for command "${cmd}"`);
    }
    return handler(args, input);
  };
}

describe("parseCliArgs", () => {
  it("parses repo + tag positionals", () => {
    const parsed = parseCliArgs(["the-metafactory/release-manager", "v1.2.3"]);
    expect(parsed).toEqual({
      repoSlug: "the-metafactory/release-manager",
      tagName: "v1.2.3",
    });
  });

  it("parses --previous-tag and --target-commitish flags", () => {
    const parsed = parseCliArgs([
      "the-metafactory/release-manager",
      "v1.2.3",
      "--previous-tag",
      "v1.2.2",
      "--target-commitish",
      "abc123",
    ]);
    expect(parsed).toEqual({
      repoSlug: "the-metafactory/release-manager",
      tagName: "v1.2.3",
      previousTag: "v1.2.2",
      targetCommitish: "abc123",
    });
  });

  it("errors when repo slug is missing", () => {
    const parsed = parseCliArgs([]);
    expect("error" in parsed).toBe(true);
  });

  it("errors when tag is missing", () => {
    const parsed = parseCliArgs(["the-metafactory/release-manager"]);
    expect("error" in parsed).toBe(true);
  });
});

describe("resolvePreviousTag", () => {
  it("returns the tag name on success", () => {
    const run = fakeRunner({
      gh: () => ({ status: 0, stdout: "v0.9.1\n", stderr: "" }),
    });
    expect(resolvePreviousTag("the-metafactory/release-manager", run)).toBe("v0.9.1");
  });

  it("returns undefined when gh fails (no prior release)", () => {
    const run = fakeRunner({
      gh: () => ({ status: 1, stdout: "", stderr: "release not found" }),
    });
    expect(resolvePreviousTag("the-metafactory/release-manager", run)).toBeUndefined();
  });
});

describe("composeGeneratedNotes", () => {
  it("calls the generate-notes REST endpoint via gh api with tag + previous tag", () => {
    let capturedArgs: string[] = [];
    const run = fakeRunner({
      gh: (args) => {
        capturedArgs = args;
        return {
          status: 0,
          stdout: JSON.stringify({ name: "v1.2.3", body: "## What's Changed\n* feat: x" }),
          stderr: "",
        };
      },
    });
    const notes = composeGeneratedNotes(
      "the-metafactory/release-manager",
      "v1.2.3",
      { previousTag: "v1.2.2" },
      run,
    );
    expect(notes).toEqual({ name: "v1.2.3", body: "## What's Changed\n* feat: x" });
    expect(capturedArgs).toContain("repos/the-metafactory/release-manager/releases/generate-notes");
    expect(capturedArgs).toContain("tag_name=v1.2.3");
    expect(capturedArgs).toContain("previous_tag_name=v1.2.2");
  });

  it("omits previous_tag_name when not supplied", () => {
    let capturedArgs: string[] = [];
    const run = fakeRunner({
      gh: (args) => {
        capturedArgs = args;
        return { status: 0, stdout: JSON.stringify({ name: "v1.0.0", body: "" }), stderr: "" };
      },
    });
    composeGeneratedNotes("the-metafactory/release-manager", "v1.0.0", {}, run);
    expect(capturedArgs.some((a) => a.startsWith("previous_tag_name="))).toBe(false);
  });

  it("includes target_commitish when supplied", () => {
    let capturedArgs: string[] = [];
    const run = fakeRunner({
      gh: (args) => {
        capturedArgs = args;
        return { status: 0, stdout: JSON.stringify({ name: "n", body: "b" }), stderr: "" };
      },
    });
    composeGeneratedNotes(
      "the-metafactory/release-manager",
      "v1.0.0",
      { targetCommitish: "deadbeef" },
      run,
    );
    expect(capturedArgs).toContain("target_commitish=deadbeef");
  });

  it("throws on gh api failure, propagating stderr", () => {
    const run = fakeRunner({
      gh: () => ({ status: 1, stdout: "", stderr: "HTTP 404: Not Found" }),
    });
    expect(() =>
      composeGeneratedNotes("the-metafactory/release-manager", "v1.0.0", {}, run),
    ).toThrow(/HTTP 404/);
  });

  it("throws on malformed JSON response", () => {
    const run = fakeRunner({
      gh: () => ({ status: 0, stdout: "not json", stderr: "" }),
    });
    expect(() =>
      composeGeneratedNotes("the-metafactory/release-manager", "v1.0.0", {}, run),
    ).toThrow(/failed to parse/);
  });
});

describe("composeScanText", () => {
  it("combines tag + name + body into one scannable string", () => {
    const text = composeScanText("v1.2.3", { name: "Release Title", body: "* feat: thing" });
    expect(text).toContain("Tag: v1.2.3");
    expect(text).toContain("Name: Release Title");
    expect(text).toContain("* feat: thing");
  });
});

describe("resolveEnginePath", () => {
  it("uses MF_SCAN_ENGINE override when set", () => {
    expect(resolveEnginePath({ MF_SCAN_ENGINE: "/tmp/custom-engine.ts" })).toBe(
      "/tmp/custom-engine.ts",
    );
  });

  it("falls back to the conventional installed-pkg path", () => {
    const resolved = resolveEnginePath({});
    expect(resolved).toBe(
      join(
        homedir(),
        ".config",
        "metafactory",
        "pkg",
        "repos",
        "metafactory-actions",
        "scan",
        "confidentiality-scan.ts",
      ),
    );
  });
});

describe("scanText", () => {
  it("fails closed (exit 3) when the engine is not found", () => {
    const result = scanText("anything", { MF_SCAN_ENGINE: "/nonexistent/engine.ts" });
    expect(result.exitCode).toBe(3);
    expect(result.engineFound).toBe(false);
    expect(result.output).toContain("FAILING CLOSED");
  });

  it("propagates a clean (0) exit from the engine", () => {
    const run = fakeRunner({
      bun: () => ({ status: 0, stdout: "no findings", stderr: "" }),
    });
    const result = scanText("clean text", { MF_SCAN_ENGINE: __filename }, run);
    expect(result.exitCode).toBe(0);
    expect(result.engineFound).toBe(true);
  });

  it("propagates a BLOCK (1) exit from the engine on a fixture term", () => {
    const term = fixtureBlockTerm();
    const run = fakeRunner({
      bun: (_args, input) => {
        const hit = input?.includes(term) ?? false;
        return hit
          ? { status: 1, stdout: "BLOCK tier2:internal-email", stderr: "" }
          : { status: 0, stdout: "clean", stderr: "" };
      },
    });
    const dirty = scanText(`PR title mentions ${term}`, { MF_SCAN_ENGINE: __filename }, run);
    expect(dirty.exitCode).toBe(1);
    const clean = scanText("PR title mentions nothing sensitive", { MF_SCAN_ENGINE: __filename }, run);
    expect(clean.exitCode).toBe(0);
  });
});

describe("SOURCE_ARCHIVE_DISCLAIMER", () => {
  it("names the source-archive scope limitation", () => {
    expect(SOURCE_ARCHIVE_DISCLAIMER).toContain("source-archive");
    expect(SOURCE_ARCHIVE_DISCLAIMER).toContain("does NOT prevent");
  });
});

describe("main (end-to-end orchestration, fully stubbed)", () => {
  it("always prints the disclaimer, even on a usage error", async () => {
    const chunks: string[] = [];
    const origWrite = process.stdout.write.bind(process.stdout);
    process.stdout.write = ((chunk: string) => {
      chunks.push(chunk.toString());
      return true;
    }) as typeof process.stdout.write;
    try {
      const code = await main([]);
      expect(code).toBe(2);
    } finally {
      process.stdout.write = origWrite;
    }
    expect(chunks.join("")).toContain(SOURCE_ARCHIVE_DISCLAIMER);
  });
});

// ---------------------------------------------------------------------------
// Real-engine integration test — only runs when the installed metafactory-
// actions package is present on this machine (dev machines with `arc install`
// run). CI without the package present skips this block; the stubbed suite
// above already covers the full orchestration contract.
// ---------------------------------------------------------------------------

const REAL_ENGINE = join(
  homedir(),
  ".config",
  "metafactory",
  "pkg",
  "repos",
  "metafactory-actions",
  "scan",
  "confidentiality-scan.ts",
);

describe.skipIf(!existsSync(REAL_ENGINE))("scanText against the real installed engine", () => {
  test("a runtime-constructed fixture term blocks (exit 1)", () => {
    const term = fixtureBlockTerm();
    const text = composeScanText("v9.9.9", {
      name: "test release",
      body: `* fix: something mentioning ${term} by mistake`,
    });
    const result = scanText(text);
    expect(result.exitCode).toBe(1);
  });

  test("clean composed notes scan exits 0", () => {
    const text = composeScanText("v9.9.9", {
      name: "test release",
      body: "* fix: nothing sensitive here",
    });
    const result = scanText(text);
    expect(result.exitCode).toBe(0);
  });
});
