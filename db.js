const { Pool } = require('pg');

if (!process.env.DATABASE_URL) {
  console.warn('[db] DATABASE_URL is not set — DB-backed features are unavailable until it is configured in .env');
}

// Neon requires SSL. Allow disabling it for a local/dockerized Postgres used for
// dry-run verification before a real DATABASE_URL exists.
const isLocal = /localhost|127\.0\.0\.1/.test(process.env.DATABASE_URL || '');
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: isLocal ? false : { rejectUnauthorized: false },
});

pool.on('error', (err) => {
  console.error('[db] unexpected error on idle client', err);
});

async function query(text, params) {
  return pool.query(text, params);
}

// Runs `fn(client)` inside BEGIN/COMMIT, rolling back on any thrown error.
async function withTransaction(fn) {
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

async function migrate() {
  if (!process.env.DATABASE_URL) {
    console.warn('[db] skipping migrate() — no DATABASE_URL configured');
    return;
  }

  await pool.query('CREATE EXTENSION IF NOT EXISTS pgcrypto;');

  await pool.query(`
    CREATE TABLE IF NOT EXISTS users (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      email text UNIQUE NOT NULL,
      name text,
      avatar_url text,
      google_sub text UNIQUE,
      elo int NOT NULL DEFAULT 1000,
      resume_score int,
      wins int DEFAULT 0,
      losses int DEFAULT 0,
      current_streak int DEFAULT 0,
      best_streak int DEFAULT 0,
      created_at timestamptz DEFAULT now()
    );
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS resumes (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      pdf_bytes bytea,
      filename text,
      score int,
      breakdown jsonb,
      text_extract text,
      is_current boolean DEFAULT true,
      uploaded_at timestamptz DEFAULT now()
    );
  `);

  // Enforce "only one is_current=true resume per user" via a partial unique index.
  await pool.query(`
    CREATE UNIQUE INDEX IF NOT EXISTS resumes_one_current_per_user
      ON resumes (user_id)
      WHERE is_current;
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS matches (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      player_a uuid NOT NULL REFERENCES users(id),
      player_b uuid NOT NULL REFERENCES users(id),
      winner_id uuid REFERENCES users(id),
      a_transcript text,
      b_transcript text,
      verdict jsonb,
      resume_score_gap int,
      a_elo_before int,
      a_elo_after int,
      b_elo_before int,
      b_elo_after int,
      created_at timestamptz DEFAULT now()
    );
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS achievements (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      code text NOT NULL,
      earned_at timestamptz DEFAULT now(),
      UNIQUE (user_id, code)
    );
  `);

  console.log('[db] migrate() complete — schema up to date');
}

module.exports = { pool, query, withTransaction, migrate };
