import 'dotenv/config'
import express from 'express'
import cors from 'cors'
import helmet from 'helmet'
import rateLimit from 'express-rate-limit'
import { initDatabase, query } from './db.js'
import authRoutes from './routes/auth.js'
import objectsRoutes from './routes/objects.js'
import matrixRoutes from './routes/matrix.js'
import auditRoutes from './routes/audit.js'

export function createApp() {
  const app = express()
  const origins = process.env.CORS_ORIGIN ? process.env.CORS_ORIGIN.split(',').map((value) => value.trim()) : true

  app.disable('x-powered-by')
  app.use(helmet())
  app.use(cors({ origin: origins, credentials: true }))
  app.use(express.json({ limit: '2mb' }))
  app.use(rateLimit({ windowMs: 15 * 60 * 1000, limit: 300, standardHeaders: true, legacyHeaders: false }))

  app.get('/api/health', async (req, res, next) => {
    try {
      await query('SELECT 1')
      res.json({ ok: true, service: 'stroynadzor-api', database: 'up' })
    } catch (error) {
      next(error)
    }
  })

  app.use('/api/auth', authRoutes)
  app.use('/api/objects', objectsRoutes)
  app.use('/api/matrix', matrixRoutes)
  app.use('/api/audit', auditRoutes)

  app.use((req, res) => res.status(404).json({ error: 'Not found' }))

  app.use((error, req, res, next) => {
    if (res.headersSent) return next(error)
    console.error(error)
    if (error.code === 'LIMIT_FILE_SIZE') return res.status(413).json({ error: 'Файл больше допустимого лимита 50 МБ' })
    if (error.code === 'LIMIT_FILE_COUNT') return res.status(413).json({ error: 'Можно загрузить не более 10 файлов за раз' })
    if (error.status) return res.status(error.status).json({ error: error.message })
    if (error.code === '23505') return res.status(409).json({ error: 'Запись с такими данными уже существует' })
    res.status(500).json({ error: 'Внутренняя ошибка сервера' })
  })
  return app
}

export async function start() {
  await initDatabase()
  const app = createApp()
  const port = Number(process.env.PORT || 4000)
  return app.listen(port, () => console.log(`Стройнадзор ИИ API listening on http://localhost:${port}`))
}

if (process.env.NODE_ENV !== 'test') await start()
