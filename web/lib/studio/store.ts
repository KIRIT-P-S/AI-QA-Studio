import fs from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";
import { Studio, Project } from "./model";

export const dataDir =
  process.env.STUDIO_DATA_DIR || path.resolve(__dirname, "../../data/studio");
const storePath = path.join(dataDir, "studio.json");
const lockPath = path.join(dataDir, ".write-lock");

export function id(prefix: string) {
  return `${prefix}-${crypto.randomBytes(4).toString("hex")}`;
}

export function validateURL(raw: string) {
  try {
    const u = new URL(raw);
    if (
      !["http:", "https:"].includes(u.protocol) ||
      !u.hostname ||
      u.username ||
      u.password
    )
      throw new Error();
    return u.href;
  } catch {
    throw new Error(`Invalid URL: ${raw}`);
  }
}

export async function readStore(): Promise<Studio> {
  try {
    const data = await fs.readFile(storePath, "utf-8");
    return JSON.parse(data) as Studio;
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === "ENOENT")
      return { version: 1, projects: [] };
    throw e;
  }
}

export async function mutate<T>(
  fn: (store: Studio) => T | Promise<T>,
): Promise<T> {
  await fs.mkdir(dataDir, { recursive: true });
  const deadline = Date.now() + 120000;
  while (true) {
    try {
      await fs.mkdir(lockPath);
      break;
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== "EEXIST") throw e;
      if (Date.now() > deadline)
        throw new Error(
          "Storage is busy. Retry or inspect data/studio/.write-lock after stopping all services.",
        );
      await new Promise((r) => setTimeout(r, 50));
    }
  }
  const tempPath = `${storePath}.tmp.${crypto.randomBytes(4).toString("hex")}`;
  try {
    const store = await readStore();
    const result = await fn(store);
    await fs.writeFile(tempPath, JSON.stringify(store, null, 2), "utf-8");
    for (let attempt = 0; ; attempt++) {
      try {
        await fs.rename(tempPath, storePath);
        break;
      } catch (e) {
        if (
          !["EBUSY", "EPERM"].includes(
            (e as NodeJS.ErrnoException).code || "",
          ) ||
          attempt >= 10
        )
          throw e;
        await new Promise((r) => setTimeout(r, 50));
      }
    }
    return result;
  } finally {
    await fs.unlink(tempPath).catch(() => {});
    await fs.rmdir(lockPath);
  }
}

export function projectById(store: Studio, projectId: string): Project {
  const p = store.projects.find((p) => p.id === projectId);
  if (!p) throw new Error("Project not found.");
  return p;
}

export function activity(project: Project, message: string) {
  project.updatedAt = new Date().toISOString();
  project.activity.unshift({
    at: new Date().toISOString(),
    message,
  });
  project.activity = project.activity.slice(0, 500);
}
