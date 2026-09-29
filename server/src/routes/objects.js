import { Router } from 'express'
import multer from 'multer'
import { createHash, randomUUID } from 'node:crypto'
import { query, withTransaction } from '../db.js'
import { requireAuth } from '../middleware/auth.js'
import { asyncHandler, recordAudit } from '../utils/http.js'
import { normalizeFilename } from '../utils/filename.js'
import { runObjectAnalysis } from '../services/aiPipeline.js'
import { serializeObject, serializeFinding, findingsSummary, objectColor } from '../utils/serialize.js'

const router = Router()
router.use(requireAuth)

const REASON_CODES = ['WRONG_REVISION', 'APPROVED_CHANGE', 'OCR_ERROR', 'LINK_ERROR', 'NOT_APPLICABLE_PARAM', 'OTHER']
const DECISION_STATUSES = ['CONFIRMED_VIOLATION', 'NEGATIVE_VERIFIED', 'CLARIFICATION_REQUIRED', 'CANDIDATE', 'NOT_APPLICABLE']
const PROCESS_STATUSES = ['PENDING', 'PARSING', 'READY', 'VERIFYING', 'COMPLETED', 'FINALIZED', 'FAILED']
const DOCUMENT_STAGES = ['PD', 'RD', 'ID']
const DELETE_REASONS = {
  DUPLICATE_OBJECT: 'Дубликат объекта',
  TEST_OBJECT: 'Тестовый объект',
  WRONG_DATA: 'Ошибка в данных объекта',
  PROJECT_CANCELLED: 'Объект больше не ведётся',
  OTHER: 'Другое',
}
const MAX_FILE_SIZE = 50 * 1024 * 1024
const MAX_BATCH_SIZE = 200 * 1024 * 1024
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_FILE_SIZE, files: 10 },
})

async function getFindingContext(objectId) {
  const [filesResult, fragmentsResult] = await Promise.all([
    query('SELECT id, stage, name, mime_type, size, sha256, page_count FROM files WHERE object_id = $1', [objectId]),
    query('SELECT file_id, page, text, bbox FROM evidence_fragments WHERE object_id = $1 ORDER BY created_at ASC', [objectId]),
  ])
  const filesById = new Map(filesResult.rows.map((file) => [file.id, file]))
  const fragmentsByFile = new Map()
  for (const fragment of fragmentsResult.rows) {
    const list = fragmentsByFile.get(fragment.file_id) || []
    list.push(fragment)
    fragmentsByFile.set(fragment.file_id, list)
  }
  return { filesById, fragmentsByFile }
}

async function getFindings(objectId) {
  const [result, context] = await Promise.all([
    query('SELECT * FROM findings WHERE object_id = $1 ORDER BY created_at ASC', [objectId]),
    getFindingContext(objectId),
  ])
  return result.rows.map((row) => serializeFinding(row, context.filesById, context.fragmentsByFile))
}

async function serializeUpdatedFinding(row, objectId) {
  const context = await getFindingContext(objectId)
  return serializeFinding(row, context.filesById, context.fragmentsByFile)
}

async function getObject(objectId) {
  const result = await query('SELECT * FROM objects WHERE id = $1', [objectId])
  return result.rows[0]
}

async function serializeObjectWithSummary(row) {
  const findings = await getFindings(row.id)
  const summary = findingsSummary(findings)
  return { ...serializeObject(row), summary, color: objectColor(row.process_status, summary) }
}

router.get('/', asyncHandler(async (req, res) => {
  const result = await query('SELECT * FROM objects ORDER BY updated_at DESC')
  const objects = await Promise.all(result.rows.map(serializeObjectWithSummary))
  res.json({ objects })
}))

router.post('/', asyncHandler(async (req, res) => {
  const { name, address, object_code, customer, contractor, permit_number } = req.body || {}
  if (!name || !String(name).trim()) return res.status(400).json({ error: 'Укажите наименование объекта' })
  if (!address || !String(address).trim()) return res.status(400).json({ error: 'Укажите адрес объекта' })
  if (!object_code || !String(object_code).trim()) return res.status(400).json({ error: 'Укажите шифр объекта' })
  if (!customer || !String(customer).trim()) return res.status(400).json({ error: 'Укажите застройщика / заказчика' })
  if (!contractor || !String(contractor).trim()) return res.status(400).json({ error: 'Укажите подрядчика' })
  if (!permit_number || !String(permit_number).trim()) return res.status(400).json({ error: 'Укажите номер разрешения на строительство' })

  const id = `obj-${randomUUID().slice(0, 8)}`
  const row = await withTransaction(async (client) => {
    const inserted = await client.query(
      `INSERT INTO objects (id, name, address, customer, contractor, permit_number, object_code)
       VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *`,
      [id, String(name).trim(), String(address).trim(), String(customer || '').trim(), String(contractor || '').trim(), String(permit_number || '').trim(), String(object_code).trim()],
    )
    await recordAudit(client, { req, objectId: id, action: 'OBJECT_CREATED', details: { name: inserted.rows[0].name, objectCode: inserted.rows[0].object_code } })
    return inserted.rows[0]
  })
  res.status(201).json({ object: await serializeObjectWithSummary(row) })
}))

router.get('/:id', asyncHandler(async (req, res) => {
  const row = await getObject(req.params.id)
  if (!row) return res.status(404).json({ error: 'Объект не найден' })
  res.json({ object: await serializeObjectWithSummary(row) })
}))

router.delete('/:id', asyncHandler(async (req, res) => {
  const { reasonCode, comment } = req.body || {}
  const reasonLabel = DELETE_REASONS[reasonCode]
  if (!reasonLabel) return res.status(400).json({ error: 'Выберите причину удаления объекта' })
  if (String(comment || '').length > 2000) return res.status(400).json({ error: 'Комментарий не должен превышать 2000 символов' })
  if (reasonCode === 'OTHER' && !String(comment || '').trim()) return res.status(400).json({ error: 'Для причины «Другое» укажите комментарий' })
  const row = await getObject(req.params.id)
  if (!row) return res.status(404).json({ error: 'Объект не найден' })

  await withTransaction(async (client) => {
    await recordAudit(client, {
      req,
      objectId: row.id,
      action: 'OBJECT_DELETED',
      details: {
        name: row.name,
        address: row.address,
        objectCode: row.object_code,
        reasonCode,
        reasonLabel,
        comment: String(comment || '').trim(),
      },
    })
    await client.query('DELETE FROM objects WHERE id = $1', [row.id])
  })
  res.json({ ok: true, id: row.id })
}))

router.patch('/:id/status', asyncHandler(async (req, res) => {
  const { status } = req.body || {}
  if (!PROCESS_STATUSES.includes(status)) return res.status(400).json({ error: 'Некорректный статус процесса' })
  const row = await getObject(req.params.id)
  if (!row) return res.status(404).json({ error: 'Объект не найден' })
  let processId = null
  if (status === 'PARSING') {
    const files = await query('SELECT COUNT(*)::int AS count FROM files WHERE object_id = $1', [row.id])
    if (files.rows[0].count === 0) {
      return res.status(400).json({ error: 'Нельзя запустить проверку: сначала загрузите хотя бы один документ', code: 'DOCUMENTS_REQUIRED' })
    }
    const active = await query(`SELECT process_id FROM analysis_processes WHERE object_id = $1 AND status NOT IN ('COMPLETED', 'FINALIZED', 'FAILED') ORDER BY created_at DESC LIMIT 1`, [row.id])
    processId = active.rows[0]?.process_id || randomUUID()
  }
  const finalizedAt = status === 'FINALIZED' ? new Date() : status === 'COMPLETED' ? null : row.finalized_at
  const result = await withTransaction(async (client) => {
    if (status === 'PARSING' && !row.process_status?.includes('PARSING')) {
      const existing = await client.query('SELECT process_id FROM analysis_processes WHERE process_id = $1', [processId])
      if (!existing.rows[0]) {
        await client.query('INSERT INTO analysis_processes (process_id, object_id) VALUES ($1, $2)', [processId, row.id])
      }
    }
    const updated = await client.query(
      `UPDATE objects SET process_status = $1, process_error = NULL, process_progress = CASE WHEN $1 = 'PARSING' THEN 0 ELSE process_progress END,
       process_step = CASE WHEN $1 = 'PARSING' THEN 'Ожидание AI-сервиса' ELSE process_step END,
       updated_at = NOW(), finalized_at = $2 WHERE id = $3 RETURNING *`,
      [status, finalizedAt, row.id],
    )
    if (status === 'PARSING') {
      await client.query(`UPDATE analysis_processes SET status = 'PENDING', current_step = 'Ожидание AI-сервиса', progress = 0, error = NULL, updated_at = NOW() WHERE process_id = $1`, [processId])
    }
    await recordAudit(client, { req, objectId: row.id, action: status === 'FINALIZED' ? 'PROTOCOL_FINALIZED' : 'PROCESS_STATUS_CHANGED', details: { status } })
    return updated.rows[0]
  })
  if (status === 'PARSING') {
    setImmediate(() => runObjectAnalysis({ objectId: row.id, processId, req }))
  }
  res.json({ object: await serializeObjectWithSummary(result) })
}))

router.get('/:id/completeness', asyncHandler(async (req, res) => {
  const result = await query('SELECT * FROM completeness WHERE object_id = $1 ORDER BY section ASC', [req.params.id])
  res.json({ completeness: result.rows.map((r) => ({ section: r.section, pd: r.pd_status, rd: r.rd_status, id: r.id_status, note: r.note })) })
}))

router.get('/:id/findings', asyncHandler(async (req, res) => {
  res.json({ findings: await getFindings(req.params.id) })
}))

router.get('/:id/files/:fileId/content', asyncHandler(async (req, res) => {
  const result = await query(
    'SELECT name, mime_type, size, content FROM files WHERE id = $1 AND object_id = $2',
    [req.params.fileId, req.params.id],
  )
  const file = result.rows[0]
  if (!file) return res.status(404).json({ error: 'Файл не найден' })

  const fileName = normalizeFilename(file.name) || 'document'
  const encodedFileName = encodeURIComponent(fileName).replace(/'/g, '%27')
  res.setHeader('Content-Type', file.mime_type || 'application/octet-stream')
  res.setHeader('Content-Length', String(file.size))
  res.setHeader('Content-Disposition', `inline; filename*=UTF-8''${encodedFileName}`)
  res.send(file.content)
}))

router.post('/:id/findings/:findingId/decide', asyncHandler(async (req, res) => {
  const { status, reason_code, comment } = req.body || {}
  if (!DECISION_STATUSES.includes(status)) return res.status(400).json({ error: 'Некорректный статус решения' })
  if (reason_code && !REASON_CODES.includes(reason_code)) return res.status(400).json({ error: 'Некорректный код причины' })
  const result = await query('SELECT * FROM findings WHERE finding_id = $1 AND object_id = $2', [req.params.findingId, req.params.id])
  const finding = result.rows[0]
  if (!finding) return res.status(404).json({ error: 'Запись не найдена' })

  const verification = { decision: status, status, reason_code: reason_code || null, comment: comment || '', user: req.user.name, timestamp: new Date().toISOString() }
  const updated = await withTransaction(async (client) => {
    const next = await client.query('UPDATE findings SET status = $1, verification = $2::jsonb, updated_at = NOW() WHERE finding_id = $3 RETURNING *', [status, JSON.stringify(verification), finding.finding_id])
    await recordAudit(client, { req, objectId: req.params.id, findingId: finding.finding_id, action: 'FINDING_DECIDED', details: { status, reasonCode: reason_code || null, comment: comment || '' } })
    return next.rows[0]
  })
  res.json({ finding: await serializeUpdatedFinding(updated, req.params.id) })
}))

router.post('/:id/findings/:findingId/undo', asyncHandler(async (req, res) => {
  const result = await query('SELECT * FROM findings WHERE finding_id = $1 AND object_id = $2', [req.params.findingId, req.params.id])
  const finding = result.rows[0]
  if (!finding) return res.status(404).json({ error: 'Запись не найдена' })
  const resetStatus = finding.matrix_code ? 'CANDIDATE' : 'SUSPICION'
  const updated = await withTransaction(async (client) => {
    const next = await client.query('UPDATE findings SET status = $1, verification = NULL, updated_at = NOW() WHERE finding_id = $2 RETURNING *', [resetStatus, finding.finding_id])
    await recordAudit(client, { req, objectId: req.params.id, findingId: finding.finding_id, action: 'FINDING_UNDO', details: { status: resetStatus } })
    return next.rows[0]
  })
  res.json({ finding: await serializeUpdatedFinding(updated, req.params.id) })
}))

router.get('/:id/uploads', asyncHandler(async (req, res) => {
  const result = await query('SELECT id, stage, name, size, uploaded_at FROM files WHERE object_id = $1 ORDER BY uploaded_at ASC', [req.params.id])
  const uploads = { PD: [], RD: [], ID: [] }
  for (const row of result.rows) uploads[row.stage]?.push({ id: row.id, name: normalizeFilename(row.name), size: Number(row.size), uploaded_at: row.uploaded_at })
  res.json({ uploads })
}))

router.post('/:id/uploads/:stage', upload.array('files', 10), asyncHandler(async (req, res) => {
  const stage = req.params.stage
  if (!DOCUMENT_STAGES.includes(stage)) return res.status(400).json({ error: 'Некорректная стадия документа' })
  if (!req.files?.length) return res.status(400).json({ error: 'Не переданы файлы' })

  const object = await getObject(req.params.id)
  if (!object) return res.status(404).json({ error: 'Объект не найден' })
  if (object.process_status === 'FINALIZED') return res.status(409).json({ error: 'В финализированный протокол нельзя загружать документы' })

  const allowedExtensions = new Set(['.pdf', '.docx', '.xml'])
  const normalizedFiles = req.files.map((file) => {
    const name = normalizeFilename(file.originalname)
    const dot = name.lastIndexOf('.')
    const extension = dot >= 0 ? name.slice(dot).toLowerCase() : ''
    if (!allowedExtensions.has(extension)) throw Object.assign(new Error(`Файл «${name}» имеет неподдерживаемый формат`), { status: 400 })
    return {
      id: randomUUID(),
      name,
      mimeType: file.mimetype || 'application/octet-stream',
      size: file.size,
      sha256: createHash('sha256').update(file.buffer).digest('hex'),
      content: file.buffer,
      stage,
    }
  })
  const batchSize = normalizedFiles.reduce((sum, file) => sum + file.size, 0)
  if (batchSize > MAX_BATCH_SIZE) return res.status(413).json({ error: 'Общий размер пакета не должен превышать 200 МБ' })

  const saved = await withTransaction(async (client) => {
    const total = await client.query('SELECT COALESCE(SUM(size), 0) AS total FROM files WHERE object_id = $1', [object.id])
    if (Number(total.rows[0].total) + batchSize > MAX_BATCH_SIZE) {
      throw Object.assign(new Error('Общий размер документов объекта не должен превышать 200 МБ'), { status: 413 })
    }

    let process = (await client.query(`SELECT * FROM analysis_processes WHERE object_id = $1 AND status NOT IN ('COMPLETED', 'FINALIZED') ORDER BY created_at DESC LIMIT 1`, [object.id])).rows[0]
    if (!process) {
      process = (await client.query('INSERT INTO analysis_processes (process_id, object_id) VALUES ($1, $2) RETURNING *', [randomUUID(), object.id])).rows[0]
    }

    const uploaded = []
    for (const file of normalizedFiles) {
      await client.query(
        `INSERT INTO files (id, object_id, stage, name, mime_type, size, sha256, content)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
        [file.id, object.id, stage, file.name, file.mimeType, file.size, file.sha256, file.content],
      )
      await client.query('INSERT INTO process_jobs (job_id, process_id, file_id) VALUES ($1, $2, $3)', [randomUUID(), process.process_id, file.id])
      await recordAudit(client, { req, objectId: object.id, action: 'DOCUMENT_UPLOADED', details: { fileId: file.id, fileName: file.name, stage, size: file.size, sha256: file.sha256 } })
      uploaded.push({ ...file, processId: process.process_id })
    }
    const column = stage === 'PD' ? 'pd_status' : stage === 'RD' ? 'rd_status' : 'id_status'
    await client.query(`UPDATE objects SET ${column} = 'UPLOADED', updated_at = NOW() WHERE id = $1`, [object.id])
    return uploaded
  })

  res.status(201).json({ uploaded: saved.map(({ id, name, size }) => ({ id, name, size, uploaded_at: new Date().toISOString() })), process_id: saved[0].processId })
}))

router.delete('/:id/uploads/:stage/:fileId', asyncHandler(async (req, res) => {
  const stage = req.params.stage
  if (!DOCUMENT_STAGES.includes(stage)) return res.status(400).json({ error: 'Некорректная стадия документа' })
  const column = stage === 'PD' ? 'pd_status' : stage === 'RD' ? 'rd_status' : 'id_status'

  const result = await withTransaction(async (client) => {
    const deleted = await client.query('DELETE FROM files WHERE id = $1 AND object_id = $2 AND stage = $3 RETURNING id, name, stage', [req.params.fileId, req.params.id, stage])
    if (!deleted.rows[0]) return null
    await recordAudit(client, { req, objectId: req.params.id, action: 'DOCUMENT_DELETED', details: deleted.rows[0] })

    const remaining = await client.query(
      'SELECT EXISTS (SELECT 1 FROM files WHERE object_id = $1 AND stage = $2) AS has_files',
      [req.params.id, stage],
    )
    const nextStatus = remaining.rows[0].has_files ? 'UPLOADED' : 'MISSING'
    await client.query(
      `UPDATE objects SET ${column} = $1, updated_at = NOW() WHERE id = $2`,
      [nextStatus, req.params.id],
    )

    return deleted.rows[0]
  })
  if (!result) return res.status(404).json({ error: 'Файл не найден' })
  res.json({ ok: true })
}))

export default router
