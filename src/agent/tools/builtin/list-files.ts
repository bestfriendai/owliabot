/**
 * List files tool - list directory contents
 */

import { lstat, readdir, realpath, stat } from "node:fs/promises";
import { join, relative, resolve } from "node:path";
import type { ToolDefinition } from "../interface.js";

/**
 * Options for creating the list_files tool
 */
export interface ListFilesToolOptions {
  /** Workspace directory path */
  workspace: string;
}

export function createListFilesTool(opts: ListFilesToolOptions): ToolDefinition {
  const { workspace: workspacePath } = opts;
  return {
    name: "list_files",
    description:
      "List files and directories in the workspace. Use this to discover what files are available.",
    parameters: {
      type: "object",
      properties: {
        path: {
          type: "string",
          description:
            "Directory path relative to workspace (default: root). Example: 'memory' or 'memory/diary'",
        },
      },
      required: [],
    },
    security: {
      level: "read",
    },
    async execute(params) {
      const { path: relativePath } = params as { path?: string };

      // Security: validate path
      if (relativePath) {
        if (relativePath.startsWith("/") || relativePath.includes("\0")) {
          return {
            success: false,
            error: "Invalid path: must be relative to workspace",
          };
        }
      }

      const absWorkspace = resolve(workspacePath);
      const targetPath = relativePath
        ? resolve(workspacePath, relativePath)
        : absWorkspace;

      // Verify lexical path is within workspace
      const rel = relative(absWorkspace, targetPath).replace(/\\/g, "/");
      // Allow empty rel (root) or rel that doesn't start with ..
      const inWorkspace = rel === "" || (rel.length > 0 && !rel.startsWith(".."));
      if (!inWorkspace) {
        return {
          success: false,
          error: "Invalid path: must be relative to workspace",
        };
      }

      try {
        // Verify realpath is within workspace (handles symlink escapes)
        const realWorkspace = await realpath(absWorkspace);
        const realTarget = await realpath(targetPath);
        const realRel = relative(realWorkspace, realTarget).replace(/\\/g, "/");
        const realInWorkspace = realRel === "" || (realRel.length > 0 && !realRel.startsWith(".."));
        if (!realInWorkspace) {
          return {
            success: false,
            error: "Invalid path: symlink escape detected",
          };
        }

        // Check if target is a symlink pointing outside workspace
        const targetStat = await lstat(targetPath);
        if (targetStat.isSymbolicLink()) {
          // Symlink is ok if it resolves within workspace (already checked above)
          // but we use realpath for actual directory operations
        }

        const entries = await readdir(realTarget);
        const results: Array<{ name: string; type: "file" | "dir" }> = [];

        for (const entry of entries) {
          // Skip hidden files
          if (entry.startsWith(".")) continue;

          const entryPath = join(realTarget, entry);
          try {
            // Use lstat to not follow symlinks for type detection
            const entryStat = await lstat(entryPath);

            // For symlinks, check if they escape workspace
            if (entryStat.isSymbolicLink()) {
              try {
                const realEntry = await realpath(entryPath);
                const entryRel = relative(realWorkspace, realEntry).replace(/\\/g, "/");
                const entryInWorkspace = entryRel === "" || (entryRel.length > 0 && !entryRel.startsWith(".."));
                if (!entryInWorkspace) {
                  // Skip symlinks that escape workspace
                  continue;
                }
                // Use stat to get actual type of symlink target
                const realStat = await stat(entryPath);
                results.push({
                  name: entry,
                  type: realStat.isDirectory() ? "dir" : "file",
                });
              } catch {
                // Broken symlink or permission error, skip
                continue;
              }
            } else {
              results.push({
                name: entry,
                type: entryStat.isDirectory() ? "dir" : "file",
              });
            }
          } catch {
            // Skip entries we can't stat
            continue;
          }
        }

        // Sort: directories first, then files
        results.sort((a, b) => {
          if (a.type !== b.type) return a.type === "dir" ? -1 : 1;
          return a.name.localeCompare(b.name);
        });

        return {
          success: true,
          data: {
            path: relativePath || ".",
            entries: results,
          },
        };
      } catch (err) {
        if ((err as NodeJS.ErrnoException).code === "ENOENT") {
          return {
            success: false,
            error: `Directory not found: ${relativePath || "."}`,
          };
        }
        throw err;
      }
    },
  };
}
