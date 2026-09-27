import { Router } from 'express'
import { query } from '../db.js'
import { requireAuth, requireRole } from '../middleware/auth.js'
import { asyncHandler, recordAudit } from '../utils/http.js'
import { withTransaction } from '../db.js'

const router = Router()

router.get('/', requireAuth, asyncHandler(async (req, res) => {
  const result = await query('SELECT * FROM matrix_params ORDER BY id ASC')
  res.json({
    matrix: result.rows.map((row) => ({
      id: row.id,
      code: row.code,
      section: row.section,
      parameter: row.parameter,
      unit: row.unit,
      source_pd: row.source_pd,
      source_rd: row.source_rd,
      source_id: row.source_id,
      trigger: row.trigger_text,
      priority: row.priority,
    })),
  })
}))

router.post('/', requireAuth, requireRole('ADMIN'), asyncHandler(async (req, res) => {
  const { code, section, parameter, unit, source_pd, source_rd, source_id, trigger, priority } = req.body || {}
  if (!String(code || '').trim()) return res.status(400).json({ error: 'Укажите код параметра' })
  if (!String(section || '').trim()) return res.status(400).json({ error: 'Укажите раздел параметра' })
  if (!String(parameter || '').trim()) return res.status(400).json({ error: 'Укажите название параметра' })
  if (!String(trigger || '').trim()) return res.status(400).json({ error: 'Укажите условие срабатывания' })

  try {
    const row = await withTransaction(async (client) => {
      const nextId = await client.query('SELECT COALESCE(MAX(id), 0) + 1 AS id FROM matrix_params')
      const inserted = await client.query(
        `INSERT INTO matrix_params (id, code, section, parameter, unit, source_pd, source_rd, source_id, trigger_text, priority)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) RETURNING *`,
        [Number(nextId.rows[0].id), String(code).trim(), String(section).trim(), String(parameter).trim(), String(unit || '').trim() || null, String(source_pd || '').trim() || null, String(source_rd || '').trim() || null, String(source_id || '').trim() || null, String(trigger).trim(), String(priority || 'LOW').trim()],
      )
      await recordAudit(client, { req, action: 'MATRIX_PARAMETER_CREATED', details: { id: inserted.rows[0].id, code: inserted.rows[0].code } })
      return inserted.rows[0]
    })
    return res.status(201).json({ parameter: serializeParameter(row) })
  } catch (error) {
    if (error.code === '23505') return res.status(409).json({ error: 'Параметр с таким кодом уже существует' })
    throw error
  }
}))

router.delete('/:id', requireAuth, requireRole('ADMIN'), asyncHandler(async (req, res) => {
  const result = await withTransaction(async (client) => {
    const deleted = await client.query('DELETE FROM matrix_params WHERE id = $1 RETURNING *', [Number(req.params.id)])
    if (!deleted.rows[0]) return null
    await recordAudit(client, { req, action: 'MATRIX_PARAMETER_DELETED', details: { id: deleted.rows[0].id, code: deleted.rows[0].code, parameter: deleted.rows[0].parameter } })
    return deleted.rows[0]
  })
  if (!result) return res.status(404).json({ error: 'Параметр не найден' })
  res.json({ ok: true, id: result.id })
}))

function serializeParameter(row) {
  return {
    id: row.id,
    code: row.code,
    section: row.section,
    parameter: row.parameter,
    unit: row.unit,
    source_pd: row.source_pd,
    source_rd: row.source_rd,
    source_id: row.source_id,
    trigger: row.trigger_text,
    priority: row.priority,
  }
}

export default router
