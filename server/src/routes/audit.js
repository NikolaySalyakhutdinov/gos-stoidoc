import { Router } from 'express'
import { query } from '../db.js'
import { requireAuth } from '../middleware/auth.js'
import { asyncHandler } from '../utils/http.js'

const router = Router()

router.get('/', requireAuth, asyncHandler(async (req, res) => {
  const result = await query(`
    SELECT a.*, o.name AS object_name, u.name AS user_name
    FROM audit_logs a
    LEFT JOIN objects o ON o.id = a.object_id
    LEFT JOIN users u ON u.id = a.user_id
    ORDER BY a.created_at DESC
  `)
  res.json({
    events: result.rows.map((row) => ({
      timestamp: row.created_at,
      objectId: row.object_id,
      objectName: row.object_name || row.details?.name || 'Удалённый объект',
      findingId: row.finding_id,
      user: row.user_name || 'Системный пользователь',
      status: row.action,
      action: row.action,
      details: row.details || {},
      reason_code: row.details?.reasonCode || null,
      reason_label: row.details?.reasonLabel || null,
      comment: row.details?.comment || '',
    })),
  })
}))

export default router
