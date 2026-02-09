/**
 * Shared helpers for filesystem read tools (list_files, read_text_file).
 *
 * These tools are intentionally restricted to a small set of roots to avoid
 * accidental access to arbitrary host paths via prompt injection.
 */

import { lstat, realpath } from "node:fs/promises";
import path from "node:path";

export type FsRoot = "workspace" | "owliabot_home";

export interface FsRoots {
  workspace: string;
  owliabotHome?: string;
}

export function normaliseFsRoot(root?: unknown): FsRoot {
  if (root === "owliabot_home") return "owliabot_home";
  return "workspace";
}

export function rootPathFor(roots: FsRoots, root: FsRoot): string | null {
  if (root === "workspace") return roots.workspace;
  return roots.owliabotHome ?? null;
}

function hasNullByte(p: string): boolean {
  return p.includes("\0");
}

export function validateRelativePath(p: string): { ok: true } | { ok: false; error: string } {
  if (!p || typeof p !== "string") return { ok: false, error: "Invalid path" };
  if (hasNullByte(p)) return { ok: false, error: "Invalid path" };
  if (p.startsWith("/")) return { ok: false, error: "Invalid path: must be relative" };
  return { ok: true };
}

export function isSensitiveOwliabotHomePath(relPath: string): boolean {
  const p = relPath.replace(/\\/g, "/").toLowerCase();
  if (p === "secrets.yaml" || p === "secrets.yml") return true;
  if (p.startsWith("auth/") || p === "auth") return true;

  const base = path.posix.basename(p);
  if (base === ".env" || base.startsWith(".env.")) return true;
  if (base === "id_rsa" || base === "id_ed25519") return true;

  const ext = path.posix.extname(base);
  if ([".pem", ".key", ".p12", ".pfx"].includes(ext)) return true;

  return false;
}

export async function isSymlink(absPath: string): Promise<boolean> {
  try {
    const st = await lstat(absPath);
    return st.isSymbolicLink();
  } catch {
    return false;
  }
}

export function isLexicallyInRoot(absRoot: string, absTarget: string): boolean {
  const rel = path.relative(absRoot, absTarget).replace(/\\/g, "/");
  return rel === "" || (rel.length > 0 && !rel.startsWith("..") && !rel.startsWith("/"));
}

export async function isRealpathInRoot(absRoot: string, absTarget: string): Promise<boolean> {
  const realRoot = await realpath(absRoot);
  const realTarget = await realpath(absTarget);
  const rel = path.relative(realRoot, realTarget).replace(/\\/g, "/");
  return rel === "" || (rel.length > 0 && !rel.startsWith("..") && !rel.startsWith("/"));
}

