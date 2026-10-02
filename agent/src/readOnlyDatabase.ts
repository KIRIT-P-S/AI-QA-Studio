import mysql from "mysql2/promise";
// pg is intentionally loaded at runtime; it does not ship TypeScript declarations.
import { createRequire } from "node:module";
const requirePackage = createRequire(import.meta.url);
export function assertReadOnly(sql: string) {
  const trimmed = sql.trim();
  if (
    !/^SELECT\s/i.test(trimmed) ||
    /;|--|\/\*|\b(INTO|OUTFILE|DUMPFILE|FOR\s+UPDATE|LOCK|INSERT|UPDATE|DELETE|DROP|ALTER|CREATE|COPY|CALL|EXECUTE|GRANT|REVOKE|TRUNCATE|pg_sleep|sleep|dblink|lo_import|lo_export|set_config)\b/i.test(
      trimmed,
    )
  )
    throw new Error("Only a single read-only SELECT query is allowed.");
}
export async function verifyDatabase(
  sql: string,
): Promise<{ rows: number; preview: unknown[] }> {
  assertReadOnly(sql);
  const url = process.env.TEST_DATABASE_URL;
  if (!url)
    throw new Error(
      "Database verification is not configured. Set TEST_DATABASE_URL using a read-only database account.",
    );
  if (url.startsWith("mysql:")) {
    const c = await mysql.createConnection(url);
    try {
      await c.query("SET SESSION MAX_EXECUTION_TIME=5000");
      await c.query("START TRANSACTION READ ONLY");
      const [rows] = await c.query({ sql, timeout: 5000 });
      const data = rows as unknown[];
      return { rows: data.length, preview: data.slice(0, 20) };
    } finally {
      await c.rollback().catch(() => {});
      await c.end();
    }
  }
  if (!/^postgres(?:ql)?:/.test(url))
    throw new Error("Supported databases are PostgreSQL and MySQL.");
  const { Client } = requirePackage("pg");
  const c = new Client({
    connectionString: url,
    statement_timeout: 5000,
    connectionTimeoutMillis: 5000,
  });
  try {
    await c.connect();
    await c.query("BEGIN READ ONLY");
    const result = await c.query(sql);
    return { rows: result.rows.length, preview: result.rows.slice(0, 20) };
  } finally {
    await c.query("ROLLBACK").catch(() => {});
    await c.end();
  }
}
