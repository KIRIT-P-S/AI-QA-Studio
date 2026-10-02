import fs from "node:fs/promises";
import { mutate } from "../../web/lib/studio/store";
import { fingerprint, metrics, type Project } from "../../web/lib/studio/model";

async function main() {
  const p: Project = JSON.parse(await fs.readFile(process.argv[3], "utf8"));
  if (process.argv[2] === "fingerprint") {
    process.stdout.write(
      JSON.stringify({ fingerprint: fingerprint(p), metrics: metrics(p) }),
    );
    return;
  }
  await Promise.all(
    Array.from({ length: 20 }, (_, i) =>
      mutate((s) => {
        s.projects.push({ ...p, id: `node-${i}` });
      }),
    ),
  );
}
void main();
