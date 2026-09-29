import { Router } from 'express'
import bcrypt from 'bcryptjs'
import { randomUUID } from 'node:crypto'
import { query, withTransaction } from '../db.js'
import { signRefreshToken, signToken, verifyRefreshToken } from '../utils/jwt.js'
import { toPublicUser } from '../utils/users.js'
import { requireAuth } from '../middleware/auth.js'
import { asyncHandler, recordAudit } from '../utils/http.js'

const router = Router()
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
const ROLES = ['INSPECTOR', 'ADMIN', 'ML_ENGINEER']
const DEMO_EMAIL = 'inspector@stroynadzor-ai.ru'
const DEMO_PASSWORD = 'demo1234'

function issueTokens(row) {
  return {
    token: signToken(row.id, row.role),
    refreshToken: signRefreshToken(row.id, row.role),
  }
}

router.post('/register', asyncHandler(async (req, res) => {
  const { name, email, password, role, org } = req.body || {}
  const normalizedEmail = String(email || '').trim().toLowerCase()

  if (!name || !String(name).trim()) return res.status(400).json({ error: 'Укажите имя и фамилию' })
  if (!EMAIL_RE.test(normalizedEmail)) return res.status(400).json({ error: 'Введите корректный email' })
  if (!normalizedEmail.endsWith('.ru')) {
    return res.status(400).json({ error: 'Регистрация доступна только для email с доменом .ru', code: 'EMAIL_DOMAIN_REQUIRED' })
  }
  if (!password || password.length < 6) return res.status(400).json({ error: 'Пароль должен быть не короче 6 символов' })

  const requestedRole = ROLES.includes(role) ? role : 'INSPECTOR'
  const user = {
    id: randomUUID(),
    name: String(name).trim(),
    email: normalizedEmail,
    passwordHash: await bcrypt.hash(password, 12),
    role: requestedRole,
    org: String(org || '').trim() || 'Мосгосстройнадзор',
  }

  try {
    const row = await withTransaction(async (client) => {
      const countResult = await client.query('SELECT COUNT(*)::int AS count FROM users')
      const effectiveRole = requestedRole === 'ADMIN' && countResult.rows[0].count === 0 ? 'ADMIN' : requestedRole === 'ADMIN' ? 'INSPECTOR' : requestedRole
      const inserted = await client.query(
        `INSERT INTO users (id, name, email, password_hash, role, org)
         VALUES ($1, $2, $3, $4, $5, $6)
         RETURNING *`,
        [user.id, user.name, user.email, user.passwordHash, effectiveRole, user.org],
      )
      await recordAudit(client, { req, userId: user.id, action: 'USER_REGISTERED', details: { email: user.email, role: effectiveRole } })
      return inserted.rows[0]
    })
    return res.status(201).json({ ...issueTokens(row), user: toPublicUser(row) })
  } catch (error) {
    if (error.code === '23505') return res.status(409).json({ error: 'Пользователь с таким email уже зарегистрирован' })
    throw error
  }
}))

router.post('/login', asyncHandler(async (req, res) => {
  const { email, password } = req.body || {}
  if (!email || !password) return res.status(400).json({ error: 'Заполните email и пароль' })

  const normalizedEmail = String(email).trim().toLowerCase()
  let result = await query('SELECT * FROM users WHERE email = $1', [normalizedEmail])
  let row = result.rows[0]
  if (!row && process.env.NODE_ENV !== 'production' && normalizedEmail === DEMO_EMAIL && password === DEMO_PASSWORD) {
    row = await withTransaction(async (client) => {
      const inserted = await client.query(
        `INSERT INTO users (id, name, email, password_hash, role, org)
         VALUES ($1, $2, $3, $4, 'INSPECTOR', $5)
         ON CONFLICT (email) DO UPDATE SET email = EXCLUDED.email
         RETURNING *`,
        [randomUUID(), 'Демо-инспектор', DEMO_EMAIL, await bcrypt.hash(DEMO_PASSWORD, 12), 'Мосгосстройнадзор'],
      )
      await recordAudit(client, { req, userId: inserted.rows[0].id, action: 'DEMO_USER_CREATED', details: { email: DEMO_EMAIL } })
      return inserted.rows[0]
    })
  }
  if (!row || !(await bcrypt.compare(password, row.password_hash))) {
    return res.status(401).json({ error: 'Неверный email или пароль' })
  }

  return res.json({ ...issueTokens(row), user: toPublicUser(row) })
}))

router.post('/refresh', asyncHandler(async (req, res) => {
  const { refreshToken } = req.body || {}
  if (!refreshToken || typeof refreshToken !== 'string') {
    return res.status(401).json({ error: 'Refresh-токен отсутствует' })
  }

  try {
    const payload = verifyRefreshToken(refreshToken)
    const result = await query('SELECT * FROM users WHERE id = $1', [payload.sub])
    const row = result.rows[0]
    if (!row) return res.status(401).json({ error: 'Сессия недействительна' })

    return res.json({
      ...issueTokens(row),
      user: toPublicUser(row),
    })
  } catch {
    return res.status(401).json({ error: 'Refresh-токен недействителен или истёк' })
  }
}))

router.get('/me', requireAuth, (req, res) => {
  res.json({ user: toPublicUser(req.user) })
})

router.patch('/me', requireAuth, asyncHandler(async (req, res) => {
  const { name, email, phone } = req.body || {}
  const nextName = name !== undefined ? String(name).trim() : req.user.name
  const nextEmail = email !== undefined ? String(email).trim().toLowerCase() : req.user.email
  const nextPhone = phone !== undefined ? String(phone).trim() : req.user.phone
  if (!nextName) return res.status(400).json({ error: 'Имя не может быть пустым' })
  if (!EMAIL_RE.test(nextEmail) || !nextEmail.endsWith('.ru')) {
    return res.status(400).json({ error: 'Для профиля нужен корректный email с доменом .ru' })
  }

  try {
    const result = await withTransaction(async (client) => {
      const updated = await client.query(
        `UPDATE users SET name = $1, email = $2, phone = $3 WHERE id = $4 RETURNING *`,
        [nextName, nextEmail, nextPhone, req.user.id],
      )
      await recordAudit(client, { req, action: 'PROFILE_UPDATED', details: { fields: ['name', 'email', 'phone'] } })
      return updated.rows[0]
    })
    return res.json({ user: toPublicUser(result) })
  } catch (error) {
    if (error.code === '23505') return res.status(409).json({ error: 'Пользователь с таким email уже зарегистрирован' })
    throw error
  }
}))

router.patch('/me/notifications', requireAuth, asyncHandler(async (req, res) => {
  const { emailDigest, criticalAlerts, weeklyReport } = req.body || {}
  const result = await query(
    `UPDATE users SET notif_email_digest = COALESCE($1, notif_email_digest),
      notif_critical = COALESCE($2, notif_critical), notif_weekly = COALESCE($3, notif_weekly)
     WHERE id = $4 RETURNING *`,
    [emailDigest === undefined ? null : Boolean(emailDigest), criticalAlerts === undefined ? null : Boolean(criticalAlerts), weeklyReport === undefined ? null : Boolean(weeklyReport), req.user.id],
  )
  res.json({ user: toPublicUser(result.rows[0]) })
}))

router.post('/change-password', requireAuth, asyncHandler(async (req, res) => {
  const { current, next } = req.body || {}
  if (!(await bcrypt.compare(current || '', req.user.password_hash))) {
    return res.status(400).json({ error: 'Текущий пароль указан неверно' })
  }
  if (!next || next.length < 6) return res.status(400).json({ error: 'Новый пароль должен быть не короче 6 символов' })
  await query('UPDATE users SET password_hash = $1 WHERE id = $2', [await bcrypt.hash(next, 12), req.user.id])
  res.json({ ok: true })
}))

router.post('/forgot-password', (req, res) => {
  res.json({ ok: true })
})

export default router
