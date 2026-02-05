import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { mkdtemp, mkdir, rm, symlink, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createApplyPatchTool } from "../apply-patch.js";

describe("apply_patch tool", () => {
  let testDir: string;

  beforeEach(async () => {
    testDir = await mkdtemp(join(tmpdir(), "owliabot-apply-patch-"));
  });

  afterEach(async () => {
    await rm(testDir, { recursive: true, force: true });
  });

  describe("basic functionality", () => {
    it("applies a simple single-line addition", async () => {
      await writeFile(join(testDir, "test.txt"), "line1\nline2\nline3", "utf-8");
      const tool = createApplyPatchTool(testDir);

      const patch = `--- a/test.txt
+++ b/test.txt
@@ -1,3 +1,4 @@
 line1
+new line
 line2
 line3`;

      const result = await tool.execute({ path: "test.txt", patch }, {} as any);

      expect(result.success).toBe(true);
      expect((result as any).data.hunksApplied).toBe(1);
      expect((result as any).data.linesDelta).toBe(1);

      const content = await readFile(join(testDir, "test.txt"), "utf-8");
      expect(content).toBe("line1\nnew line\nline2\nline3");
    });

    it("applies a simple single-line deletion", async () => {
      await writeFile(join(testDir, "test.txt"), "line1\nline2\nline3", "utf-8");
      const tool = createApplyPatchTool(testDir);

      const patch = `--- a/test.txt
+++ b/test.txt
@@ -1,3 +1,2 @@
 line1
-line2
 line3`;

      const result = await tool.execute({ path: "test.txt", patch }, {} as any);

      expect(result.success).toBe(true);
      expect((result as any).data.linesDelta).toBe(-1);

      const content = await readFile(join(testDir, "test.txt"), "utf-8");
      expect(content).toBe("line1\nline3");
    });

    it("applies a modification (delete + add)", async () => {
      await writeFile(join(testDir, "test.txt"), "line1\nold line\nline3", "utf-8");
      const tool = createApplyPatchTool(testDir);

      const patch = `--- a/test.txt
+++ b/test.txt
@@ -1,3 +1,3 @@
 line1
-old line
+new line
 line3`;

      const result = await tool.execute({ path: "test.txt", patch }, {} as any);

      expect(result.success).toBe(true);
      expect((result as any).data.linesDelta).toBe(0);

      const content = await readFile(join(testDir, "test.txt"), "utf-8");
      expect(content).toBe("line1\nnew line\nline3");
    });

    it("applies multiple hunks", async () => {
      await writeFile(
        join(testDir, "test.txt"),
        "a\nb\nc\nd\ne\nf\ng\nh\ni\nj",
        "utf-8",
      );
      const tool = createApplyPatchTool(testDir);

      const patch = `--- a/test.txt
+++ b/test.txt
@@ -1,3 +1,4 @@
 a
+X
 b
 c
@@ -7,4 +8,5 @@
 g
 h
+Y
 i
 j`;

      const result = await tool.execute({ path: "test.txt", patch }, {} as any);

      expect(result.success).toBe(true);
      expect((result as any).data.hunksApplied).toBe(2);

      const content = await readFile(join(testDir, "test.txt"), "utf-8");
      expect(content).toBe("a\nX\nb\nc\nd\ne\nf\ng\nh\nY\ni\nj");
    });

    it("reports correct metadata", async () => {
      await writeFile(join(testDir, "test.txt"), "a\nb\nc", "utf-8");
      const tool = createApplyPatchTool(testDir);

      const patch = `--- a/test.txt
+++ b/test.txt
@@ -1,3 +1,5 @@
 a
+x
+y
 b
 c`;

      const result = await tool.execute({ path: "test.txt", patch }, {} as any);

      expect(result.success).toBe(true);
      expect((result as any).data.path).toBe("test.txt");
      expect((result as any).data.linesBeforePatch).toBe(3);
      expect((result as any).data.linesAfterPatch).toBe(5);
      expect((result as any).data.linesDelta).toBe(2);
    });
  });

  describe("error handling", () => {
    it("returns error for non-existent file", async () => {
      const tool = createApplyPatchTool(testDir);

      const patch = `--- a/missing.txt
+++ b/missing.txt
@@ -1 +1 @@
-old
+new`;

      const result = await tool.execute({ path: "missing.txt", patch }, {} as any);

      expect(result.success).toBe(false);
      expect(result.error).toContain("File not found");
      expect(result.error).toContain("write_file");
    });

    it("returns error for context mismatch", async () => {
      await writeFile(join(testDir, "test.txt"), "actual content", "utf-8");
      const tool = createApplyPatchTool(testDir);

      const patch = `--- a/test.txt
+++ b/test.txt
@@ -1 +1 @@
-expected content
+new content`;

      const result = await tool.execute({ path: "test.txt", patch }, {} as any);

      expect(result.success).toBe(false);
      expect(result.error).toContain("context mismatch");
    });

    it("returns error for empty patch", async () => {
      await writeFile(join(testDir, "test.txt"), "content", "utf-8");
      const tool = createApplyPatchTool(testDir);

      const result = await tool.execute({ path: "test.txt", patch: "" }, {} as any);

      expect(result.success).toBe(false);
      expect(result.error).toContain("required");
    });

    it("returns error for invalid patch format", async () => {
      await writeFile(join(testDir, "test.txt"), "content", "utf-8");
      const tool = createApplyPatchTool(testDir);

      const result = await tool.execute(
        { path: "test.txt", patch: "this is not a valid patch" },
        {} as any,
      );

      expect(result.success).toBe(false);
      expect(result.error).toContain("No valid hunks");
    });

    it("returns error for patch that produces no changes", async () => {
      await writeFile(join(testDir, "test.txt"), "same\n", "utf-8");
      const tool = createApplyPatchTool(testDir);

      // A patch with only context lines
      const patch = `--- a/test.txt
+++ b/test.txt
@@ -1 +1 @@
 same`;

      const result = await tool.execute({ path: "test.txt", patch }, {} as any);

      expect(result.success).toBe(false);
      expect(result.error).toContain("no changes");
    });

    it("returns error for missing path", async () => {
      const tool = createApplyPatchTool(testDir);

      const result = await tool.execute({ patch: "some patch" }, {} as any);

      expect(result.success).toBe(false);
      expect(result.error).toContain("Invalid path");
    });

    it("returns error for missing patch", async () => {
      await writeFile(join(testDir, "test.txt"), "content", "utf-8");
      const tool = createApplyPatchTool(testDir);

      const result = await tool.execute({ path: "test.txt" }, {} as any);

      expect(result.success).toBe(false);
      expect(result.error).toContain("required");
    });
  });

  describe("security: path traversal protection", () => {
    it("blocks absolute paths", async () => {
      const tool = createApplyPatchTool(testDir);

      const result = await tool.execute(
        { path: "/etc/passwd", patch: "patch" },
        {} as any,
      );

      expect(result.success).toBe(false);
      expect(result.error).toContain("Invalid path");
    });

    it("blocks .. traversal", async () => {
      const tool = createApplyPatchTool(testDir);

      const result = await tool.execute(
        { path: "../escape.txt", patch: "patch" },
        {} as any,
      );

      expect(result.success).toBe(false);
      expect(result.error).toContain("Invalid path");
    });

    it("blocks nested .. traversal", async () => {
      await mkdir(join(testDir, "subdir"));
      const tool = createApplyPatchTool(testDir);

      const result = await tool.execute(
        { path: "subdir/../../escape.txt", patch: "patch" },
        {} as any,
      );

      expect(result.success).toBe(false);
      expect(result.error).toContain("Invalid path");
    });

    it("blocks null byte injection", async () => {
      const tool = createApplyPatchTool(testDir);

      const result = await tool.execute(
        { path: "file.txt\x00.jpg", patch: "patch" },
        {} as any,
      );

      expect(result.success).toBe(false);
      expect(result.error).toContain("Invalid path");
    });
  });

  describe("security: symlink protection", () => {
    it("blocks patching symlinked files", async () => {
      const outsideDir = await mkdtemp(join(tmpdir(), "owliabot-outside-"));
      try {
        await writeFile(join(outsideDir, "target.txt"), "content", "utf-8");
        await symlink(join(outsideDir, "target.txt"), join(testDir, "link.txt"));
        const tool = createApplyPatchTool(testDir);

        const patch = `--- a/link.txt
+++ b/link.txt
@@ -1 +1 @@
-content
+malicious`;

        const result = await tool.execute({ path: "link.txt", patch }, {} as any);

        expect(result.success).toBe(false);
        expect(result.error).toContain("Invalid path");
      } finally {
        await rm(outsideDir, { recursive: true, force: true });
      }
    });

    it("blocks patching through symlinked directories", async () => {
      const outsideDir = await mkdtemp(join(tmpdir(), "owliabot-outside-"));
      try {
        await writeFile(join(outsideDir, "target.txt"), "content", "utf-8");
        await symlink(outsideDir, join(testDir, "linked-dir"));
        const tool = createApplyPatchTool(testDir);

        const patch = `--- a/linked-dir/target.txt
+++ b/linked-dir/target.txt
@@ -1 +1 @@
-content
+malicious`;

        const result = await tool.execute(
          { path: "linked-dir/target.txt", patch },
          {} as any,
        );

        expect(result.success).toBe(false);
        expect(result.error).toContain("Invalid path");
      } finally {
        await rm(outsideDir, { recursive: true, force: true });
      }
    });
  });

  describe("patch parsing edge cases", () => {
    it("handles patches with no newline at end of file marker", async () => {
      await writeFile(join(testDir, "test.txt"), "line1\nline2", "utf-8");
      const tool = createApplyPatchTool(testDir);

      const patch = `--- a/test.txt
+++ b/test.txt
@@ -1,2 +1,2 @@
 line1
-line2
\\ No newline at end of file
+line2-modified`;

      const result = await tool.execute({ path: "test.txt", patch }, {} as any);

      expect(result.success).toBe(true);
      const content = await readFile(join(testDir, "test.txt"), "utf-8");
      expect(content).toBe("line1\nline2-modified");
    });

    it("handles patches without a/b prefixes", async () => {
      await writeFile(join(testDir, "test.txt"), "old", "utf-8");
      const tool = createApplyPatchTool(testDir);

      const patch = `--- test.txt
+++ test.txt
@@ -1 +1 @@
-old
+new`;

      const result = await tool.execute({ path: "test.txt", patch }, {} as any);

      expect(result.success).toBe(true);
      const content = await readFile(join(testDir, "test.txt"), "utf-8");
      expect(content).toBe("new");
    });

    it("handles trailing whitespace differences gracefully", async () => {
      // File has trailing space
      await writeFile(join(testDir, "test.txt"), "line with space \nline2", "utf-8");
      const tool = createApplyPatchTool(testDir);

      // Patch expects no trailing space (common editor normalization)
      const patch = `--- a/test.txt
+++ b/test.txt
@@ -1,2 +1,2 @@
-line with space
+modified line
 line2`;

      const result = await tool.execute({ path: "test.txt", patch }, {} as any);

      expect(result.success).toBe(true);
    });
  });

  describe("tool metadata", () => {
    it("has correct security level", () => {
      const tool = createApplyPatchTool(testDir);
      expect(tool.security.level).toBe("write");
    });

    it("has required parameters", () => {
      const tool = createApplyPatchTool(testDir);
      expect(tool.parameters.required).toContain("path");
      expect(tool.parameters.required).toContain("patch");
    });
  });
});
