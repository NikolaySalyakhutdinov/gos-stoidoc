import { initDatabase, pool } from './db.js'

try {
  await initDatabase()
  console.log('PostgreSQL schema is ready')
} finally {
  await pool.end()
}
