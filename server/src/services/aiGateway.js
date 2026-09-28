const DEFAULT_AI_URL = 'http://python-ai:8000/process'

export async function processDocumentWithAi({ objectId, processId, file, parameters }) {
  const url = process.env.PYTHON_AI_URL || DEFAULT_AI_URL
  const form = new FormData()
  form.append('object_id', objectId)
  form.append('process_id', processId)
  form.append('stage', file.stage)
  form.append('sha256', file.sha256)
  form.append('queries', JSON.stringify(parameters || []))
  form.append('file', new Blob([file.content], { type: file.mime_type || 'application/octet-stream' }), file.name)

  const response = await fetch(url, {
    method: 'POST',
    body: form,
    signal: AbortSignal.timeout(Number(process.env.PYTHON_AI_TIMEOUT_MS || 15 * 60 * 1000)),
  })
  let payload = null
  try {
    payload = await response.json()
  } catch {
    payload = null
  }
  if (!response.ok || payload?.status === 'FAILED') {
    throw new Error(payload?.error || `Python AI returned HTTP ${response.status}`)
  }
  return payload
}
