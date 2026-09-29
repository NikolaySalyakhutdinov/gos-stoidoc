import jwt from 'jsonwebtoken'

const SECRET = process.env.JWT_SECRET || 'local-development-secret-change-me'
const ACCESS_EXPIRES_IN = '8h'
const REFRESH_EXPIRES_IN = '30d'
const ISSUER = 'stroynadzor-api'
const AUDIENCE = 'stroynadzor-web'

if (!process.env.JWT_SECRET && process.env.NODE_ENV === 'production') {
  throw new Error('JWT_SECRET must be set in production')
}

function signPayload(payload, expiresIn) {
  return jwt.sign(payload, SECRET, {
    expiresIn,
    issuer: ISSUER,
    audience: AUDIENCE,
  })
}

export function signToken(userId, role) {
  return signPayload({ sub: userId, role, tokenType: 'access' }, ACCESS_EXPIRES_IN)
}

export function signRefreshToken(userId, role) {
  return signPayload({ sub: userId, role, tokenType: 'refresh' }, REFRESH_EXPIRES_IN)
}

export function verifyToken(token) {
  const payload = jwt.verify(token, SECRET, { issuer: ISSUER, audience: AUDIENCE })
  if (payload.tokenType !== 'access') {
    const error = new Error('Invalid access token')
    error.name = 'JsonWebTokenError'
    throw error
  }
  return payload
}

export function verifyRefreshToken(token) {
  const payload = jwt.verify(token, SECRET, { issuer: ISSUER, audience: AUDIENCE })
  if (payload.tokenType !== 'refresh') {
    const error = new Error('Invalid refresh token')
    error.name = 'JsonWebTokenError'
    throw error
  }
  return payload
}
