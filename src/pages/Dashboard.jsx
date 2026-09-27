import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useVerification } from '../store/VerificationStore'
import StatusBadge from '../components/StatusBadge'
import Icon from '../components/Icon'
import { formatDateTime } from '../utils/helpers'
import { PROCESS_STATUS, SCENARIOS, OBJECT_STATUS_COLOR } from '../data/constants'

export default function Dashboard() {
  const nav = useNavigate()
  const { objects, objectsLoaded, ensureObjects } = useVerification()
  const [q, setQ] = useState('')
  const [colorFilter, setColorFilter] = useState('ALL')

  useEffect(() => {
    ensureObjects()
  }, [ensureObjects])

  const filtered = objects.filter((r) => {
    const matchesQ =
      !q ||
      String(r.name || '').toLowerCase().includes(q.toLowerCase()) ||
      String(r.address || '').toLowerCase().includes(q.toLowerCase()) ||
      String(r.object_code || '').toLowerCase().includes(q.toLowerCase())
    const matchesColor = colorFilter === 'ALL' || r.color === colorFilter
    return matchesQ && matchesColor
  })

  const totals = {
    objects: objects.length,
      confirmed: objects.reduce((s, r) => s + (r.summary?.confirmed || 0), 0),
      candidates: objects.reduce((s, r) => s + (r.summary?.candidates || 0), 0),
    finalized: objects.filter((r) => r.process_status === 'FINALIZED').length,
  }

  return (
    <div>
      <div className="page-header">
        <div>
          <div className="page-title">Дашборд объектов</div>
          <div className="page-subtitle">
            Камеральная сверка проектной (ПД), рабочей (РД) и исполнительной (ИД) документации по 132 параметрам матрицы контроля
          </div>
        </div>
        <button className="btn btn-primary" onClick={() => nav('/objects/new')}>
          <Icon name="plus" size={14} /> Новый объект
        </button>
      </div>

      <div className="stat-grid">
        <div className="stat-card">
          <div className="stat-icon" style={{ background: 'var(--violet-100)', color: 'var(--violet-700)' }}><Icon name="layers" size={16} /></div>
          <div className="stat-value">{totals.objects}</div>
          <div className="stat-label">Объектов в работе</div>
        </div>
        <div className="stat-card">
          <div className="stat-icon" style={{ background: 'var(--red-bg)', color: 'var(--red)' }}><Icon name="alert" size={16} /></div>
          <div className="stat-value" style={{ color: 'var(--red)' }}>{totals.confirmed}</div>
          <div className="stat-label">Подтверждённых нарушений</div>
        </div>
        <div className="stat-card">
          <div className="stat-icon" style={{ background: 'var(--yellow-bg)', color: 'var(--yellow)' }}><Icon name="clock" size={16} /></div>
          <div className="stat-value" style={{ color: 'var(--yellow)' }}>{totals.candidates}</div>
          <div className="stat-label">Кандидатов ожидают верификации</div>
        </div>
        <div className="stat-card">
          <div className="stat-icon" style={{ background: 'var(--green-bg)', color: 'var(--green)' }}><Icon name="check" size={16} /></div>
          <div className="stat-value" style={{ color: 'var(--green)' }}>{totals.finalized}</div>
          <div className="stat-label">Протоколов финализировано</div>
        </div>
      </div>

      <div className="card card-pad">
        <div className="toolbar">
          <input
            className="input toolbar-search-input"
            placeholder="Поиск по названию, адресу или шифру объекта"
            value={q}
            onChange={(e) => setQ(e.target.value)}
          />
          <select className="select" value={colorFilter} onChange={(e) => setColorFilter(e.target.value)}>
            <option value="ALL">Все статусы</option>
            {Object.entries(OBJECT_STATUS_COLOR).map(([k, v]) => (
              <option key={k} value={k}>{v.label}</option>
            ))}
          </select>
          <div className="hint" style={{ marginLeft: 'auto' }}>
            Показано {filtered.length} из {objects.length}
          </div>
        </div>

        <div className="table-wrap">
          <table className="data-table">
            <thead>
              <tr>
                <th></th>
                <th>Объект</th>
                <th>Сценарий загрузки</th>
                <th>Статус процесса</th>
                <th>Нарушения</th>
                <th>Обновлено</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((r) => (
                <tr key={r.id} className="row-link" onClick={() => nav(`/objects/${r.id}`)}>
                  <td>
                    <span
                      className="dot"
                      style={{ width: 10, height: 10, background: `var(--${r.color === 'purple' ? 'purple-600' : r.color})`, display: 'inline-block' }}
                      title={OBJECT_STATUS_COLOR[r.color].label}
                    />
                  </td>
                  <td>
                    <div style={{ fontWeight: 600 }}>{r.name}</div>
                    <div className="muted" style={{ fontSize: 12 }}>{r.address}</div>
                    <div className="faint mono" style={{ fontSize: 11, marginTop: 2 }}>{r.object_code}</div>
                  </td>
                  <td className="muted" style={{ fontSize: 12.5, maxWidth: 220 }}>
                    {r.scenario ? SCENARIOS[r.scenario] : 'Не определён'}
                  </td>
                  <td>
                    <StatusBadge color={PROCESS_STATUS[r.process_status]?.color}>{PROCESS_STATUS[r.process_status]?.label}</StatusBadge>
                  </td>
                  <td>
                    <div className="status-strip">
                       {(r.summary?.confirmed || 0) > 0 && <StatusBadge color="red">{r.summary.confirmed} подтв.</StatusBadge>}
                       {(r.summary?.candidates || 0) > 0 && <StatusBadge color="yellow">{r.summary.candidates} канд.</StatusBadge>}
                       {(r.summary?.suspicions || 0) > 0 && <StatusBadge color="purple">{r.summary.suspicions} гипот.</StatusBadge>}
                       {(r.summary?.confirmed || 0) === 0 && (r.summary?.candidates || 0) === 0 && (r.summary?.suspicions || 0) === 0 && (
                        <span className="faint" style={{ fontSize: 12 }}>—</span>
                      )}
                    </div>
                  </td>
                  <td className="muted" style={{ fontSize: 12.5 }}>{formatDateTime(r.updated_at)}</td>
                  <td>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 4, justifyContent: 'flex-end' }}>
                      <button
                        className="btn btn-ghost btn-sm"
                        title="Загрузить документы"
                        onClick={(e) => { e.stopPropagation(); nav(`/objects/${r.id}/upload`) }}
                      >
                        <Icon name="upload" size={14} className="faint" />
                      </button>
                      <Icon name="chevronRight" size={16} className="faint" />
                    </div>
                  </td>
                </tr>
              ))}
              {filtered.length === 0 && (
                <tr>
                  <td colSpan={7}>
                    <div className="empty-state">{objectsLoaded ? 'Объекты не найдены' : 'Загрузка объектов…'}</div>
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}
