import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { createListFilesTool } from "../list-files.js";
import { mkdtempSync, rmSync, writeFileSync, mkdirSync, symlinkSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

describe("list-files tool", () => {
  let workspacePath: string;
  let outsidePath: string;
  let listFilesTool: ReturnType<typeof createListFilesTool>;

  beforeEach(() => {
    // Create temp directories
    workspacePath = mkdtempSync(join(tmpdir(), "list-files-test-workspace-"));
    outsidePath = mkdtempSync(join(tmpdir(), "list-files-test-outside-"));
    listFilesTool = createListFilesTool({ workspace: workspacePath });
  });

  afterEach(() => {
    rmSync(workspacePath, { recursive: true, force: true });
    rmSync(outsidePath, { recursive: true, force: true });
  });

  describe("basic operations", () => {
    it("should list files and directories", async () => {
      writeFileSync(join(workspacePath, "file1.txt"), "content");
      mkdirSync(join(workspacePath, "dir1"));
      writeFileSync(join(workspacePath, ".hidden"), "hidden");

      const result = await listFilesTool.execute({}, {} as any);

      expect(result.success).toBe(true);
      const data = result.data as any;
      expect(data.entries).toHaveLength(2); // .hidden should be skipped
      expect(data.entries).toContainEqual({ name: "dir1", type: "dir" });
      expect(data.entries).toContainEqual({ name: "file1.txt", type: "file" });
    });

    it("should list files in subdirectory", async () => {
      const subdir = join(workspacePath, "memory");
      mkdirSync(subdir);
      writeFileSync(join(subdir, "sub1.txt"), "content1");
      writeFileSync(join(subdir, "sub2.txt"), "content2");

      const result = await listFilesTool.execute({ path: "memory" }, {} as any);

      expect(result.success).toBe(true);
      const data = result.data as any;
      expect(data.entries).toHaveLength(2);
    });

    it("should sort directories before files", async () => {
      writeFileSync(join(workspacePath, "file1.txt"), "content");
      mkdirSync(join(workspacePath, "dirA"));
      writeFileSync(join(workspacePath, "file2.txt"), "content");
      mkdirSync(join(workspacePath, "dirB"));

      const result = await listFilesTool.execute({}, {} as any);

      const entries = (result.data as any).entries;
      expect(entries[0].type).toBe("dir");
      expect(entries[1].type).toBe("dir");
      expect(entries[2].type).toBe("file");
      expect(entries[3].type).toBe("file");
    });

    it("should skip hidden files", async () => {
      writeFileSync(join(workspacePath, ".git"), "hidden");
      writeFileSync(join(workspacePath, ".hidden"), "hidden");
      writeFileSync(join(workspacePath, "visible.txt"), "visible");

      const result = await listFilesTool.execute({}, {} as any);

      const entries = (result.data as any).entries;
      expect(entries).toHaveLength(1);
      expect(entries[0].name).toBe("visible.txt");
    });

    it("should return error when directory not found", async () => {
      const result = await listFilesTool.execute({ path: "missing" }, {} as any);

      expect(result.success).toBe(false);
      expect(result.error).toContain("Directory not found");
    });
  });

  describe("path security", () => {
    it("should reject paths with ..", async () => {
      const result = await listFilesTool.execute({ path: "../etc" }, {} as any);

      expect(result.success).toBe(false);
      expect(result.error).toContain("Invalid path");
    });

    it("should reject absolute paths", async () => {
      const result = await listFilesTool.execute({ path: "/etc" }, {} as any);

      expect(result.success).toBe(false);
      expect(result.error).toContain("Invalid path");
    });

    it("should reject null bytes in path", async () => {
      const result = await listFilesTool.execute({ path: "test\0dir" }, {} as any);

      expect(result.success).toBe(false);
      expect(result.error).toContain("Invalid path");
    });
  });

  describe("symlink escape protection", () => {
    it("should reject directory symlinks pointing outside workspace", async () => {
      // Create a directory outside workspace with files
      const outsideDir = join(outsidePath, "secrets");
      mkdirSync(outsideDir);
      writeFileSync(join(outsideDir, "secret.txt"), "secret data");

      // Create a symlink in workspace pointing to outside directory
      const symlinkPath = join(workspacePath, "escape-dir");
      symlinkSync(outsideDir, symlinkPath);

      const result = await listFilesTool.execute({ path: "escape-dir" }, {} as any);

      expect(result.success).toBe(false);
      expect(result.error).toMatch(/symlink|Invalid path/i);
    });

    it("should not list contents of symlinked directories escaping workspace", async () => {
      // Create a directory outside workspace
      const outsideDir = join(outsidePath, "secrets");
      mkdirSync(outsideDir);
      writeFileSync(join(outsideDir, "secret.txt"), "secret");

      // Create a symlink in workspace pointing outside
      const symlinkPath = join(workspacePath, "bad-link");
      symlinkSync(outsideDir, symlinkPath);

      // Also create a regular file for comparison
      writeFileSync(join(workspacePath, "good-file.txt"), "visible");

      const result = await listFilesTool.execute({}, {} as any);

      expect(result.success).toBe(true);
      const entries = (result.data as any).entries;
      // The escaping symlink should be skipped
      const names = entries.map((e: any) => e.name);
      expect(names).not.toContain("bad-link");
      expect(names).toContain("good-file.txt");
    });

    it("should skip file symlinks escaping workspace in listings", async () => {
      // Create a file outside workspace
      const outsideFile = join(outsidePath, "secret.txt");
      writeFileSync(outsideFile, "secret data");

      // Create a symlink in workspace pointing to outside file
      const symlinkPath = join(workspacePath, "escape.txt");
      symlinkSync(outsideFile, symlinkPath);

      // Also create a regular file
      writeFileSync(join(workspacePath, "normal.txt"), "normal");

      const result = await listFilesTool.execute({}, {} as any);

      expect(result.success).toBe(true);
      const entries = (result.data as any).entries;
      const names = entries.map((e: any) => e.name);
      // The escaping symlink should be skipped
      expect(names).not.toContain("escape.txt");
      expect(names).toContain("normal.txt");
    });

    it("should allow symlinks within workspace", async () => {
      // Create a real directory in workspace
      const realDir = join(workspacePath, "real-dir");
      mkdirSync(realDir);
      writeFileSync(join(realDir, "file.txt"), "content");

      // Create a symlink in workspace pointing to the real directory
      const symlinkPath = join(workspacePath, "link-dir");
      symlinkSync(realDir, symlinkPath);

      const result = await listFilesTool.execute({}, {} as any);

      expect(result.success).toBe(true);
      const entries = (result.data as any).entries;
      const names = entries.map((e: any) => e.name);
      // Internal symlinks should be allowed
      expect(names).toContain("real-dir");
      expect(names).toContain("link-dir");
    });

    it("should allow navigating into symlinked directories within workspace", async () => {
      // Create a real directory with files
      const realDir = join(workspacePath, "real-dir");
      mkdirSync(realDir);
      writeFileSync(join(realDir, "inner.txt"), "content");

      // Create a symlink to the directory
      const symlinkPath = join(workspacePath, "link-dir");
      symlinkSync(realDir, symlinkPath);

      const result = await listFilesTool.execute({ path: "link-dir" }, {} as any);

      expect(result.success).toBe(true);
      const entries = (result.data as any).entries;
      expect(entries).toContainEqual({ name: "inner.txt", type: "file" });
    });
  });

  describe("metadata", () => {
    it("should have correct metadata", () => {
      expect(listFilesTool.name).toBe("list_files");
      expect(listFilesTool.description).toContain("List files");
      expect(listFilesTool.security.level).toBe("read");
    });
  });
});
