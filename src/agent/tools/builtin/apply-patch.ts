/**
 * Apply patch tool - apply unified diff to a file with WriteGate integration
 * Matches OpenClaw's group:fs patch capability
 */

import { lstat, readFile, writeFile, mkdir } from "node:fs/promises";
import { dirname, relative, resolve } from "node:path";
import { realpath } from "node:fs/promises";
import type { ToolDefinition } from "../interface.js";
import { createLogger } from "../../../utils/logger.js";

const log = createLogger("apply-patch");

/**
 * Represents a single hunk in a unified diff
 */
interface DiffHunk {
  oldStart: number;
  oldCount: number;
  newStart: number;
  newCount: number;
  lines: string[];
}

/**
 * Parse a unified diff into hunks
 */
function parseUnifiedDiff(patch: string): { hunks: DiffHunk[]; error?: string } {
  const lines = patch.split("\n");
  const hunks: DiffHunk[] = [];
  let currentHunk: DiffHunk | null = null;
  let inHeader = true;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    // Skip diff header lines
    if (line.startsWith("diff ") || line.startsWith("index ") || 
        line.startsWith("--- ") || line.startsWith("+++ ")) {
      inHeader = true;
      continue;
    }

    // Parse hunk header: @@ -start,count +start,count @@
    const hunkMatch = line.match(/^@@\s+-(\d+)(?:,(\d+))?\s+\+(\d+)(?:,(\d+))?\s+@@/);
    if (hunkMatch) {
      if (currentHunk) {
        hunks.push(currentHunk);
      }
      currentHunk = {
        oldStart: parseInt(hunkMatch[1], 10),
        oldCount: hunkMatch[2] ? parseInt(hunkMatch[2], 10) : 1,
        newStart: parseInt(hunkMatch[3], 10),
        newCount: hunkMatch[4] ? parseInt(hunkMatch[4], 10) : 1,
        lines: [],
      };
      inHeader = false;
      continue;
    }

    // If we're in a hunk, collect lines
    if (currentHunk && !inHeader) {
      // Valid patch lines start with ' ', '+', '-', or are empty (context)
      if (line.startsWith(" ") || line.startsWith("+") || line.startsWith("-") || line === "") {
        currentHunk.lines.push(line);
      } else if (line.startsWith("\\")) {
        // "\ No newline at end of file" - ignore but keep processing
        continue;
      } else if (line.trim() === "") {
        // Empty line might be context
        currentHunk.lines.push(" ");
      }
    }
  }

  if (currentHunk) {
    hunks.push(currentHunk);
  }

  if (hunks.length === 0) {
    return { hunks: [], error: "No valid hunks found in patch" };
  }

  return { hunks };
}

/**
 * Apply a single hunk to content lines
 * Returns the modified lines or an error
 */
function applyHunk(
  lines: string[],
  hunk: DiffHunk,
  offset: number,
): { lines: string[]; newOffset: number } | { error: string } {
  const result = [...lines];
  
  // Adjust start position by accumulated offset
  const startLine = hunk.oldStart - 1 + offset;
  
  // Verify context matches
  let oldLineIndex = startLine;
  let insertIndex = startLine;
  const removedCount = hunk.lines.filter(l => l.startsWith("-")).length;
  const addedCount = hunk.lines.filter(l => l.startsWith("+")).length;

  // First pass: verify all context and removed lines match
  let checkIndex = startLine;
  for (const patchLine of hunk.lines) {
    if (patchLine.startsWith(" ") || patchLine.startsWith("-")) {
      const expectedContent = patchLine.slice(1);
      const actualContent = result[checkIndex];
      
      if (actualContent === undefined) {
        return { error: `Patch context mismatch at line ${checkIndex + 1}: expected content but file ended` };
      }
      
      // Normalize for comparison (trim trailing whitespace)
      const normalizedExpected = expectedContent.replace(/\s+$/, "");
      const normalizedActual = actualContent.replace(/\s+$/, "");
      
      if (normalizedExpected !== normalizedActual) {
        return {
          error: `Patch context mismatch at line ${checkIndex + 1}:\n` +
                 `  Expected: "${expectedContent.slice(0, 50)}${expectedContent.length > 50 ? "..." : ""}"\n` +
                 `  Actual:   "${actualContent.slice(0, 50)}${actualContent.length > 50 ? "..." : ""}"`
        };
      }
      checkIndex++;
    }
  }

  // Second pass: apply changes
  const newLines: string[] = [];
  let srcIndex = 0;
  
  // Copy lines before the hunk
  while (srcIndex < startLine) {
    newLines.push(result[srcIndex]);
    srcIndex++;
  }
  
  // Apply hunk changes
  for (const patchLine of hunk.lines) {
    if (patchLine.startsWith(" ")) {
      // Context line - copy from source
      newLines.push(result[srcIndex]);
      srcIndex++;
    } else if (patchLine.startsWith("-")) {
      // Removed line - skip in source
      srcIndex++;
    } else if (patchLine.startsWith("+")) {
      // Added line - insert
      newLines.push(patchLine.slice(1));
    }
  }
  
  // Copy remaining lines after the hunk
  while (srcIndex < result.length) {
    newLines.push(result[srcIndex]);
    srcIndex++;
  }

  const newOffset = offset + addedCount - removedCount;
  
  return { lines: newLines, newOffset };
}

/**
 * Apply all hunks to content
 */
function applyPatch(content: string, patch: string): { content: string } | { error: string } {
  const { hunks, error } = parseUnifiedDiff(patch);
  
  if (error) {
    return { error };
  }
  
  let lines = content.split("\n");
  let offset = 0;
  
  // Sort hunks by old start line to apply in order
  const sortedHunks = [...hunks].sort((a, b) => a.oldStart - b.oldStart);
  
  for (let i = 0; i < sortedHunks.length; i++) {
    const hunk = sortedHunks[i];
    const result = applyHunk(lines, hunk, offset);
    
    if ("error" in result) {
      return { error: `Hunk ${i + 1} failed: ${result.error}` };
    }
    
    lines = result.lines;
    offset = result.newOffset;
  }
  
  return { content: lines.join("\n") };
}

/**
 * Validate and resolve path within workspace bounds
 */
async function resolveWorkspacePath(
  workspacePath: string,
  relativePath: string,
): Promise<{ absPath: string; relPath: string } | null> {
  if (!relativePath || typeof relativePath !== "string") return null;
  if (relativePath.includes("\0")) return null;
  if (relativePath.startsWith("/")) return null;

  const absWorkspace = resolve(workspacePath);
  const absPath = resolve(workspacePath, relativePath);
  const rel = relative(absWorkspace, absPath).replace(/\\/g, "/");

  if (!rel || rel.startsWith("..") || rel.startsWith("/")) {
    return null;
  }

  // Verify parent directory resolves within workspace
  try {
    const realWorkspace = await realpath(absWorkspace);
    const parentPath = dirname(absPath);
    
    let checkPath = parentPath;
    while (true) {
      try {
        const realCheck = await realpath(checkPath);
        const checkRel = relative(realWorkspace, realCheck).replace(/\\/g, "/");
        if (checkRel.startsWith("..") || (checkRel.startsWith("/") && checkRel !== "")) {
          return null;
        }
        break;
      } catch {
        if (checkPath === absWorkspace) break;
        checkPath = dirname(checkPath);
      }
    }
  } catch {
    return null;
  }

  // Verify file exists and is not a symlink
  try {
    const fileStat = await lstat(absPath);
    if (fileStat.isSymbolicLink() || !fileStat.isFile()) {
      return null;
    }

    const realWorkspace = await realpath(absWorkspace);
    const realFile = await realpath(absPath);
    const realRel = relative(realWorkspace, realFile).replace(/\\/g, "/");
    if (!realRel || realRel.startsWith("..") || realRel.startsWith("/")) {
      return null;
    }

    return { absPath: realFile, relPath: rel };
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === "ENOENT") {
      return { absPath, relPath: rel };
    }
    return null;
  }
}

export function createApplyPatchTool(workspacePath: string): ToolDefinition {
  return {
    name: "apply_patch",
    description:
      "Apply a unified diff/patch to a file. The patch must be in standard unified diff format " +
      "(as produced by `diff -u` or `git diff`). The patch is validated before application - " +
      "if the context doesn't match, the operation is rejected. Requires user confirmation.",
    parameters: {
      type: "object",
      properties: {
        path: {
          type: "string",
          description: "File path relative to workspace to patch",
        },
        patch: {
          type: "string",
          description: "Unified diff content to apply (e.g., output from `diff -u` or `git diff`)",
        },
      },
      required: ["path", "patch"],
    },
    security: {
      level: "write",
    },
    async execute(params) {
      const { path: relativePath, patch } = params as {
        path: string;
        patch: string;
      };

      // Validate inputs
      if (!patch || typeof patch !== "string") {
        return {
          success: false,
          error: "Patch content is required",
        };
      }

      if (patch.trim().length === 0) {
        return {
          success: false,
          error: "Patch content is empty",
        };
      }

      // Resolve and validate path
      const resolved = await resolveWorkspacePath(workspacePath, relativePath);
      if (!resolved) {
        return {
          success: false,
          error: "Invalid path: must be a relative path within the workspace",
        };
      }

      try {
        // Read existing file content
        let originalContent: string;
        try {
          originalContent = await readFile(resolved.absPath, "utf-8");
        } catch (err) {
          const code = (err as NodeJS.ErrnoException).code;
          if (code === "ENOENT") {
            return {
              success: false,
              error: `File not found: ${resolved.relPath}. Use write_file to create new files.`,
            };
          }
          throw err;
        }

        // Apply the patch
        const result = applyPatch(originalContent, patch);
        
        if ("error" in result) {
          return {
            success: false,
            error: `Patch failed to apply: ${result.error}`,
          };
        }

        // Verify the patch actually changed something
        if (result.content === originalContent) {
          return {
            success: false,
            error: "Patch produced no changes (already applied or empty diff)",
          };
        }

        // Write the patched content
        await writeFile(resolved.absPath, result.content, "utf-8");

        // Calculate stats
        const oldLines = originalContent.split("\n").length;
        const newLines = result.content.split("\n").length;
        const { hunks } = parseUnifiedDiff(patch);

        log.info(`Applied patch to ${resolved.relPath}: ${hunks.length} hunk(s), ${oldLines} → ${newLines} lines`);

        return {
          success: true,
          data: {
            path: resolved.relPath,
            hunksApplied: hunks.length,
            linesBeforePatch: oldLines,
            linesAfterPatch: newLines,
            linesDelta: newLines - oldLines,
          },
        };
      } catch (err) {
        const code = (err as NodeJS.ErrnoException).code;
        if (code === "EACCES") {
          return {
            success: false,
            error: `Permission denied: ${resolved.relPath}`,
          };
        }
        log.error(`Error applying patch to ${resolved.relPath}`, err);
        throw err;
      }
    },
  };
}
