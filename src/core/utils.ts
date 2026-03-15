import { randomUUID } from "node:crypto";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { CANONICAL_STATES, type CanonicalState } from "./types.js";

export function nowIso(): string {
  return new Date().toISOString();
}

export function createRunId(prefix = "run"): string {
  return `${prefix}-${Date.now()}-${randomUUID().slice(0, 8)}`;
}

export async function ensureDir(path: string): Promise<void> {
  await mkdir(path, { recursive: true });
}

export async function resetDir(path: string): Promise<void> {
  await rm(path, { recursive: true, force: true });
  await ensureDir(path);
}

export async function writeJson(path: string, value: unknown): Promise<void> {
  await ensureDir(dirname(path));
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

export async function readJson<T>(path: string): Promise<T> {
  const text = await readFile(path, "utf8");
  return JSON.parse(text) as T;
}

export function isCanonicalState(value: string): value is CanonicalState {
  return (CANONICAL_STATES as readonly string[]).includes(value);
}

export function normalizeForMatch(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]/g, "");
}

export function sanitizeBranchName(input: string): string {
  return input.trim().toUpperCase().replace(/[^A-Z0-9._/-]+/g, "-");
}

export function resolveFrom(baseDir: string, maybeRelativePath: string): string {
  return resolve(baseDir, maybeRelativePath);
}

/**
 * Strips undefined values from an object.
 * Use at transport/persistence boundaries to create clean serializable objects.
 * 
 * @example
 * const cleaned = stripUndefined({
 *   id: "123",
 *   name: undefined,
 *   description: "test"
 * });
 * // cleaned: { id: "123", description: "test" }
 */
export function stripUndefined<T extends object>(obj: T): Partial<{[K in keyof T]: T[K]}> {
  const result: Partial<{[K in keyof T]: T[K]}> = {};
  for (const key of Object.keys(obj) as (keyof T)[]) {
    const value = obj[key];
    if (value !== undefined) {
      (result as Record<keyof T, T[keyof T]>)[key] = value;
    }
  }
  return result;
}
