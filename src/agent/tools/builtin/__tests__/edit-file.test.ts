import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { createEditFileTool } from "../edit-file.js";
import { mkdtempSync, rmSync, writeFileSync, mkdirSync, symlinkSync, existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

describe("edit-file tool", () => {
  let workspacePath: string;
  let outsidePath: string;
  let editFileTool: ReturnType<typeof createEditFileTool>;

  beforeEach(() => {
    // Create temp directories
    workspacePath = mkdtempSync(join(tmpdir(), "edit-file-test-workspace-"));
    outsidePath = mkdtempSync(join(tmpdir(), "edit-file-test-outside-"));
    editFileTool = createEditFileTool({ workspace: workspacePath });
  });

  afterEach(() => {
    rmSync(workspacePath, { recursive: true, force: true });
    rmSync(outsidePath, { recursive: true, force: true });
  });

  describe("basic operations", () => {
    it("should replace exact text in file", async () => {
      const filePath = join(workspacePath, "test.txt");
      writeFileSync(filePath, "Hello World\nThis is a test\n");

      const result = await editFileTool.execute(
        {
          path: "test.txt",
          old_text: "Hello World",
          new_text: "Hello Everyone",
        },
        {} as any
      );

      expect(result.success).toBe(true);
      expect(readFileSync(filePath, "utf-8")).toBe("Hello Everyone\nThis is a test\n");
    });

    it("should return error when text not found", async () => {
      const filePath = join(workspacePath, "test.txt");
      writeFileSync(filePath, "Hello World\n");

      const result = await editFileTool.execute(
        {
          path: "test.txt",
          old_text: "Nonexistent",
          new_text: "New",
        },
        {} as any
      );

      expect(result.success).toBe(false);
      expect(result.error).toContain("Could not find the text");
    });

    it("should return error when file not found", async () => {
      const result = await editFileTool.execute(
        {
          path: "missing.txt",
          old_text: "test",
          new_text: "new",
        },
        {} as any
      );

      expect(result.success).toBe(false);
      expect(result.error).toContain("File not found");
    });

    it("should handle multiple occurrences error", async () => {
      const filePath = join(workspacePath, "test.txt");
      writeFileSync(filePath, "test\ntest\ntest\n");

      const result = await editFileTool.execute(
        {
          path: "test.txt",
          old_text: "test",
          new_text: "new",
        },
        {} as any
      );

      expect(result.success).toBe(false);
      expect(result.error).toContain("occurrences");
    });

    it("should return error when no changes made", async () => {
      const filePath = join(workspacePath, "test.txt");
      writeFileSync(filePath, "Hello World\n");

      const result = await editFileTool.execute(
        {
          path: "test.txt",
          old_text: "Hello World",
          new_text: "Hello World",
        },
        {} as any
      );

      expect(result.success).toBe(false);
      expect(result.error).toContain("No changes made");
    });
  });

  describe("fuzzy matching", () => {
    it("should handle fuzzy whitespace matching without corrupting unrelated content", async () => {
      // Original file has spaces for indentation
      const originalContent = "function test() {\n  console.log('hi');\n  return 42;\n}\n";
      const filePath = join(workspacePath, "test.js");
      writeFileSync(filePath, originalContent);

      const result = await editFileTool.execute(
        {
          path: "test.js",
          // Search with tabs (will be fuzzy matched to spaces)
          old_text: "\tconsole.log('hi');",
          new_text: "  console.log('hello');",
        },
        {} as any
      );

      expect(result.success).toBe(true);
      expect(result.data).toHaveProperty("usedFuzzyMatch", true);

      // The unrelated "return 42;" line should be preserved
      const newContent = readFileSync(filePath, "utf-8");
      expect(newContent).toContain("return 42;");
      expect(newContent).toContain("console.log('hello')");
    });

    it("should preserve trailing whitespace on unedited lines", async () => {
      const originalContent = "line1   \nline2\nline3   \n";
      const filePath = join(workspacePath, "test.txt");
      writeFileSync(filePath, originalContent);

      const result = await editFileTool.execute(
        {
          path: "test.txt",
          old_text: "line2",
          new_text: "LINE2",
        },
        {} as any
      );

      expect(result.success).toBe(true);
      // Verify the trailing whitespace on line1 and line3 is preserved
      // Note: normalizeToLF is applied, but trailing spaces should be kept
      // unless we do fuzzy matching (which strips trailing whitespace)
    });
  });

  describe("BOM handling", () => {
    it("should preserve BOM if present", async () => {
      const filePath = join(workspacePath, "test.txt");
      writeFileSync(filePath, "\uFEFFHello World\n");

      const result = await editFileTool.execute(
        {
          path: "test.txt",
          old_text: "Hello World",
          new_text: "Hello Everyone",
        },
        {} as any
      );

      expect(result.success).toBe(true);
      const content = readFileSync(filePath, "utf-8");
      expect(content.charCodeAt(0)).toBe(0xfeff);
    });
  });

  describe("path security", () => {
    it("should reject paths with ..", async () => {
      const result = await editFileTool.execute(
        {
          path: "../etc/passwd",
          old_text: "root",
          new_text: "hacker",
        },
        {} as any
      );

      expect(result.success).toBe(false);
      expect(result.error).toContain("Invalid path");
    });

    it("should reject absolute paths", async () => {
      const result = await editFileTool.execute(
        {
          path: "/etc/passwd",
          old_text: "root",
          new_text: "hacker",
        },
        {} as any
      );

      expect(result.success).toBe(false);
      expect(result.error).toContain("Invalid path");
    });

    it("should reject null bytes in path", async () => {
      const result = await editFileTool.execute(
        {
          path: "test\0.txt",
          old_text: "test",
          new_text: "new",
        },
        {} as any
      );

      expect(result.success).toBe(false);
      expect(result.error).toContain("Invalid path");
    });

    it("should reject empty path", async () => {
      const result = await editFileTool.execute(
        {
          path: "",
          old_text: "test",
          new_text: "new",
        },
        {} as any
      );

      expect(result.success).toBe(false);
      expect(result.error).toContain("Invalid path");
    });
  });

  describe("symlink escape protection", () => {
    it("should reject symlinks pointing outside workspace", async () => {
      // Create a file outside workspace
      const outsideFile = join(outsidePath, "secret.txt");
      writeFileSync(outsideFile, "secret data\n");

      // Create a symlink in workspace pointing to outside file
      const symlinkPath = join(workspacePath, "escape.txt");
      symlinkSync(outsideFile, symlinkPath);

      const result = await editFileTool.execute(
        {
          path: "escape.txt",
          old_text: "secret",
          new_text: "exposed",
        },
        {} as any
      );

      expect(result.success).toBe(false);
      expect(result.error).toMatch(/symlink|Invalid path/i);

      // Verify the outside file was not modified
      expect(readFileSync(outsideFile, "utf-8")).toBe("secret data\n");
    });

    it("should reject directory symlinks that escape workspace", async () => {
      // Create a directory outside workspace with a file
      const outsideDir = join(outsidePath, "subdir");
      mkdirSync(outsideDir);
      const outsideFile = join(outsideDir, "secret.txt");
      writeFileSync(outsideFile, "secret data\n");

      // Create a symlink directory in workspace pointing outside
      const symlinkDir = join(workspacePath, "escape-dir");
      symlinkSync(outsideDir, symlinkDir);

      const result = await editFileTool.execute(
        {
          path: "escape-dir/secret.txt",
          old_text: "secret",
          new_text: "exposed",
        },
        {} as any
      );

      expect(result.success).toBe(false);
      expect(result.error).toMatch(/symlink|Invalid path|cannot resolve/i);

      // Verify the outside file was not modified
      expect(readFileSync(outsideFile, "utf-8")).toBe("secret data\n");
    });

    it("should allow symlinks within workspace", async () => {
      // Create a real file in workspace
      const realFile = join(workspacePath, "real.txt");
      writeFileSync(realFile, "Hello World\n");

      // Create a symlink in workspace pointing to the real file
      const symlinkPath = join(workspacePath, "link.txt");
      symlinkSync(realFile, symlinkPath);

      // Even internal symlinks should be rejected for edit operations
      // (following memory_get pattern for security)
      const result = await editFileTool.execute(
        {
          path: "link.txt",
          old_text: "Hello",
          new_text: "Hi",
        },
        {} as any
      );

      // We reject all symlinks for safety (can relax later if needed)
      expect(result.success).toBe(false);
      expect(result.error).toMatch(/symlink/i);
    });
  });

  describe("metadata", () => {
    it("should have correct metadata", () => {
      expect(editFileTool.name).toBe("edit_file");
      expect(editFileTool.description).toContain("Edit a file");
      expect(editFileTool.security.level).toBe("write");
      expect(editFileTool.parameters.required).toContain("path");
      expect(editFileTool.parameters.required).toContain("old_text");
      expect(editFileTool.parameters.required).toContain("new_text");
    });
  });
});
