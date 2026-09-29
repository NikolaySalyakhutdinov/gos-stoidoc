import { fetch } from 'undici'

const service = process.env.LOG_SERVICE_NAME || 'stroynadzor-api'
const logstashUrl = process.env.LOGSTASH_URL || ''

function normalizeError(error) {
  if (!error) return undefined
  return {
    name: error.name,
    message: error.message || String(error),
    stack: error.stack,
    code: error.code,
  }
}

function write(level, message, fields = {}) {
  const entry = {
    '@timestamp': new Date().toISOString(),
    service,
    environment: process.env.NODE_ENV || 'development',
    level,
    message,
    ...fields,
  }
  process.stdout.write(`${JSON.stringify(entry)}\n`)

  if (logstashUrl) {
    fetch(logstashUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(entry),
      signal: AbortSignal.timeout(1000),
    }).catch(() => {})
  }
}

export const logger = {
  info(message, fields) {
    write('info', message, fields)
  },
  warn(message, fields) {
    write('warn', message, fields)
  },
  error(message, fields = {}) {
    const error = fields.error instanceof Error ? normalizeError(fields.error) : fields.error
    write('error', message, { ...fields, ...(error ? { error } : {}) })
  },
}
