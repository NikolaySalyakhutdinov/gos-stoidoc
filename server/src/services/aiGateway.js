import undici from 'undici'
import { File } from 'node:buffer'

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

  form.append('object_id', objectId)
  form.append('process_id', processId)
  form.append('stage', file.stage)
  form.append('sha256', file.sha256)
  form.append('queries', JSON.stringify(parameters || []))

  const uploadedFile = new File(
      [file.content],
      file.name,
      {
        type: file.mime_type || 'application/octet-stream',
      }
  )

  form.append('file', uploadedFile)

  console.log(
      `AI request started: stage=${file.stage}, file=${file.name}, timeout=${AI_TIMEOUT_MS}ms`
  )

  try {
    const response = await fetch(url, {
      method: 'POST',
      body: form,
      dispatcher: aiDispatcher,
      signal: AbortSignal.timeout(AI_TIMEOUT_MS),
    })

    console.log(
        `AI response received: stage=${file.stage}, file=${file.name}, HTTP=${response.status}`
    )

    let payload = null

    try {
      payload = await response.json()
    } catch (error) {
      console.error('Failed to parse Python AI response:', error)
    }

    if (!response.ok || payload?.status === 'FAILED') {
      throw new Error(
          payload?.error ||
          `Python AI returned HTTP ${response.status}`
      )
    }

    return payload
  } catch (error) {
    console.error('Python AI request failed:', {
      name: error?.name,
      message: error?.message,
      causeCode: error?.cause?.code,
      causeMessage: error?.cause?.message,
    })

    throw error
  }
}