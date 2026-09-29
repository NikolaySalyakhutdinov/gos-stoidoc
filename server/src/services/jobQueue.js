import amqp from 'amqplib'
import { logger } from '../observability/logger.js'
import { queueMessagesTotal } from '../observability/metrics.js'
import { runObjectAnalysis } from './aiPipeline.js'

const queueName = process.env.RABBITMQ_ANALYSIS_QUEUE || 'stroynadzor.analysis'
const rabbitUrl = process.env.RABBITMQ_URL || ''
let connection = null
let channel = null
let connecting = null
let lastConnectionErrorAt = 0
let workerStarted = false
let reconnectTimer = null
let shuttingDown = false

function scheduleWorkerReconnect(force = false) {
  if ((!workerStarted && !force) || shuttingDown || reconnectTimer) return
  reconnectTimer = setTimeout(async () => {
    reconnectTimer = null
    if ((!workerStarted && !force) || shuttingDown) return
    workerStarted = false
    try {
      const started = await startAnalysisWorker()
      if (!started) scheduleWorkerReconnect(true)
    } catch (error) {
      logger.error('RabbitMQ worker reconnect failed', { error })
      scheduleWorkerReconnect(true)
    }
  }, 5000)
}

async function getChannel() {
  if (!rabbitUrl) return null
  if (channel) return channel
  if (connecting) return connecting

  connecting = amqp.connect(rabbitUrl)
    .then(async (nextConnection) => {
      connection = nextConnection
      connection.on('error', (error) => logger.error('RabbitMQ connection error', { error }))
      connection.on('close', () => {
        connection = null
        channel = null
        if (workerStarted && !shuttingDown) {
          scheduleWorkerReconnect()
        }
      })
      const nextChannel = await connection.createChannel()
      await nextChannel.assertQueue(queueName, { durable: true })
      channel = nextChannel
      logger.info('RabbitMQ channel ready', { queue: queueName })
      return channel
    })
    .catch((error) => {
      const now = Date.now()
      if (now - lastConnectionErrorAt > 10_000) {
        logger.warn('RabbitMQ unavailable; direct analysis fallback remains active', { error, queue: queueName })
        lastConnectionErrorAt = now
      }
      connection = null
      channel = null
      return null
    })
    .finally(() => {
      connecting = null
    })
  return connecting
}

export async function enqueueAnalysis(job) {
  const nextChannel = await getChannel()
  if (!nextChannel) return false
  try {
    const published = nextChannel.sendToQueue(queueName, Buffer.from(JSON.stringify(job)), {
      persistent: true,
      contentType: 'application/json',
    })
    queueMessagesTotal.inc({ operation: 'publish', status: published ? 'ok' : 'backpressure' })
    return published
  } catch (error) {
    queueMessagesTotal.inc({ operation: 'publish', status: 'error' })
    logger.error('RabbitMQ publish failed', { error, queue: queueName })
    return false
  }
}

export async function startAnalysisWorker() {
  shuttingDown = false
  if (workerStarted) return true
  const nextChannel = await getChannel()
  if (!nextChannel) return false
  await nextChannel.prefetch(Number(process.env.RABBITMQ_PREFETCH || 1))
  await nextChannel.consume(queueName, async (message) => {
    if (!message) return
    queueMessagesTotal.inc({ operation: 'consume', status: 'received' })
    try {
      const job = JSON.parse(message.content.toString('utf8'))
      await runObjectAnalysis({ objectId: job.objectId, processId: job.processId, audit: job.audit })
      nextChannel.ack(message)
      queueMessagesTotal.inc({ operation: 'consume', status: 'ok' })
    } catch (error) {
      logger.error('RabbitMQ analysis job failed', { error, queue: queueName })
      nextChannel.nack(message, false, false)
      queueMessagesTotal.inc({ operation: 'consume', status: 'error' })
    }
  })
  workerStarted = true
  logger.info('RabbitMQ analysis worker started', { queue: queueName })
  return true
}

export async function closeJobQueue() {
  shuttingDown = true
  workerStarted = false
  clearTimeout(reconnectTimer)
  reconnectTimer = null
  await channel?.close().catch(() => {})
  await connection?.close().catch(() => {})
  channel = null
  connection = null
}
