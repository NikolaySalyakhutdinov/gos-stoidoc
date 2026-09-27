export function asyncHandler(handler) {
  return (req, res, next) => Promise.resolve(handler(req, res, next)).catch(next)
}

export function clientIp(req) {
  return req.headers['x-forwarded-for']?.split(',')[0]?.trim() || req.socket.remoteAddress || null
}

export function auditContext(req) {
  return {
    ipAddress: clientIp(req),
    userAgent: req.headers['user-agent'] || null,
  }
}

export async function recordAudit(client, { req, userId, objectId = null, findingId = null, action, details = {} }) {
  const { ipAddress, userAgent } = auditContext(req)
  await client.query(
    `INSERT INTO audit_logs (user_id, object_id, finding_id, action, details, ip_address, user_agent)
     VALUES ($1, $2, $3, $4, $5::jsonb, $6, $7)`,
    [userId ?? req.user?.id ?? null, objectId, findingId, action, JSON.stringify(details), ipAddress, userAgent],
  )
}
