import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { mkdtemp, mkdir, rm, symlink, readFile, lstat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createWriteFileTool } from "../write-file.js";

describe("write_file tool", () => {
  let testDir: string;

  beforeEach(async () => {
    testDir = await mkdtemp(join(tmpdir(), "owliabot-write-file-"));
  });

  afterEach(async () => {
    await rm(testDir, { recursive: true, force: true });
  });

  describe("basic functionality", () => {
    it("creates a new file", async () => {
      const tool = createWriteFileTool(testDir);

      const result = await tool.execute(
        { path: "new.txt", content: "hello world" },
        {} as any,
      );

      expect(result.success).toBe(true);
      expect((result as any).data.created).toBe(true);
      expect((result as any).data.overwritten).toBe(false);

      const written = await readFile(join(testDir, "new.txt"), "utf-8");
      expect(written).toBe("hello world");
    });

    it("overwrites an existing file", async () => {
      await mkdir(testDir, { recursive: true });
      const filePath = join(testDir, "existing.txt");
      await (await import("node:fs/promises")).writeFile(filePath, "old content", "utf-8");
      const tool = createWriteFileTool(testDir);

      const result = await tool.execute(
        { path: "existing.txt", content: "new content" },
        {} as any,
      );

      expect(result.success).toBe(true);
      expect((result as any).data.created).toBe(false);
      expect((result as any).data.overwritten).toBe(true);

      const written = await readFile(filePath, "utf-8");
      expect(written).toBe("new content");
    });

    it("creates parent directories automatically", async () => {
      const tool = createWriteFileTool(testDir);

      const result = await tool.execute(
        { path: "deep/nested/dir/file.txt", content: "nested content" },
        {} as any,
      );

      expect(result.success).toBe(true);

      const written = await readFile(join(testDir, "deep/nested/dir/file.txt"), "utf-8");
      expect(written).toBe("nested content");
    });

    it("reports correct metadata", async () => {
      const tool = createWriteFileTool(testDir);
      const content = "line1\nline2\nline3";

      const result = await tool.execute(
        { path: "meta.txt", content },
        {} as any,
      );

      expect(result.success).toBe(true);
      expect((result as any).data.lines).toBe(3);
      expect((result as any).data.sizeBytes).toBe(Buffer.byteLength(content));
      expect((result as any).data.path).toBe("meta.txt");
    });

    it("handles empty content", async () => {
      const tool = createWriteFileTool(testDir);

      const result = await tool.execute(
        { path: "empty.txt", content: "" },
        {} as any,
      );

      expect(result.success).toBe(true);
      const written = await readFile(join(testDir, "empty.txt"), "utf-8");
      expect(written).toBe("");
    });

    it("handles unicode content", async () => {
      const tool = createWriteFileTool(testDir);
      const content = "Hello 世界 🌍 مرحبا";

      const result = await tool.execute(
        { path: "unicode.txt", content },
        {} as any,
      );

      expect(result.success).toBe(true);
      const written = await readFile(join(testDir, "unicode.txt"), "utf-8");
      expect(written).toBe(content);
    });
  });

  describe("error handling", () => {
    it("rejects missing path", async () => {
      const tool = createWriteFileTool(testDir);

      const result = await tool.execute({ content: "test" }, {} as any);

      expect(result.success).toBe(false);
      expect(result.error).toContain("Invalid path");
    });

    it("rejects missing content", async () => {
      const tool = createWriteFileTool(testDir);

      const result = await tool.execute({ path: "test.txt" }, {} as any);

      expect(result.success).toBe(false);
      expect(result.error).toContain("Content must be a string");
    });

    it("rejects non-string content", async () => {
      const tool = createWriteFileTool(testDir);

      const result = await tool.execute(
        { path: "test.txt", content: 123 },
        {} as any,
      );

      expect(result.success).toBe(false);
      expect(result.error).toContain("Content must be a string");
    });

    it("rejects writing to a directory path", async () => {
      await mkdir(join(testDir, "subdir"));
      const tool = createWriteFileTool(testDir);

      const result = await tool.execute(
        { path: "subdir", content: "test" },
        {} as any,
      );

      expect(result.success).toBe(false);
      expect(result.error).toContain("Invalid path");
    });
  });

  describe("security: path traversal protection", () => {
    it("blocks absolute paths", async () => {
      const tool = createWriteFileTool(testDir);

      const result = await tool.execute(
        { path: "/tmp/evil.txt", content: "malicious" },
        {} as any,
      );

      expect(result.success).toBe(false);
      expect(result.error).toContain("Invalid path");
    });

    it("blocks .. traversal", async () => {
      const tool = createWriteFileTool(testDir);

      const result = await tool.execute(
        { path: "../escape.txt", content: "malicious" },
        {} as any,
      );

      expect(result.success).toBe(false);
      expect(result.error).toContain("Invalid path");
    });

    it("blocks nested .. traversal", async () => {
      await mkdir(join(testDir, "subdir"));
      const tool = createWriteFileTool(testDir);

      const result = await tool.execute(
        { path: "subdir/../../escape.txt", content: "malicious" },
        {} as any,
      );

      expect(result.success).toBe(false);
      expect(result.error).toContain("Invalid path");
    });

    it("blocks null byte injection", async () => {
      const tool = createWriteFileTool(testDir);

      const result = await tool.execute(
        { path: "file.txt\x00.jpg", content: "test" },
        {} as any,
      );

      expect(result.success).toBe(false);
      expect(result.error).toContain("Invalid path");
    });
  });

  describe("security: protected file protection", () => {
    it("blocks writing .env files", async () => {
      const tool = createWriteFileTool(testDir);

      const result = await tool.execute(
        { path: ".env", content: "SECRET=xxx" },
        {} as any,
      );

      expect(result.success).toBe(false);
      expect(result.error).toContain("Protected file");
    });

    it("blocks writing .env.local", async () => {
      const tool = createWriteFileTool(testDir);

      const result = await tool.execute(
        { path: ".env.local", content: "SECRET=xxx" },
        {} as any,
      );

      expect(result.success).toBe(false);
      expect(result.error).toContain("Protected file");
    });

    it("blocks writing .env.production", async () => {
      const tool = createWriteFileTool(testDir);

      const result = await tool.execute(
        { path: ".env.production", content: "SECRET=xxx" },
        {} as any,
      );

      expect(result.success).toBe(false);
      expect(result.error).toContain("Protected file");
    });

    it("blocks writing .git/config", async () => {
      const tool = createWriteFileTool(testDir);

      const result = await tool.execute(
        { path: ".git/config", content: "[core]" },
        {} as any,
      );

      expect(result.success).toBe(false);
      expect(result.error).toContain("Protected file");
    });

    it("blocks writing SSH keys", async () => {
      const tool = createWriteFileTool(testDir);

      const result = await tool.execute(
        { path: ".ssh/id_rsa", content: "-----BEGIN RSA PRIVATE KEY-----" },
        {} as any,
      );

      expect(result.success).toBe(false);
      expect(result.error).toContain("Protected file");
    });

    it("blocks writing .pem files", async () => {
      const tool = createWriteFileTool(testDir);

      const result = await tool.execute(
        { path: "certificate.pem", content: "-----BEGIN CERTIFICATE-----" },
        {} as any,
      );

      expect(result.success).toBe(false);
      expect(result.error).toContain("Protected file");
    });

    it("blocks writing .key files", async () => {
      const tool = createWriteFileTool(testDir);

      const result = await tool.execute(
        { path: "private.key", content: "secret key content" },
        {} as any,
      );

      expect(result.success).toBe(false);
      expect(result.error).toContain("Protected file");
    });

    it("allows writing normal files", async () => {
      const tool = createWriteFileTool(testDir);

      const result = await tool.execute(
        { path: "config.json", content: '{"key": "value"}' },
        {} as any,
      );

      expect(result.success).toBe(true);
    });
  });

  describe("security: symlink protection", () => {
    it("blocks writing through symlinked files", async () => {
      const outsideDir = await mkdtemp(join(tmpdir(), "owliabot-outside-"));
      try {
        await symlink(join(outsideDir, "target.txt"), join(testDir, "link.txt"));
        const tool = createWriteFileTool(testDir);

        const result = await tool.execute(
          { path: "link.txt", content: "malicious" },
          {} as any,
        );

        expect(result.success).toBe(false);
        expect(result.error).toContain("Invalid path");
      } finally {
        await rm(outsideDir, { recursive: true, force: true });
      }
    });

    it("blocks writing through symlinked directories", async () => {
      const outsideDir = await mkdtemp(join(tmpdir(), "owliabot-outside-"));
      try {
        await symlink(outsideDir, join(testDir, "linked-dir"));
        const tool = createWriteFileTool(testDir);

        const result = await tool.execute(
          { path: "linked-dir/escape.txt", content: "malicious" },
          {} as any,
        );

        expect(result.success).toBe(false);
        expect(result.error).toContain("Invalid path");
      } finally {
        await rm(outsideDir, { recursive: true, force: true });
      }
    });
  });

  describe("tool metadata", () => {
    it("has correct security level", () => {
      const tool = createWriteFileTool(testDir);
      expect(tool.security.level).toBe("write");
    });

    it("has required parameters", () => {
      const tool = createWriteFileTool(testDir);
      expect(tool.parameters.required).toContain("path");
      expect(tool.parameters.required).toContain("content");
    });
  });
});
