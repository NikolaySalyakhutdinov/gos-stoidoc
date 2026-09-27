import { query } from '../db.js'
import { verifyToken } from '../utils/jwt.js'

export async function requireAuth(req, res, next) {
  const header = req.headers.authorization || ''
  const token = header.startsWith('Bearer ') ? header.slice(7) : null
  if (!token) return res.status(401).json({ error: 'Требуется авторизация' })

  try {
    const payload = verifyToken(token)
    const result = await query('SELECT * FROM users WHERE id = $1', [payload.sub])
    if (!result.rows[0]) return res.status(401).json({ error: 'Сессия недействительна' })
    req.user = result.rows[0]
    return next()
  } catch (error) {
    if (error.name === 'JsonWebTokenError' || error.name === 'TokenExpiredError') {
      return res.status(401).json({ error: 'Сессия недействительна или истекла' })
    }
    return next(error)
  }
}

export function requireRole(...roles) {
  return (req, res, next) => {
    if (!req.user || !roles.includes(req.user.role)) {
      return res.status(403).json({ error: 'Недостаточно прав. Требуется роль администратора', code: 'ADMIN_REQUIRED' })
    }
    return next()
  }
}
