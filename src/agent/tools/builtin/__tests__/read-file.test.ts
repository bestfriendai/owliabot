import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { mkdtemp, mkdir, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createReadFileTool } from "../read-file.js";

describe("read_file tool", () => {
  let testDir: string;
  let owliabotHomeDir: string;

  beforeEach(async () => {
    testDir = await mkdtemp(join(tmpdir(), "owliabot-read-file-"));
    owliabotHomeDir = await mkdtemp(join(tmpdir(), "owliabot-home-"));
  });

  afterEach(async () => {
    await rm(testDir, { recursive: true, force: true });
    await rm(owliabotHomeDir, { recursive: true, force: true });
  });

  describe("basic functionality", () => {
    it("reads a simple text file", async () => {
      await writeFile(join(testDir, "test.txt"), "line1\nline2\nline3", "utf-8");
      const tool = createReadFileTool({ workspace: testDir });

      const result = await tool.execute({ path: "test.txt" }, {} as any);

      expect(result.success).toBe(true);
      expect((result as any).data.content).toBe("line1\nline2\nline3");
      expect((result as any).data.totalLines).toBe(3);
      expect((result as any).data.truncated).toBe(false);
    });

    it("reads nested files", async () => {
      await mkdir(join(testDir, "src", "utils"), { recursive: true });
      await writeFile(join(testDir, "src", "utils", "helper.ts"), "export const foo = 1;", "utf-8");
      const tool = createReadFileTool({ workspace: testDir });

      const result = await tool.execute({ path: "src/utils/helper.ts" }, {} as any);

      expect(result.success).toBe(true);
      expect((result as any).data.content).toBe("export const foo = 1;");
      expect((result as any).data.path).toBe("src/utils/helper.ts");
    });

    it("returns file metadata", async () => {
      const content = "a\nb\nc\nd\ne";
      await writeFile(join(testDir, "meta.txt"), content, "utf-8");
      const tool = createReadFileTool({ workspace: testDir });

      const result = await tool.execute({ path: "meta.txt" }, {} as any);

      expect(result.success).toBe(true);
      expect((result as any).data.totalLines).toBe(5);
      expect((result as any).data.sizeBytes).toBe(Buffer.byteLength(content));
      expect((result as any).data.fromLine).toBe(1);
      expect((result as any).data.toLine).toBe(5);
    });
  });

  describe("offset and limit", () => {
    it("respects offset parameter", async () => {
      await writeFile(join(testDir, "lines.txt"), "one\ntwo\nthree\nfour\nfive", "utf-8");
      const tool = createReadFileTool({ workspace: testDir });

      const result = await tool.execute({ path: "lines.txt", offset: 3 }, {} as any);

      expect(result.success).toBe(true);
      expect((result as any).data.content).toBe("three\nfour\nfive");
      expect((result as any).data.fromLine).toBe(3);
    });

    it("respects limit parameter", async () => {
      await writeFile(join(testDir, "lines.txt"), "one\ntwo\nthree\nfour\nfive", "utf-8");
      const tool = createReadFileTool({ workspace: testDir });

      const result = await tool.execute({ path: "lines.txt", limit: 2 }, {} as any);

      expect(result.success).toBe(true);
      expect((result as any).data.content).toBe("one\ntwo");
      expect((result as any).data.truncated).toBe(true);
      expect((result as any).data.toLine).toBe(2);
    });

    it("combines offset and limit", async () => {
      await writeFile(join(testDir, "lines.txt"), "one\ntwo\nthree\nfour\nfive", "utf-8");
      const tool = createReadFileTool({ workspace: testDir });

      const result = await tool.execute({ path: "lines.txt", offset: 2, limit: 2 }, {} as any);

      expect(result.success).toBe(true);
      expect((result as any).data.content).toBe("two\nthree");
      expect((result as any).data.fromLine).toBe(2);
      expect((result as any).data.toLine).toBe(3);
      expect((result as any).data.truncated).toBe(true);
    });

    it("handles offset beyond file length", async () => {
      await writeFile(join(testDir, "short.txt"), "one\ntwo", "utf-8");
      const tool = createReadFileTool({ workspace: testDir });

      const result = await tool.execute({ path: "short.txt", offset: 100 }, {} as any);

      expect(result.success).toBe(true);
      expect((result as any).data.content).toBe("");
    });
  });

  describe("error handling", () => {
    it("returns error for non-existent file", async () => {
      const tool = createReadFileTool({ workspace: testDir });

      const result = await tool.execute({ path: "nonexistent.txt" }, {} as any);

      expect(result.success).toBe(false);
      expect(result.error).toContain("File not found");
    });

    it("returns error for directory", async () => {
      await mkdir(join(testDir, "subdir"));
      const tool = createReadFileTool({ workspace: testDir });

      const result = await tool.execute({ path: "subdir" }, {} as any);

      expect(result.success).toBe(false);
      // Could be "Not a regular file" or path validation error depending on implementation
      expect(result.error).toBeDefined();
    });

    it("returns error for missing path", async () => {
      const tool = createReadFileTool({ workspace: testDir });

      const result = await tool.execute({}, {} as any);

      expect(result.success).toBe(false);
      expect(result.error).toContain("Invalid path");
    });
  });

  describe("security: path traversal protection", () => {
    it("blocks absolute paths", async () => {
      const tool = createReadFileTool({ workspace: testDir });

      const result = await tool.execute({ path: "/etc/passwd" }, {} as any);

      expect(result.success).toBe(false);
      expect(result.error).toContain("Invalid path");
    });

    it("blocks .. traversal", async () => {
      await writeFile(join(testDir, "secret.txt"), "secret", "utf-8");
      const tool = createReadFileTool({ workspace: testDir });

      const result = await tool.execute({ path: "../secret.txt" }, {} as any);

      expect(result.success).toBe(false);
      expect(result.error).toContain("Invalid path");
    });

    it("blocks nested .. traversal", async () => {
      await mkdir(join(testDir, "subdir"));
      const tool = createReadFileTool({ workspace: testDir });

      const result = await tool.execute({ path: "subdir/../../etc/passwd" }, {} as any);

      expect(result.success).toBe(false);
      expect(result.error).toContain("Invalid path");
    });

    it("blocks null byte injection", async () => {
      const tool = createReadFileTool({ workspace: testDir });

      const result = await tool.execute({ path: "file.txt\x00.jpg" }, {} as any);

      expect(result.success).toBe(false);
      expect(result.error).toContain("Invalid path");
    });
  });

  describe("security: symlink protection", () => {
    it("blocks symlinked files", async () => {
      await writeFile(join(testDir, "real.txt"), "real content", "utf-8");
      await symlink(join(testDir, "real.txt"), join(testDir, "link.txt"));
      const tool = createReadFileTool({ workspace: testDir });

      const result = await tool.execute({ path: "link.txt" }, {} as any);

      expect(result.success).toBe(false);
      expect(result.error).toContain("Invalid path");
    });

    it("blocks symlinks pointing outside workspace", async () => {
      const outsideDir = await mkdtemp(join(tmpdir(), "owliabot-outside-"));
      try {
        await writeFile(join(outsideDir, "secret.txt"), "secret", "utf-8");
        await symlink(join(outsideDir, "secret.txt"), join(testDir, "escape.txt"));
        const tool = createReadFileTool({ workspace: testDir });

        const result = await tool.execute({ path: "escape.txt" }, {} as any);

        expect(result.success).toBe(false);
        expect(result.error).toContain("Invalid path");
      } finally {
        await rm(outsideDir, { recursive: true, force: true });
      }
    });

    it("blocks symlinked directory traversal", async () => {
      const outsideDir = await mkdtemp(join(tmpdir(), "owliabot-outside-"));
      try {
        await mkdir(join(testDir, "subdir"));
        await rm(join(testDir, "subdir"), { recursive: true });
        await symlink(outsideDir, join(testDir, "subdir"));
        await writeFile(join(outsideDir, "secret.txt"), "secret", "utf-8");
        const tool = createReadFileTool({ workspace: testDir });

        const result = await tool.execute({ path: "subdir/secret.txt" }, {} as any);

        expect(result.success).toBe(false);
        expect(result.error).toContain("Invalid path");
      } finally {
        await rm(outsideDir, { recursive: true, force: true });
      }
    });
  });

  describe("binary file detection", () => {
    it("rejects PNG files", async () => {
      // PNG magic bytes
      const pngHeader = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
      await writeFile(join(testDir, "image.png"), pngHeader);
      const tool = createReadFileTool({ workspace: testDir });

      const result = await tool.execute({ path: "image.png" }, {} as any);

      expect(result.success).toBe(false);
      expect(result.error).toContain("Binary file detected");
    });

    it("rejects files with null bytes", async () => {
      const binaryContent = Buffer.from("text\x00with\x00nulls");
      await writeFile(join(testDir, "binary.bin"), binaryContent);
      const tool = createReadFileTool({ workspace: testDir });

      const result = await tool.execute({ path: "binary.bin" }, {} as any);

      expect(result.success).toBe(false);
      expect(result.error).toContain("Binary file detected");
    });

    it("accepts valid UTF-8 text", async () => {
      await writeFile(join(testDir, "unicode.txt"), "Hello 世界 🌍", "utf-8");
      const tool = createReadFileTool({ workspace: testDir });

      const result = await tool.execute({ path: "unicode.txt" }, {} as any);

      expect(result.success).toBe(true);
      expect((result as any).data.content).toBe("Hello 世界 🌍");
    });
  });

  describe("file size limits", () => {
    it("rejects files over 50KB", async () => {
      // Create a file just over 50KB
      const largeContent = "x".repeat(51 * 1024);
      await writeFile(join(testDir, "large.txt"), largeContent, "utf-8");
      const tool = createReadFileTool({ workspace: testDir });

      const result = await tool.execute({ path: "large.txt" }, {} as any);

      expect(result.success).toBe(false);
      expect(result.error).toContain("File too large");
      expect(result.error).toContain("51200"); // 50KB in bytes
    });

    it("accepts files under 50KB", async () => {
      const okContent = "x".repeat(49 * 1024);
      await writeFile(join(testDir, "ok.txt"), okContent, "utf-8");
      const tool = createReadFileTool({ workspace: testDir });

      const result = await tool.execute({ path: "ok.txt" }, {} as any);

      expect(result.success).toBe(true);
    });
  });

  describe("OWLIABOT_HOME root", () => {
    it("reads from owliabot_home when requested", async () => {
      await writeFile(join(owliabotHomeDir, "app.yaml"), "telegram: {}\n", "utf-8");
      const tool = createReadFileTool({ workspace: testDir, owliabotHome: owliabotHomeDir });

      const result = await tool.execute({ root: "owliabot_home", path: "app.yaml" }, {} as any);

      expect(result.success).toBe(true);
      expect((result as any).data.content).toContain("telegram");
      expect((result as any).data.root).toBe("owliabot_home");
    });

    it("denies sensitive files under owliabot_home", async () => {
      await writeFile(join(owliabotHomeDir, "secrets.yaml"), "token: SECRET\n", "utf-8");
      const tool = createReadFileTool({ workspace: testDir, owliabotHome: owliabotHomeDir });

      const result = await tool.execute({ root: "owliabot_home", path: "secrets.yaml" }, {} as any);

      expect(result.success).toBe(false);
      expect(result.error).toContain("Access denied");
    });
  });
});
