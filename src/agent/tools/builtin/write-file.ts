/**
 * Write file tool - create or overwrite files with WriteGate integration
 * Matches OpenClaw's group:fs write capability
 */

import { mkdir, writeFile } from "node:fs/promises";
import { dirname, relative, resolve } from "node:path";
import { lstat, realpath } from "node:fs/promises";
import type { ToolDefinition } from "../interface.js";
import { createLogger } from "../../../utils/logger.js";

const log = createLogger("write-file");

/** Protected system paths that should never be written to */
const PROTECTED_PATHS = [
  ".git/config",
  ".git/HEAD",
  ".git/hooks",
  ".ssh",
  ".gnupg",
  ".npmrc",
  ".netrc",
  ".env",
  ".env.local",
  ".env.production",
];

/** Protected filename patterns */
const PROTECTED_PATTERNS = [
  /^\.env(\..+)?$/, // .env, .env.local, .env.production, etc.
  /^id_[a-z]+$/, // SSH keys
  /^.*\.pem$/, // Certificates
  /^.*\.key$/, // Private keys
];

/**
 * Check if a path is a protected system file
 */
function isProtectedPath(relativePath: string): boolean {
  const normalized = relativePath.replace(/\\/g, "/").toLowerCase();
  const basename = normalized.split("/").pop() ?? "";

  // Check exact matches
  for (const protected_ of PROTECTED_PATHS) {
    if (normalized === protected_ || normalized.startsWith(protected_ + "/")) {
      return true;
    }
  }

  // Check patterns
  for (const pattern of PROTECTED_PATTERNS) {
    if (pattern.test(basename)) {
      return true;
    }
  }

  return false;
}

/**
 * Validate and resolve path within workspace bounds
 * Returns null if path is invalid or escapes workspace
 */
async function resolveWorkspacePath(
  workspacePath: string,
  relativePath: string,
): Promise<{ absPath: string; relPath: string; parentExists: boolean } | null> {
  // Basic validation
  if (!relativePath || typeof relativePath !== "string") return null;
  if (relativePath.includes("\0")) return null;
  if (relativePath.startsWith("/")) return null;

  // Resolve paths
  const absWorkspace = resolve(workspacePath);
  const absPath = resolve(workspacePath, relativePath);
  const rel = relative(absWorkspace, absPath).replace(/\\/g, "/");

  // Check if resolved path is within workspace (lexically)
  if (!rel || rel.startsWith("..") || rel.startsWith("/")) {
    return null;
  }

  // Check for protected paths
  if (isProtectedPath(rel)) {
    return null;
  }

  // Verify parent directory resolves within workspace (symlink protection)
  const parentPath = dirname(absPath);
  let parentExists = false;

  try {
    const realWorkspace = await realpath(absWorkspace);

    // Walk up to find existing ancestor and verify it's in workspace
    let checkPath = parentPath;
    while (true) {
      try {
        const realCheck = await realpath(checkPath);
        const checkRel = relative(realWorkspace, realCheck).replace(/\\/g, "/");
        
        // Empty rel means we're at workspace root (allowed)
        if (checkRel.startsWith("..") || (checkRel.startsWith("/") && checkRel !== "")) {
          return null;
        }
        
        if (checkPath === parentPath) {
          parentExists = true;
        }
        break;
      } catch {
        if (checkPath === absWorkspace) {
          break;
        }
        checkPath = dirname(checkPath);
      }
    }
  } catch {
    return null;
  }

  // If file exists, verify it's not a symlink
  try {
    const fileStat = await lstat(absPath);
    if (fileStat.isSymbolicLink()) {
      return null;
    }
    if (fileStat.isDirectory()) {
      return null;
    }
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code !== "ENOENT") {
      return null;
    }
  }

  return { absPath, relPath: rel, parentExists };
}

export function createWriteFileTool(workspacePath: string): ToolDefinition {
  return {
    name: "write_file",
    description:
      "Create a new file or overwrite an existing file. " +
      "Automatically creates parent directories if they don't exist. " +
      "Protected system files (.env, .git/config, SSH keys, etc.) cannot be written. " +
      "Requires user confirmation before execution.",
    parameters: {
      type: "object",
      properties: {
        path: {
          type: "string",
          description: "File path relative to workspace (e.g., 'src/new-file.ts' or 'docs/README.md')",
        },
        content: {
          type: "string",
          description: "Content to write to the file",
        },
      },
      required: ["path", "content"],
    },
    security: {
      level: "write",
    },
    async execute(params) {
      const { path: relativePath, content } = params as {
        path: string;
        content: string;
      };

      // Validate content
      if (typeof content !== "string") {
        return {
          success: false,
          error: "Content must be a string",
        };
      }

      // Resolve and validate path
      const resolved = await resolveWorkspacePath(workspacePath, relativePath);
      if (!resolved) {
        // Check if it's a protected path for a better error message
        if (relativePath && isProtectedPath(relativePath)) {
          return {
            success: false,
            error: `Protected file cannot be written: ${relativePath}`,
          };
        }
        return {
          success: false,
          error: "Invalid path: must be a relative path within the workspace",
        };
      }

      try {
        // Create parent directories if needed
        if (!resolved.parentExists) {
          const parentDir = dirname(resolved.absPath);
          await mkdir(parentDir, { recursive: true });
          log.debug(`Created parent directories for ${resolved.relPath}`);
        }

        // Check if file exists (for reporting)
        let existed = false;
        try {
          await lstat(resolved.absPath);
          existed = true;
        } catch {
          // File doesn't exist
        }

        // Write the file
        await writeFile(resolved.absPath, content, "utf-8");

        const lines = content.split("\n").length;
        const bytes = Buffer.byteLength(content, "utf-8");

        log.info(`${existed ? "Overwrote" : "Created"} file: ${resolved.relPath} (${bytes} bytes, ${lines} lines)`);

        return {
          success: true,
          data: {
            path: resolved.relPath,
            created: !existed,
            overwritten: existed,
            sizeBytes: bytes,
            lines,
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
        if (code === "ENOSPC") {
          return {
            success: false,
            error: "No space left on device",
          };
        }
        if (code === "EROFS") {
          return {
            success: false,
            error: "Read-only file system",
          };
        }
        log.error(`Error writing file ${resolved.relPath}`, err);
        throw err;
      }
    },
  };
}
