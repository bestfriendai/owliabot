/**
 * Edit file tool - precise text replacement
 * Inspired by pi-coding-agent's edit tool
 */

import { constants } from "node:fs";
import { lstat, open, readFile, realpath, writeFile } from "node:fs/promises";
import { join, relative, resolve } from "node:path";
import type { ToolDefinition } from "../interface.js";

/**
 * Options for creating the edit_file tool
 */
export interface EditFileToolOptions {
  /** Workspace directory path */
  workspace: string;
}

// Strip UTF-8 BOM if present
function stripBom(text: string): { bom: string; text: string } {
  if (text.charCodeAt(0) === 0xfeff) {
    return { bom: "\uFEFF", text: text.slice(1) };
  }
  return { bom: "", text };
}

// Detect line ending style
function detectLineEnding(text: string): "\r\n" | "\n" {
  const crlfCount = (text.match(/\r\n/g) || []).length;
  const lfCount = (text.match(/(?<!\r)\n/g) || []).length;
  return crlfCount > lfCount ? "\r\n" : "\n";
}

// Normalize to LF for consistent matching
function normalizeToLF(text: string): string {
  return text.replace(/\r\n/g, "\n");
}

// Restore original line endings
function restoreLineEndings(text: string, ending: "\r\n" | "\n"): string {
  if (ending === "\r\n") {
    return text.replace(/\n/g, "\r\n");
  }
  return text;
}

// Normalize whitespace for fuzzy matching
function normalizeForFuzzyMatch(text: string): string {
  return text
    .replace(/\r\n/g, "\n")
    .replace(/[ \t]+$/gm, "") // trailing whitespace per line
    .replace(/^\s+/gm, (match) => match.replace(/\t/g, "  ")); // normalize leading tabs
}

// Build a mapping from normalized positions to original positions
function buildPositionMap(original: string, normalized: string): number[] {
  // Returns an array where map[normalizedIdx] = originalIdx
  // This handles cases where normalization changes string length
  const map: number[] = [];
  let origIdx = 0;
  let normIdx = 0;
  const origLen = original.length;
  const normLen = normalized.length;

  while (normIdx < normLen && origIdx < origLen) {
    map[normIdx] = origIdx;

    const origChar = original[origIdx];
    const normChar = normalized[normIdx];

    if (origChar === normChar) {
      origIdx++;
      normIdx++;
    } else if (origChar === "\r" && original[origIdx + 1] === "\n" && normChar === "\n") {
      // CRLF -> LF normalization
      origIdx += 2;
      normIdx++;
    } else if (origChar === "\t" && normChar === " ") {
      // Tab -> spaces normalization (tabs become 2 spaces in normalizeForFuzzyMatch)
      origIdx++;
      normIdx++;
      // Skip the second space from tab expansion
      if (normIdx < normLen && normalized[normIdx] === " ") {
        map[normIdx] = origIdx;
        normIdx++;
      }
    } else if ((origChar === " " || origChar === "\t") && normChar !== " " && normChar !== "\t") {
      // Trailing whitespace stripped in normalized
      origIdx++;
    } else {
      // Default: advance both
      origIdx++;
      normIdx++;
    }
  }

  // Fill remaining positions
  while (normIdx < normLen) {
    map[normIdx] = origIdx;
    normIdx++;
  }

  return map;
}

// Find the end position in original content given a normalized match
function findOriginalMatchEnd(
  original: string,
  normalizedMatchEnd: number,
  positionMap: number[]
): number {
  // Map the end position back to original
  if (normalizedMatchEnd >= positionMap.length) {
    return original.length;
  }
  return positionMap[normalizedMatchEnd] ?? original.length;
}

// Find text with fuzzy matching fallback
// Returns positions in the ORIGINAL content for replacement
function fuzzyFindText(
  content: string,
  searchText: string
): {
  found: boolean;
  startIndex: number;
  endIndex: number;
  usedFuzzy: boolean;
} {
  // Try exact match first
  const exactIndex = content.indexOf(searchText);
  if (exactIndex !== -1) {
    return {
      found: true,
      startIndex: exactIndex,
      endIndex: exactIndex + searchText.length,
      usedFuzzy: false,
    };
  }

  // Try fuzzy match (normalized whitespace)
  const fuzzyContent = normalizeForFuzzyMatch(content);
  const fuzzySearchText = normalizeForFuzzyMatch(searchText);
  const fuzzyIndex = fuzzyContent.indexOf(fuzzySearchText);

  if (fuzzyIndex !== -1) {
    // Build position map to translate back to original content
    const positionMap = buildPositionMap(content, fuzzyContent);
    const startIndex = positionMap[fuzzyIndex] ?? 0;
    const endIndex = findOriginalMatchEnd(
      content,
      fuzzyIndex + fuzzySearchText.length,
      positionMap
    );

    return {
      found: true,
      startIndex,
      endIndex,
      usedFuzzy: true,
    };
  }

  return {
    found: false,
    startIndex: -1,
    endIndex: -1,
    usedFuzzy: false,
  };
}

// Count occurrences using fuzzy matching
function countOccurrences(content: string, searchText: string): number {
  const fuzzyContent = normalizeForFuzzyMatch(content);
  const fuzzySearchText = normalizeForFuzzyMatch(searchText);
  return fuzzyContent.split(fuzzySearchText).length - 1;
}

// Generate simple diff info
function generateDiffInfo(
  oldContent: string,
  newContent: string
): { linesChanged: number; firstChangedLine: number } {
  const oldLines = oldContent.split("\n");
  const newLines = newContent.split("\n");

  let firstChangedLine = 1;
  for (let i = 0; i < Math.max(oldLines.length, newLines.length); i++) {
    if (oldLines[i] !== newLines[i]) {
      firstChangedLine = i + 1;
      break;
    }
  }

  const linesChanged = Math.abs(newLines.length - oldLines.length) + 1;
  return { linesChanged, firstChangedLine };
}

export function createEditFileTool(opts: EditFileToolOptions): ToolDefinition {
  const { workspace: workspacePath } = opts;
  return {
    name: "edit_file",
    description:
      "Edit a file by replacing exact text. The old_text must match exactly (including whitespace). Use this for precise, surgical edits. Whitespace differences are handled with fuzzy matching.",
    parameters: {
      type: "object",
      properties: {
        path: {
          type: "string",
          description: "File path relative to workspace",
        },
        old_text: {
          type: "string",
          description: "Exact text to find and replace",
        },
        new_text: {
          type: "string",
          description: "New text to replace with",
        },
      },
      required: ["path", "old_text", "new_text"],
    },
    security: {
      level: "write",
    },
    async execute(params) {
      const { path: relativePath, old_text, new_text } = params as {
        path: string;
        old_text: string;
        new_text: string;
      };

      // Security: ensure path is within workspace
      if (!relativePath || relativePath.startsWith("/") || relativePath.includes("\0")) {
        return {
          success: false,
          error: "Invalid path: must be relative to workspace",
        };
      }

      // Resolve and verify the path is within workspace
      const absWorkspace = resolve(workspacePath);
      const absPath = resolve(workspacePath, relativePath);
      const rel = relative(absWorkspace, absPath).replace(/\\/g, "/");
      const inWorkspace = rel.length > 0 && !rel.startsWith("..");
      if (!inWorkspace) {
        return {
          success: false,
          error: "Invalid path: must be relative to workspace",
        };
      }

      // Verify realpath of parent directory is within workspace (handles symlink escapes)
      try {
        const realWorkspace = await realpath(absWorkspace);
        const realParent = await realpath(resolve(absPath, ".."));
        const parentRel = relative(realWorkspace, realParent).replace(/\\/g, "/");
        const parentInWorkspace = parentRel.length >= 0 && !parentRel.startsWith("..");
        if (!parentInWorkspace) {
          return {
            success: false,
            error: "Invalid path: symlink escape detected",
          };
        }
      } catch {
        return {
          success: false,
          error: "Invalid path: cannot resolve parent directory",
        };
      }

      try {
        // Check if file exists and is not a symlink
        const fileStat = await lstat(absPath);
        if (fileStat.isSymbolicLink()) {
          return {
            success: false,
            error: "Invalid path: cannot edit symlinks",
          };
        }
        if (!fileStat.isFile()) {
          return {
            success: false,
            error: "Invalid path: not a regular file",
          };
        }

        // Verify realpath of file is within workspace
        const realWorkspace = await realpath(absWorkspace);
        const realFile = await realpath(absPath);
        const fileRel = relative(realWorkspace, realFile).replace(/\\/g, "/");
        const fileInWorkspace = fileRel.length > 0 && !fileRel.startsWith("..");
        if (!fileInWorkspace) {
          return {
            success: false,
            error: "Invalid path: file resolves outside workspace",
          };
        }

        // Read file with O_NOFOLLOW to prevent TOCTOU
        let rawContent: string;
        try {
          const fh = await open(absPath, constants.O_RDONLY | constants.O_NOFOLLOW);
          try {
            const fdStat = await fh.stat();
            if (!fdStat.isFile()) {
              return {
                success: false,
                error: "Invalid path: not a regular file",
              };
            }
            rawContent = await fh.readFile({ encoding: "utf-8" });
          } finally {
            await fh.close();
          }
        } catch (err) {
          const code = (err as NodeJS.ErrnoException).code;
          if (code === "ELOOP") {
            return {
              success: false,
              error: "Invalid path: cannot edit symlinks",
            };
          }
          // Fallback for platforms without O_NOFOLLOW support
          const okToFallback = code === "EINVAL" || code === "ENOSYS" || code === "EOPNOTSUPP";
          if (!okToFallback) throw err;
          rawContent = await readFile(absPath, "utf-8");
        }

        // Strip BOM
        const { bom, text: content } = stripBom(rawContent);
        const originalEnding = detectLineEnding(content);

        // Normalize for matching
        const normalizedContent = normalizeToLF(content);
        const normalizedOldText = normalizeToLF(old_text);
        const normalizedNewText = normalizeToLF(new_text);

        // Find the text in the normalized content, but get positions for original content
        const matchResult = fuzzyFindText(normalizedContent, normalizedOldText);

        if (!matchResult.found) {
          return {
            success: false,
            error: `Could not find the text in ${relativePath}. The old_text must match exactly including whitespace and newlines.`,
          };
        }

        // Check for multiple occurrences
        const occurrences = countOccurrences(normalizedContent, normalizedOldText);
        if (occurrences > 1) {
          return {
            success: false,
            error: `Found ${occurrences} occurrences in ${relativePath}. Please provide more context to make the match unique.`,
          };
        }

        // Perform replacement on the ORIGINAL normalized content (preserving unrelated whitespace)
        // The fuzzy match positions are already mapped back to original content positions
        const newContent =
          normalizedContent.substring(0, matchResult.startIndex) +
          normalizedNewText +
          normalizedContent.substring(matchResult.endIndex);

        // Check if actually changed
        if (normalizedContent === newContent) {
          return {
            success: false,
            error: `No changes made. The replacement produced identical content.`,
          };
        }

        // Restore line endings and BOM, then write
        const finalContent = bom + restoreLineEndings(newContent, originalEnding);
        await writeFile(absPath, finalContent, "utf-8");

        const diffInfo = generateDiffInfo(normalizedContent, newContent);

        return {
          success: true,
          data: {
            message: `Successfully edited ${relativePath}`,
            path: relativePath,
            firstChangedLine: diffInfo.firstChangedLine,
            usedFuzzyMatch: matchResult.usedFuzzy,
          },
        };
      } catch (err) {
        if ((err as NodeJS.ErrnoException).code === "ENOENT") {
          return {
            success: false,
            error: `File not found: ${relativePath}`,
          };
        }
        throw err;
      }
    },
  };
}
