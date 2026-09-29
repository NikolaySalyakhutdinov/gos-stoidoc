import undici from 'undici'
import { File } from 'node:buffer'
import { normalizeFilename } from '../utils/filename.js'
import { logger } from '../observability/logger.js'

const { Agent, fetch, FormData } = undici

const DEFAULT_AI_URL = 'http://python-ai:8000/process'

const AI_TIMEOUT_MS = Number(
    process.env.PYTHON_AI_TIMEOUT_MS || 30 * 60 * 1000
)

const aiDispatcher = new Agent({
  connectTimeout: 60_000,
  headersTimeout: AI_TIMEOUT_MS,
  bodyTimeout: AI_TIMEOUT_MS,
})

export async function processDocumentWithAi({
                                              objectId,
                                              processId,
                                              file,
                                              parameters,
                                            }) {
  const url = process.env.PYTHON_AI_URL || DEFAULT_AI_URL

  const form = new FormData()
  const fileName = normalizeFilename(file.name)

  form.append('object_id', objectId)
  form.append('process_id', processId)
  form.append('stage', file.stage)
  form.append('sha256', file.sha256)
  form.append('queries', JSON.stringify(parameters || []))

  const uploadedFile = new File(
      [file.content],
      fileName,
      {
        type: file.mime_type || 'application/octet-stream',
      }
  )

  form.append('file', uploadedFile)

  logger.info('AI request started', { stage: file.stage, file: fileName, timeout_ms: AI_TIMEOUT_MS })

  try {
    const response = await fetch(url, {
      method: 'POST',
      body: form,
      dispatcher: aiDispatcher,
      signal: AbortSignal.timeout(AI_TIMEOUT_MS),
    })

    logger.info('AI response received', { stage: file.stage, file: fileName, status_code: response.status })

    let payload = null

    try {
      payload = await response.json()
    } catch (error) {
      logger.error('Failed to parse Python AI response', { error })
    }

    if (!response.ok || payload?.status === 'FAILED') {
      throw new Error(
          payload?.error ||
          `Python AI returned HTTP ${response.status}`
      )
    }

    return payload
  } catch (error) {
    logger.error('Python AI request failed', {
      error,
      name: error?.name,
      cause_code: error?.cause?.code,
      cause_message: error?.cause?.message,
    })

    throw error
  }
}
