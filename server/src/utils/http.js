import { randomUUID } from 'node:crypto'
import { logger } from '../observability/logger.js'

export function asyncHandler(handler) {
  return (req, res, next) => Promise.resolve(handler(req, res, next)).catch(next)
}

export function clientIp(req = {}) {
  return req.headers?.['x-forwarded-for']?.split(',')[0]?.trim() || req.socket?.remoteAddress || null
}

export function auditContext(req = {}) {
  return {
    ipAddress: clientIp(req),
    userAgent: req.headers?.['user-agent'] || null,
  }
}

export function requestLogger(req, res, next) {
  const started = process.hrtime.bigint()
  const requestId = req.headers['x-request-id'] || randomUUID()
  res.setHeader('X-Request-ID', requestId)
  res.on('finish', () => {
    logger.info('HTTP request completed', {
      request_id: requestId,
      method: req.method,
      path: req.originalUrl,
      status_code: res.statusCode,
      duration_ms: Number(process.hrtime.bigint() - started) / 1e6,
      user_id: req.user?.id || null,
    })
  })
  next()
}

export async function recordAudit(client, { req, userId, objectId = null, findingId = null, action, details = {} }) {
  const { ipAddress, userAgent } = auditContext(req)
  await client.query(
    `INSERT INTO audit_logs (user_id, object_id, finding_id, action, details, ip_address, user_agent)
     VALUES ($1, $2, $3, $4, $5::jsonb, $6, $7)`,
    [userId ?? req?.user?.id ?? null, objectId, findingId, action, JSON.stringify(details), ipAddress, userAgent],
  )
}
