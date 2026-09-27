import jwt from 'jsonwebtoken'

const SECRET = process.env.JWT_SECRET || 'local-development-only-change-me'
const EXPIRES_IN = '8h'
const ISSUER = 'stroynadzor-api'
const AUDIENCE = 'stroynadzor-web'

if (!process.env.JWT_SECRET && process.env.NODE_ENV === 'production') {
  throw new Error('JWT_SECRET must be set in production')
}

export function signToken(userId, role) {
  return jwt.sign({ sub: userId, role }, SECRET, { expiresIn: EXPIRES_IN, issuer: ISSUER, audience: AUDIENCE })
}

export function verifyToken(token) {
  return jwt.verify(token, SECRET, { issuer: ISSUER, audience: AUDIENCE })
}
