const { Pool } = require('pg');
const { drizzle } = require('drizzle-orm/node-postgres');

const databaseUrl = process.env.NETLIFY_DATABASE_URL || process.env.DATABASE_URL;

if (!databaseUrl) {
  throw new Error('Set NETLIFY_DATABASE_URL or DATABASE_URL before starting the server.');
}

const pool = new Pool({
  connectionString: databaseUrl,
  ssl: databaseUrl.includes('localhost') ? false : { rejectUnauthorized: false }
});

const db = drizzle(pool);

module.exports = {
  databaseUrl,
  pool,
  db
};
