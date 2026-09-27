import { useEffect } from 'react'
import { Link } from 'react-router-dom'
import { useVerification } from '../store/VerificationStore'
import StatusBadge from '../components/StatusBadge'
import { FINDING_STATUS, REASON_CODES } from '../data/constants'
import { formatDateTime } from '../utils/helpers'

export default function AuditPage() {
  const { getAudit, ensureAudit } = useVerification()

  useEffect(() => {
    ensureAudit()
  }, [ensureAudit])

  const events = getAudit()

  return (
    <div>
      <div className="page-header">
        <div>
          <div className="page-title">Журнал аудита</div>
          <div className="page-subtitle">Действия инспекторов: подтверждение, отклонение, запрос уточнения, финализация протоколов</div>
        </div>
      </div>

      <div className="card">
        <div className="table-wrap">
          <table className="data-table">
            <thead>
              <tr>
                <th>Время</th>
                <th>Объект</th>
                <th>Запись</th>
                <th>Пользователь</th>
                <th>Действие</th>
                <th>Причина</th>
                <th>Комментарий</th>
              </tr>
            </thead>
            <tbody>
              {events.map((e, i) => (
                <tr key={i}>
                  <td className="mono muted" style={{ fontSize: 12, whiteSpace: 'nowrap' }}>{formatDateTime(e.timestamp)}</td>
                  <td>
                    {e.objectId ? <Link className="link-btn" to={`/objects/${e.objectId}`}>{e.objectName}</Link> : <span className="muted">{e.objectName}</span>}
                  </td>
                  <td className="mono faint">{e.findingId || '—'}</td>
                  <td style={{ fontSize: 12.5 }}>{e.user}</td>
                  <td><StatusBadge color={FINDING_STATUS[e.status]?.color || 'green'}>{FINDING_STATUS[e.status]?.label || e.status}</StatusBadge></td>
                  <td className="muted" style={{ fontSize: 12 }}>{e.reason_label || (e.reason_code ? REASON_CODES.find((r) => r.code === e.reason_code)?.label : '—')}</td>
                  <td className="muted" style={{ fontSize: 12.5, maxWidth: 320 }}>{e.comment || '—'}</td>
                </tr>
              ))}
              {events.length === 0 && (
                <tr><td colSpan={7}><div className="empty-state">Записей пока нет — верифицируйте нарушения, чтобы они появились в журнале</div></td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}
