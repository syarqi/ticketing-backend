import { Pool, PoolClient } from 'pg';
import { env } from '../config/env';

export const pool = new Pool(
  env.databaseUrl
    ? {
        connectionString: env.databaseUrl,
        // Supabase (and most managed Postgres) requires SSL. Certificate
        // chain validation is relaxed here since the pooler endpoint uses
        // a certificate not always present in serverless CA bundles.
        ssl: { rejectUnauthorized: false },
      }
    : {
        host: env.db.host,
        port: env.db.port,
        database: env.db.database,
        user: env.db.user,
        password: env.db.password,
      }
);

pool.on('error', (err: Error) => {
  // eslint-disable-next-line no-console
  console.error('Unexpected PostgreSQL pool error', err);
});

/**
 * Run a callback inside a database transaction. Commits on success,
 * rolls back on any thrown error, and always releases the client.
 */
export async function withTransaction<T>(
  fn: (client: PoolClient) => Promise<T>
): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}
