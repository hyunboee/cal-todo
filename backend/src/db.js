import pg from 'pg'
import { DB_CONN_STRING, DB_POOL_MAX, DB_STATEMENT_TIMEOUT_MS } from './config.js'

export const pool = new pg.Pool({
  connectionString: DB_CONN_STRING,
  max: DB_POOL_MAX,
  statement_timeout: DB_STATEMENT_TIMEOUT_MS,
})

export const query = (text, params) => pool.query(text, params)

export async function withTx(fn) {
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    const result = await fn(client)
    await client.query('COMMIT')
    return result
  } catch (e) {
    await client.query('ROLLBACK')
    throw e
  } finally {
    client.release()
  }
}
