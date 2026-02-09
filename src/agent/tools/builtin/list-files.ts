/**
 * List files tool - list directory contents
 */

import { lstat, readdir, realpath, stat } from "node:fs/promises";
import { join, relative, resolve } from "node:path";
import type { ToolDefinition } from "../interface.js";
import {
  type FsRoot,
  type FsRoots,
  isSensitiveOwliabotHomePath,
  normaliseFsRoot,
  rootPathFor,
  validateRelativePath,
} from "./fs-roots.js";

/**
 * Options for creating the list_files tool
 */
export interface ListFilesToolOptions {
  /** Workspace directory path */
  workspace: string;
  /** Optional OwliaBot home directory path */
  owliabotHome?: string;
}

export function createListFilesTool(opts: ListFilesToolOptions): ToolDefinition {
  const roots: FsRoots = { workspace: opts.workspace, owliabotHome: opts.owliabotHome };
  return {
    name: "list_files",
    description:
      "List files and directories in the workspace (or OWLIABOT_HOME when requested). Use this to discover what files are available.",
    parameters: {
      type: "object",
      properties: {
        root: {
          type: "string",
          description:
            "Root to list: 'workspace' (default) or 'owliabot_home'.",
          enum: ["workspace", "owliabot_home"],
        },
        path: {
          type: "string",
          description:
            "Directory path relative to selected root (default: root). Example: 'memory' or 'memory/diary'",
        },
      },
      required: [],
    },
    security: {
      level: "read",
    },
    async execute(params) {
      const { root, path: relativePath } = params as { root?: FsRoot; path?: string };
      const selectedRoot = normaliseFsRoot(root);
      const rootPath = rootPathFor(roots, selectedRoot);
      if (!rootPath) {
        return {
          success: false,
          error: `Invalid root: ${selectedRoot} is not configured`,
        };
      }

      // Security: validate path
      if (relativePath) {
        const v = validateRelativePath(relativePath);
        if (!v.ok) {
          return {
            success: false,
            error: "Invalid path: must be relative to the selected root",
          };
        }
      }

      const absRoot = resolve(rootPath);
      const targetPath = relativePath
        ? resolve(rootPath, relativePath)
        : absRoot;

      // Verify lexical path is within root
      const rel = relative(absRoot, targetPath).replace(/\\/g, "/");
      // Allow empty rel (root) or rel that doesn't start with ..
      const inWorkspace = rel === "" || (rel.length > 0 && !rel.startsWith(".."));
      if (!inWorkspace) {
        return {
          success: false,
          error: "Invalid path: must be relative to the selected root",
        };
      }

      try {
        // Verify realpath is within root (handles symlink escapes)
        const realRoot = await realpath(absRoot);
        const realTarget = await realpath(targetPath);
        const realRel = relative(realRoot, realTarget).replace(/\\/g, "/");
        const realInWorkspace = realRel === "" || (realRel.length > 0 && !realRel.startsWith(".."));
        if (!realInWorkspace) {
          return {
            success: false,
            error: "Invalid path: symlink escape detected",
          };
        }

        // Check if target is a symlink pointing outside root
        const targetStat = await lstat(targetPath);
        if (targetStat.isSymbolicLink()) {
          // Symlink is ok if it resolves within root (already checked above)
          // but we use realpath for actual directory operations
        }

        const entries = await readdir(realTarget);
        const results: Array<{ name: string; type: "file" | "dir" }> = [];

        for (const entry of entries) {
          // Skip hidden files
          if (entry.startsWith(".")) continue;

          // OWLIABOT_HOME: skip known-sensitive entries and directories
          if (selectedRoot === "owliabot_home") {
            const entryRel = rel ? `${rel.replace(/\\/g, "/")}/${entry}` : entry;
            if (isSensitiveOwliabotHomePath(entryRel) || isSensitiveOwliabotHomePath(entry)) {
              continue;
            }
          }

          const entryPath = join(realTarget, entry);
          try {
            // Use lstat to not follow symlinks for type detection
            const entryStat = await lstat(entryPath);

            // For symlinks, check if they escape workspace
            if (entryStat.isSymbolicLink()) {
              try {
                const realEntry = await realpath(entryPath);
                const entryRel = relative(realRoot, realEntry).replace(/\\/g, "/");
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
            root: selectedRoot,
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
