const DEFAULT_AI_URL = 'http://python-ai:8000/process'

/**
 * Контракт для будущего Python 3.11-сервиса.
 * Node сначала сохраняет файл в PostgreSQL, затем передаёт копию в Python.
 * Ошибка Python не откатывает загрузку: задача остаётся в process_jobs.
 */
export async function notifyPythonAi({ objectId, processId, file }) {
  const url = process.env.PYTHON_AI_URL || DEFAULT_AI_URL
  const form = new FormData()
  form.append('object_id', objectId)
  form.append('process_id', processId)
  form.append('stage', file.stage)
  form.append('sha256', file.sha256)
  form.append('file', new Blob([file.content], { type: file.mimeType }), file.name)

  const response = await fetch(url, {
    method: 'POST',
    body: form,
    signal: AbortSignal.timeout(Number(process.env.PYTHON_AI_TIMEOUT_MS || 30_000)),
  })

  if (!response.ok) throw new Error(`Python AI returned HTTP ${response.status}`)
  return response.json()
}
