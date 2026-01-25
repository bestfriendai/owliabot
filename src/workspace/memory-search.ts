/**
 * Memory search - keyword matching
 * @see design.md Section 5.4
 */

import { readFile, readdir } from "node:fs/promises";
import { join, relative } from "node:path";
import { createLogger } from "../utils/logger.js";

const log = createLogger("memory-search");

export interface MemorySearchResult {
  path: string;
  startLine: number;
  endLine: number;
  score: number;
  snippet: string;
}

export interface SearchOptions {
  maxResults?: number;
  paths?: string[];
}

export async function searchMemory(
  workspacePath: string,
  query: string,
  options?: SearchOptions
): Promise<MemorySearchResult[]> {
  const maxResults = options?.maxResults ?? 10;
  const memoryDir = join(workspacePath, "memory");
  const results: MemorySearchResult[] = [];
  const queryLower = query.toLowerCase();

  try {
    const files = await findMarkdownFiles(memoryDir);

    for (const file of files) {
      const content = await readFile(file, "utf-8");
      const lines = content.split("\n");
      const relativePath = relative(workspacePath, file);

      for (let i = 0; i < lines.length; i++) {
        if (lines[i].toLowerCase().includes(queryLower)) {
          const startLine = Math.max(0, i - 2);
          const endLine = Math.min(lines.length - 1, i + 2);

          results.push({
            path: relativePath,
            startLine,
            endLine,
            score: 1.0,
            snippet: lines.slice(startLine, endLine + 1).join("\n"),
          });

          if (results.length >= maxResults) {
            return results;
          }
        }
      }
    }
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") {
      log.debug("Memory directory not found");
      return [];
    }
    throw err;
  }

  return results;
}

async function findMarkdownFiles(dir: string): Promise<string[]> {
  const files: string[] = [];

  try {
    const entries = await readdir(dir, { withFileTypes: true });

    for (const entry of entries) {
      const fullPath = join(dir, entry.name);
      if (entry.isDirectory()) {
        const subFiles = await findMarkdownFiles(fullPath);
        files.push(...subFiles);
      } else if (entry.name.endsWith(".md")) {
        files.push(fullPath);
      }
    }
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== "ENOENT") {
      throw err;
    }
  }

  return files;
}
