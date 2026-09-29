import 'dotenv/config'
import fs from 'node:fs'
import express from 'express'
import cors from 'cors'
import helmet from 'helmet'
import rateLimit from 'express-rate-limit'
import OpenApiValidator from 'express-openapi-validator'
import { initDatabase, query } from './db.js'
import authRoutes from './routes/auth.js'
import objectsRoutes from './routes/objects.js'
import matrixRoutes from './routes/matrix.js'
import auditRoutes from './routes/audit.js'
import { metricsHandler, metricsMiddleware } from './observability/metrics.js'
import { logger } from './observability/logger.js'
import { closeJobQueue, startAnalysisWorker } from './services/jobQueue.js'
import { requestLogger } from './utils/http.js'

const openapiPath = new URL('../openapi/openapi.json', import.meta.url)
const openapiDocument = JSON.parse(fs.readFileSync(openapiPath, 'utf8'))

function shouldIgnoreOpenApiPath(path) {
  return path === '/metrics'
    || path === '/openapi.json'
    || /^\/api\/objects\/[^/]+\/events$/.test(path)
    || /^\/api\/objects\/[^/]+\/uploads(?:\/[^/]+)?$/.test(path)
    || /^\/api\/objects\/[^/]+\/files\/[^/]+\/content$/.test(path)
}

export function createApp() {
  const app = express()
  const origins = process.env.CORS_ORIGIN ? process.env.CORS_ORIGIN.split(',').map((value) => value.trim()) : true

  app.disable('x-powered-by')
  app.use(helmet())
  app.use(cors({ origin: origins, credentials: true }))
  app.use(express.json({ limit: '2mb' }))
  app.get('/metrics', metricsHandler)
  app.get('/openapi.json', (req, res) => res.json(openapiDocument))
  app.use(requestLogger)
  app.use(metricsMiddleware)
  app.use(rateLimit({ windowMs: 15 * 60 * 1000, limit: 300, standardHeaders: true, legacyHeaders: false }))
  app.use(OpenApiValidator.middleware({
    apiSpec: openapiDocument,
    validateRequests: true,
    validateResponses: true,
    validateSecurity: true,
    ignorePaths: shouldIgnoreOpenApiPath,
  }))

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
    logger.error('Unhandled API error', { error, method: req.method, path: req.originalUrl, status_code: error.status || 500 })
    if (error.code === 'LIMIT_FILE_SIZE') return res.status(413).json({ error: 'Файл больше допустимого лимита 50 МБ' })
    if (error.code === 'LIMIT_FILE_COUNT') return res.status(413).json({ error: 'Можно загрузить не более 10 файлов за раз' })
    if (error.status) {
      return res.status(error.status).json({
        error: error.message || 'Ошибка запроса',
        ...(error.errors ? { code: 'OPENAPI_VALIDATION_ERROR', errors: error.errors } : {}),
      })
    }
    if (error.code === '23505') return res.status(409).json({ error: 'Запись с такими данными уже существует' })
    res.status(500).json({ error: 'Внутренняя ошибка сервера' })
  })
  return app
}

export async function start() {
  await initDatabase()
  const app = createApp()
  const port = Number(process.env.PORT || 4000)
  const server = app.listen(port, () => logger.info('API server listening', { port }))
  let workerRetryTimer = null
  const ensureWorker = async () => {
    try {
      const started = await startAnalysisWorker()
      if (!started && process.env.RABBITMQ_URL) workerRetryTimer = setTimeout(ensureWorker, 5000)
    } catch (error) {
      logger.error('RabbitMQ worker startup failed', { error })
      if (process.env.RABBITMQ_URL) workerRetryTimer = setTimeout(ensureWorker, 5000)
    }
  }
  if (process.env.RABBITMQ_URL) {
    ensureWorker()
  }
  const shutdown = async () => {
    clearTimeout(workerRetryTimer)
    await closeJobQueue()
    server.close(() => process.exit(0))
  }
  process.once('SIGINT', shutdown)
  process.once('SIGTERM', shutdown)
  return server
}

if (process.env.NODE_ENV !== 'test') await start()
