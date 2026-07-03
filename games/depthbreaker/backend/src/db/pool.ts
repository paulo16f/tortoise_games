import pg from "pg";

export type DbClient = pg.PoolClient;
export type Db = pg.Pool;

export function createPool(databaseUrl: string): pg.Pool {
  return new pg.Pool({ connectionString: databaseUrl, max: 10 });
}

/** Run `fn` inside a transaction; rolls back on throw. */
export async function withTransaction<T>(
  pool: pg.Pool,
  fn: (client: DbClient) => Promise<T>,
): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const result = await fn(client);
    await client.query("COMMIT");
    return result;
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}
