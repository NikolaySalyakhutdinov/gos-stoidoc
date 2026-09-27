import { Fragment, useEffect, useMemo, useState } from 'react'
import { apiFetch } from '../api/client'
import StatusBadge from '../components/StatusBadge'
import Icon from '../components/Icon'
import { useAuth } from '../store/AuthStore'

function priorityColor(p) {
  if (p?.startsWith('HIGH')) return 'red'
  if (p?.startsWith('MEDIUM')) return 'yellow'
  return 'grey'
}
function priorityLabel(p) {
  if (p?.startsWith('HIGH')) return 'HIGH'
  if (p?.startsWith('MEDIUM')) return 'MEDIUM'
  return p || '—'
}

export default function MatrixPage() {
  const { currentUser } = useAuth()
  const isAdmin = currentUser?.role === 'ADMIN'
  const [matrix, setMatrix] = useState([])
  const [loaded, setLoaded] = useState(false)
  const [q, setQ] = useState('')
  const [section, setSection] = useState('ALL')
  const [priority, setPriority] = useState('ALL')
  const [openId, setOpenId] = useState(null)
  const [formOpen, setFormOpen] = useState(false)
  const [form, setForm] = useState({ code: '', section: '', parameter: '', unit: '', source_pd: '', source_rd: '', source_id: '', trigger: '', priority: 'LOW' })
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)
  const [deletingId, setDeletingId] = useState(null)

  useEffect(() => {
    apiFetch('/api/matrix')
      .then((data) => setMatrix(data.matrix))
      .finally(() => setLoaded(true))
  }, [])

  function updateField(field, value) {
    setForm((current) => ({ ...current, [field]: value }))
  }

  async function addParameter(event) {
    event.preventDefault()
    setError('')
    setSaving(true)
    try {
      const data = await apiFetch('/api/matrix', { method: 'POST', body: form })
      setMatrix((current) => [...current, data.parameter].sort((a, b) => a.id - b.id))
      setForm({ code: '', section: '', parameter: '', unit: '', source_pd: '', source_rd: '', source_id: '', trigger: '', priority: 'LOW' })
      setFormOpen(false)
    } catch (requestError) {
      setError(requestError.message || 'Не удалось добавить параметр')
    } finally {
      setSaving(false)
    }
  }

  async function deleteParameter(parameter) {
    if (!window.confirm(`Удалить параметр «${parameter.code} — ${parameter.parameter}»?`)) return
    setError('')
    setDeletingId(parameter.id)
    try {
      await apiFetch(`/api/matrix/${parameter.id}`, { method: 'DELETE' })
      setMatrix((current) => current.filter((item) => item.id !== parameter.id))
      setOpenId(null)
    } catch (requestError) {
      setError(requestError.message || 'Не удалось удалить параметр')
    } finally {
      setDeletingId(null)
    }
  }

  const SECTIONS = useMemo(() => Array.from(new Set(matrix.map((m) => m.section))).sort(), [matrix])

  const rows = useMemo(() => {
    return matrix.filter((m) => {
      const matchesQ =
        !q ||
        m.parameter?.toLowerCase().includes(q.toLowerCase()) ||
        m.code?.toLowerCase().includes(q.toLowerCase()) ||
        m.trigger?.toLowerCase().includes(q.toLowerCase())
      const matchesSection = section === 'ALL' || m.section === section
      const matchesPriority = priority === 'ALL' || priorityLabel(m.priority) === priority
      return matchesQ && matchesSection && matchesPriority
    })
  }, [matrix, q, section, priority])

  return (
    <div>
      <div className="page-header">
        <div>
          <div className="page-title">Матрица контроля</div>
          <div className="page-subtitle">{matrix.length} контролируемых параметров сверки ПД / РД / ИД, версия v1.1</div>
        </div>
        {isAdmin && (
          <button className="btn btn-primary" onClick={() => { setFormOpen((open) => !open); setError('') }}>
            <Icon name="plus" size={14} /> {formOpen ? 'Скрыть форму' : 'Добавить параметр'}
          </button>
        )}
      </div>

      {formOpen && (
        <div className="card card-pad" style={{ marginBottom: 18 }}>
          <div style={{ fontWeight: 700, marginBottom: 12 }}>Новый параметр матрицы</div>
          <form onSubmit={addParameter}>
            <div className="form-row">
              <Field label="Код" value={form.code} onChange={(value) => updateField('code', value)} placeholder="M-133" required />
              <Field label="Раздел" value={form.section} onChange={(value) => updateField('section', value)} placeholder="Раздел 13. ..." required />
            </div>
            <Field label="Параметр" value={form.parameter} onChange={(value) => updateField('parameter', value)} placeholder="Название контролируемого параметра" required />
            <div className="form-row">
              <Field label="Единица измерения" value={form.unit} onChange={(value) => updateField('unit', value)} placeholder="м², мм, %" />
              <label className="form-group">
                <span className="form-label">Приоритет</span>
                <select className="select" style={{ width: '100%' }} value={form.priority} onChange={(event) => updateField('priority', event.target.value)}>
                  <option value="HIGH">HIGH — обязательная экспертная проверка</option>
                  <option value="MEDIUM">MEDIUM — экспертная проверка</option>
                  <option value="LOW">LOW</option>
                </select>
              </label>
            </div>
            <Field label="Триггер" value={form.trigger} onChange={(value) => updateField('trigger', value)} placeholder="Условие срабатывания проверки" required />
            <div className="form-row">
              <Field label="Источник в ПД" value={form.source_pd} onChange={(value) => updateField('source_pd', value)} />
              <Field label="Источник в РД" value={form.source_rd} onChange={(value) => updateField('source_rd', value)} />
              <Field label="Источник в ИД" value={form.source_id} onChange={(value) => updateField('source_id', value)} />
            </div>
            {error && <div className="form-error" role="alert"><Icon name="alert" size={13} /> {error}</div>}
            <button className="btn btn-primary" type="submit" disabled={saving}>
              <Icon name="plus" size={14} /> {saving ? 'Добавление…' : 'Добавить параметр'}
            </button>
          </form>
        </div>
      )}

      {error && !formOpen && <div className="form-error" role="alert" style={{ marginBottom: 14 }}><Icon name="alert" size={13} /> {error}</div>}

      <div className="card card-pad">
        <div className="toolbar">
          <input
            className="input toolbar-search-input"
            placeholder="Поиск по коду, параметру или триггеру"
            value={q}
            onChange={(e) => setQ(e.target.value)}
          />
          <select className="select" value={section} onChange={(e) => setSection(e.target.value)}>
            <option value="ALL">Все разделы</option>
            {SECTIONS.map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
          <select className="select" value={priority} onChange={(e) => setPriority(e.target.value)}>
            <option value="ALL">Все приоритеты</option>
            <option value="HIGH">HIGH</option>
            <option value="MEDIUM">MEDIUM</option>
            <option value="LOW">LOW</option>
          </select>
          <div className="hint" style={{ marginLeft: 'auto' }}>Показано {rows.length} из {matrix.length}</div>
        </div>

        <div className="table-wrap">
          <table className="data-table">
            <thead>
              <tr>
                <th>Код</th>
                <th>Раздел</th>
                <th>Параметр</th>
                <th>Ед. изм.</th>
                <th>Триггер</th>
                <th>Приоритет</th>
                {isAdmin && <th>Действия</th>}
              </tr>
            </thead>
            <tbody>
              {rows.map((m) => (
                <Fragment key={m.id}>
                  <tr className="row-link" onClick={() => setOpenId(openId === m.id ? null : m.id)}>
                    <td className="mono" style={{ fontWeight: 700 }}>{m.code}</td>
                    <td className="muted" style={{ fontSize: 12.5, whiteSpace: 'nowrap' }}>{m.section?.replace(/^Раздел \d+\.\s*/, '')}</td>
                    <td style={{ maxWidth: 320, fontWeight: 600 }}>{m.parameter}</td>
                    <td className="muted">{m.unit}</td>
                    <td className="muted" style={{ fontSize: 12.5, maxWidth: 280 }}>{m.trigger}</td>
                    <td><StatusBadge color={priorityColor(m.priority)}>{priorityLabel(m.priority)}</StatusBadge></td>
                    {isAdmin && (
                      <td>
                        <button className="btn btn-danger btn-sm" onClick={(event) => { event.stopPropagation(); deleteParameter(m) }} disabled={deletingId === m.id}>
                          <Icon name="trash" size={13} /> {deletingId === m.id ? 'Удаление…' : 'Удалить'}
                        </button>
                      </td>
                    )}
                  </tr>
                  {openId === m.id && (
                    <tr>
                      <td colSpan={isAdmin ? 7 : 6} style={{ background: 'var(--surface-alt)' }}>
                        <div className="grid-3" style={{ padding: '6px 4px' }}>
                          <SourceBlock label="Источник в ПД" text={m.source_pd} />
                          <SourceBlock label="Источник в РД" text={m.source_rd} />
                          <SourceBlock label="Источник в ИД" text={m.source_id} />
                        </div>
                      </td>
                    </tr>
                  )}
                </Fragment>
              ))}
              {rows.length === 0 && (
                <tr><td colSpan={isAdmin ? 7 : 6}><div className="empty-state">{loaded ? 'Параметры не найдены' : 'Загрузка матрицы…'}</div></td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}

function Field({ label, value, onChange, placeholder, required = false }) {
  return (
    <label className="form-group">
      <span className="form-label">{label}{required ? ' *' : ''}</span>
      <input className="input" style={{ width: '100%' }} value={value} placeholder={placeholder} required={required} onChange={(event) => onChange(event.target.value)} />
    </label>
  )
}

function SourceBlock({ label, text }) {
  return (
    <div>
      <div className="hint">{label.toUpperCase()}</div>
      <div style={{ fontSize: 12.5, marginTop: 4 }}>{text || '—'}</div>
    </div>
  )
}
