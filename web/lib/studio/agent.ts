import fs from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";
import { dataDir } from "./store";

export async function agentToken(): Promise<string> {
  await fs.mkdir(dataDir, { recursive: true });
  const tokenFile = path.join(dataDir, ".agent-token");
  try {
    return (await fs.readFile(tokenFile, "utf-8")).trim();
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === "ENOENT") {
      const token = crypto.randomBytes(32).toString("hex");
      try {
        await fs.writeFile(tokenFile, token, { flag: "wx", mode: 0o600 });
        return token;
      } catch (writeErr) {
        if ((writeErr as NodeJS.ErrnoException).code === "EEXIST") {
          return (await fs.readFile(tokenFile, "utf-8")).trim();
        }
        throw writeErr;
      }
    }
    throw e;
  }
}
