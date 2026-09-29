import client from 'prom-client'

export const registry = new client.Registry()
client.collectDefaultMetrics({ register: registry, prefix: 'stroynadzor_' })

export const httpRequestsTotal = new client.Counter({
  name: 'stroynadzor_http_requests_total',
  help: 'Total HTTP requests handled by the API.',
  labelNames: ['method', 'route', 'status_code'],
  registers: [registry],
})

export const httpRequestDuration = new client.Histogram({
  name: 'stroynadzor_http_request_duration_seconds',
  help: 'HTTP request duration in seconds.',
  labelNames: ['method', 'route', 'status_code'],
  buckets: [0.01, 0.05, 0.1, 0.25, 0.5, 1, 2, 5, 10, 30],
  registers: [registry],
})

export const analysisJobsTotal = new client.Counter({
  name: 'stroynadzor_analysis_jobs_total',
  help: 'Document analysis jobs by final status.',
  labelNames: ['status'],
  registers: [registry],
})

export const analysisDuration = new client.Histogram({
  name: 'stroynadzor_analysis_duration_seconds',
  help: 'Document analysis duration in seconds.',
  labelNames: ['status'],
  buckets: [1, 5, 15, 30, 60, 120, 300, 900, 1800],
  registers: [registry],
})

export const suspicionHypothesesTotal = new client.Counter({
  name: 'stroynadzor_suspicion_hypotheses_total',
  help: 'Automatically generated SUSPICION hypotheses.',
  labelNames: ['discovery_method'],
  registers: [registry],
})

export const queueMessagesTotal = new client.Counter({
  name: 'stroynadzor_queue_messages_total',
  help: 'RabbitMQ messages published or consumed by the API.',
  labelNames: ['operation', 'status'],
  registers: [registry],
})

function routeName(req) {
  if (req.route?.path) return `${req.baseUrl || ''}${req.route.path}`
  return req.path.replace(/\/[A-Za-z0-9_-]{12,}/g, '/:id') || '/'
}

export function metricsMiddleware(req, res, next) {
  const started = process.hrtime.bigint()
  res.on('finish', () => {
    const seconds = Number(process.hrtime.bigint() - started) / 1e9
    const labels = { method: req.method, route: routeName(req), status_code: String(res.statusCode) }
    httpRequestsTotal.inc(labels)
    httpRequestDuration.observe(labels, seconds)
  })
  next()
}

export async function metricsHandler(req, res) {
  res.setHeader('Content-Type', registry.contentType)
  res.end(await registry.metrics())
}

export function recordAnalysis(status, seconds) {
  analysisJobsTotal.inc({ status })
  analysisDuration.observe({ status }, seconds)
}

export function recordSuspicions(items) {
  for (const item of items) suspicionHypothesesTotal.inc({ discovery_method: item.discovery_method })
}
