// Postgres connection pool. DATABASE_URL wins if set (e.g. a managed/cloud
// instance); otherwise falls back to PG* env vars with local-dev defaults
// so `npm start` works against a plain local Postgres with no setup beyond
// creating the database itself.
const { Pool } = require('pg');

const pool = new Pool(
  process.env.DATABASE_URL
    ? {
        connectionString: process.env.DATABASE_URL,
        // Managed Postgres providers all require TLS; most terminate it
        // with a cert this box's CA bundle won't already trust, so this
        // matches the connection encryption without pinning to one
        // provider's CA. Local dev never sets DATABASE_URL, so this
        // branch — and the relaxed check — only applies to a real
        // external database.
        ssl: { rejectUnauthorized: false },
      }
    : {
        host: process.env.PGHOST || 'localhost',
        port: Number(process.env.PGPORT) || 5432,
        user: process.env.PGUSER || 'postgres',
        password: process.env.PGPASSWORD || 'postgres',
        database: process.env.PGDATABASE || 'freight_portal',
      }
);

module.exports = { pool };
