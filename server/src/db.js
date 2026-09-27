import pg from 'pg'
import 'dotenv/config'
import matrixData from './data/matrix.json' with { type: 'json' }

const { Pool } = pg

const poolConfig = process.env.DATABASE_URL
  ? { connectionString: process.env.DATABASE_URL }
  : {
      host: process.env.POSTGRES_HOST || 'localhost',
      port: Number(process.env.POSTGRES_PORT || 5432),
      database: process.env.POSTGRES_DB || 'stroynadzor',
      user: process.env.POSTGRES_USER || 'stroynadzor',
      password: process.env.POSTGRES_PASSWORD || 'stroynadzor_dev',
    }

export const pool = new Pool({
  ...poolConfig,
  max: Number(process.env.DB_POOL_MAX || 10),
  idleTimeoutMillis: 30_000,
})

pool.on('error', (error) => {
  console.error('PostgreSQL pool error', error)
})

export function query(text, params) {
  return pool.query(text, params)
}

export async function withTransaction(callback) {
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    const result = await callback(client)
    await client.query('COMMIT')
    return result
  } catch (error) {
    await client.query('ROLLBACK')
    throw error
  } finally {
    client.release()
  }
}

export async function initDatabase() {
  await query(`
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      email TEXT NOT NULL UNIQUE,
      password_hash TEXT NOT NULL,
      role TEXT NOT NULL DEFAULT 'INSPECTOR',
      org TEXT NOT NULL DEFAULT '',
      phone TEXT NOT NULL DEFAULT '',
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      notif_email_digest BOOLEAN NOT NULL DEFAULT TRUE,
      notif_critical BOOLEAN NOT NULL DEFAULT TRUE,
      notif_weekly BOOLEAN NOT NULL DEFAULT FALSE
    );

    CREATE TABLE IF NOT EXISTS objects (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      address TEXT NOT NULL,
      customer TEXT NOT NULL DEFAULT '',
      contractor TEXT NOT NULL DEFAULT '',
      permit_number TEXT NOT NULL DEFAULT '',
      object_code TEXT NOT NULL,
      process_status TEXT NOT NULL DEFAULT 'PENDING',
      scenario TEXT,
      pd_status TEXT NOT NULL DEFAULT 'MISSING',
      rd_status TEXT NOT NULL DEFAULT 'MISSING',
      id_status TEXT NOT NULL DEFAULT 'MISSING',
      matrix_version TEXT,
      dataset_version TEXT,
      model_version TEXT,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      finalized_at TIMESTAMPTZ
    );

    CREATE TABLE IF NOT EXISTS files (
      id TEXT PRIMARY KEY,
      object_id TEXT NOT NULL REFERENCES objects(id) ON DELETE CASCADE,
      stage TEXT NOT NULL CHECK (stage IN ('PD', 'RD', 'ID')),
      name TEXT NOT NULL,
      mime_type TEXT NOT NULL DEFAULT 'application/octet-stream',
      size BIGINT NOT NULL CHECK (size >= 0),
      sha256 CHAR(64) NOT NULL,
      content BYTEA NOT NULL,
      uploaded_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      parse_status TEXT NOT NULL DEFAULT 'PENDING'
    );

    CREATE TABLE IF NOT EXISTS findings (
      finding_id TEXT PRIMARY KEY,
      object_id TEXT NOT NULL REFERENCES objects(id) ON DELETE CASCADE,
      matrix_code TEXT,
      section TEXT,
      parameter_name TEXT,
      unit TEXT,
      status TEXT NOT NULL DEFAULT 'CANDIDATE',
      review_priority TEXT,
      discovery_method TEXT,
      expected_value TEXT,
      actual_value TEXT,
      trigger_text TEXT,
      description TEXT,
      normative TEXT,
      confidence NUMERIC,
      pd_source JSONB,
      rd_source JSONB,
      verification JSONB,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS completeness (
      id BIGSERIAL PRIMARY KEY,
      object_id TEXT NOT NULL REFERENCES objects(id) ON DELETE CASCADE,
      section TEXT NOT NULL,
      pd_status TEXT NOT NULL DEFAULT 'MISSING',
      rd_status TEXT NOT NULL DEFAULT 'MISSING',
      id_status TEXT NOT NULL DEFAULT 'MISSING',
      note TEXT NOT NULL DEFAULT '',
      UNIQUE (object_id, section)
    );

    CREATE TABLE IF NOT EXISTS matrix_params (
      id INTEGER PRIMARY KEY,
      code TEXT NOT NULL UNIQUE,
      section TEXT NOT NULL,
      parameter TEXT NOT NULL,
      unit TEXT,
      source_pd TEXT,
      source_rd TEXT,
      source_id TEXT,
      trigger_text TEXT,
      priority TEXT
    );

    CREATE TABLE IF NOT EXISTS audit_logs (
      id BIGSERIAL PRIMARY KEY,
      user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
      object_id TEXT REFERENCES objects(id) ON DELETE SET NULL,
      finding_id TEXT,
      action TEXT NOT NULL,
      details JSONB NOT NULL DEFAULT '{}'::jsonb,
      ip_address INET,
      user_agent TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS analysis_processes (
      process_id TEXT PRIMARY KEY,
      object_id TEXT NOT NULL REFERENCES objects(id) ON DELETE CASCADE,
      status TEXT NOT NULL DEFAULT 'PENDING',
      current_step TEXT,
      progress NUMERIC NOT NULL DEFAULT 0,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS process_jobs (
      job_id TEXT PRIMARY KEY,
      process_id TEXT NOT NULL REFERENCES analysis_processes(process_id) ON DELETE CASCADE,
      file_id TEXT NOT NULL REFERENCES files(id) ON DELETE CASCADE,
      status TEXT NOT NULL DEFAULT 'QUEUED',
      error TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS protocols (
      id TEXT PRIMARY KEY,
      object_id TEXT NOT NULL REFERENCES objects(id) ON DELETE CASCADE,
      version INTEGER NOT NULL,
      matrix_version TEXT,
      dataset_version TEXT,
      model_version TEXT,
      input_manifest_hash CHAR(64),
      status TEXT NOT NULL DEFAULT 'DRAFT',
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      finalized_at TIMESTAMPTZ,
      UNIQUE (object_id, version)
    );

    CREATE TABLE IF NOT EXISTS checks (
      id TEXT PRIMARY KEY,
      param_id INTEGER REFERENCES matrix_params(id) ON DELETE SET NULL,
      object_id TEXT NOT NULL REFERENCES objects(id) ON DELETE CASCADE,
      expected_value TEXT,
      actual_value TEXT,
      delta TEXT,
      completeness_status TEXT,
      finding_status TEXT,
      review_priority TEXT,
      evidence_group_id TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS evidence_fragments (
      id TEXT PRIMARY KEY,
      object_id TEXT NOT NULL REFERENCES objects(id) ON DELETE CASCADE,
      file_id TEXT REFERENCES files(id) ON DELETE CASCADE,
      finding_id TEXT REFERENCES findings(finding_id) ON DELETE CASCADE,
      page INTEGER,
      fragment_type TEXT,
      text TEXT,
      bbox JSONB,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS suspicions (
      id TEXT PRIMARY KEY,
      object_id TEXT NOT NULL REFERENCES objects(id) ON DELETE CASCADE,
      finding_id TEXT REFERENCES findings(finding_id) ON DELETE CASCADE,
      status TEXT NOT NULL DEFAULT 'OPEN',
      reason TEXT,
      confidence NUMERIC,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      resolved_at TIMESTAMPTZ
    );

    CREATE TABLE IF NOT EXISTS rejection_log (
      id BIGSERIAL PRIMARY KEY,
      object_id TEXT REFERENCES objects(id) ON DELETE CASCADE,
      finding_id TEXT REFERENCES findings(finding_id) ON DELETE CASCADE,
      user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
      reason_code TEXT,
      comment TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS dispute_log (
      id BIGSERIAL PRIMARY KEY,
      object_id TEXT REFERENCES objects(id) ON DELETE CASCADE,
      finding_id TEXT REFERENCES findings(finding_id) ON DELETE CASCADE,
      user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
      action TEXT NOT NULL,
      comment TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS logical_rules (
      id TEXT PRIMARY KEY,
      code TEXT NOT NULL UNIQUE,
      version TEXT NOT NULL,
      definition JSONB NOT NULL,
      active BOOLEAN NOT NULL DEFAULT TRUE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS normative_base (
      id TEXT PRIMARY KEY,
      code TEXT NOT NULL,
      title TEXT NOT NULL,
      version TEXT,
      source_uri TEXT,
      content JSONB,
      active BOOLEAN NOT NULL DEFAULT TRUE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS ml_retraining_log (
      id BIGSERIAL PRIMARY KEY,
      model_version TEXT NOT NULL,
      dataset_version TEXT,
      status TEXT NOT NULL,
      metrics JSONB,
      started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      finished_at TIMESTAMPTZ
    );

    CREATE TABLE IF NOT EXISTS dataset_items (
      id TEXT PRIMARY KEY,
      object_id TEXT REFERENCES objects(id) ON DELETE CASCADE,
      finding_id TEXT REFERENCES findings(finding_id) ON DELETE CASCADE,
      label TEXT,
      payload JSONB NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS model_versions (
      version TEXT PRIMARY KEY,
      model_type TEXT NOT NULL,
      artifact_uri TEXT,
      metrics JSONB,
      active BOOLEAN NOT NULL DEFAULT FALSE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS monitoring_metrics (
      id BIGSERIAL PRIMARY KEY,
      metric_name TEXT NOT NULL,
      metric_value NUMERIC NOT NULL,
      labels JSONB,
      measured_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS system_settings (
      key TEXT PRIMARY KEY,
      value JSONB NOT NULL,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE INDEX IF NOT EXISTS idx_objects_updated_at ON objects(updated_at DESC);
    CREATE INDEX IF NOT EXISTS idx_files_object_stage ON files(object_id, stage, uploaded_at);
    CREATE INDEX IF NOT EXISTS idx_findings_object_status ON findings(object_id, status);
    CREATE INDEX IF NOT EXISTS idx_audit_logs_created_at ON audit_logs(created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_audit_logs_object_id ON audit_logs(object_id);
    CREATE INDEX IF NOT EXISTS idx_process_jobs_process_id ON process_jobs(process_id);
  `)

  const seedMarker = await query("SELECT value FROM system_settings WHERE key = 'matrix_v1.1_seeded'")
  if (seedMarker.rows.length === 0) {
    await withTransaction(async (client) => {
      for (const parameter of matrixData) {
        await client.query(
          `INSERT INTO matrix_params (id, code, section, parameter, unit, source_pd, source_rd, source_id, trigger_text, priority)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
           ON CONFLICT (id) DO NOTHING`,
          [parameter.id, parameter.code, parameter.section, parameter.parameter, parameter.unit || null, parameter.source_pd || null, parameter.source_rd || null, parameter.source_id || null, parameter.trigger || null, parameter.priority || null],
        )
      }
      await client.query(
        `INSERT INTO system_settings (key, value) VALUES ('matrix_v1.1_seeded', $1::jsonb)`,
        [JSON.stringify({ count: matrixData.length, version: 'v1.1' })],
      )
    })
  }
}
