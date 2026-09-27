import { useEffect, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { useVerification } from '../store/VerificationStore'
import StatusBadge from '../components/StatusBadge'
import Icon from '../components/Icon'
import { FINDING_STATUS, REASON_CODES, DISCOVERY_METHODS } from '../data/constants'
import { formatDateTime } from '../utils/helpers'

export default function Verify() {
  const { id, findingId } = useParams()
  const nav = useNavigate()
  const { objects, ensureObjects, getFindings, ensureFindings, decide, undo } = useVerification()
  const obj = objects.find((o) => o.id === id)
  const [reason, setReason] = useState(null)
  const [comment, setComment] = useState('')
  const [mode, setMode] = useState(null) // 'reject' | 'clarify'

  useEffect(() => {
    ensureObjects()
    ensureFindings(id)
  }, [id, ensureObjects, ensureFindings])

  const findings = getFindings(id)
  const idx = findings.findIndex((f) => f.finding_id === findingId)
  const f = findings[idx]
  const prev = findings[idx - 1]
  const next = findings[idx + 1]

  const isDecided = f && ['CONFIRMED_VIOLATION', 'NEGATIVE_VERIFIED', 'NOT_APPLICABLE'].includes(f.status) && f.verification

  const openReasonPanel = (m) => {
    setMode(m)
    setReason(null)
    setComment('')
  }

  if (!obj || !f) {
    return <div className="empty-state">Загрузка записи… <Link className="link-btn" to={`/objects/${id}/protocol`}>Вернуться к протоколу</Link></div>
  }

  function confirmViolation() {
    decide(id, f.finding_id, { status: 'CONFIRMED_VIOLATION', comment: comment || 'Нарушение подтверждено инспектором.' })
    setMode(null)
  }

  function submitReject() {
    if (!reason) return
    decide(id, f.finding_id, { status: 'NEGATIVE_VERIFIED', reason_code: reason, comment })
    setMode(null)
  }

  function submitClarification() {
    decide(id, f.finding_id, { status: 'CLARIFICATION_REQUIRED', comment: comment || 'Требуется уточнение актуальной редакции.' })
    setMode(null)
  }

  function convertSuspicionToCandidate() {
    decide(id, f.finding_id, { status: 'CANDIDATE', comment: 'Доказательства привязаны инспектором, гипотеза переведена в кандидата.' })
  }

  function rejectSuspicion() {
    decide(id, f.finding_id, { status: 'NEGATIVE_VERIFIED', reason_code: 'OTHER', comment: 'Гипотеза не подтвердилась при проверке.' })
  }

  return (
    <div>
      <div className="page-header">
        <div>
          <div className="breadcrumbs" style={{ marginBottom: 6 }}>
            <Link to={`/objects/${id}/protocol`} className="link-btn">← К протоколу</Link>
          </div>
          <div className="page-title" style={{ fontSize: 19 }}>{f.parameter_name}</div>
          <div className="page-subtitle">
            {f.finding_id} · {f.matrix_code ? <span className="mono">{f.matrix_code}</span> : DISCOVERY_METHODS[f.discovery_method]} · {f.section}
          </div>
        </div>
        <div className="status-strip">
          <span className="badge badge-grey"><span className={`dot priority-dot-${f.review_priority}`} /> Приоритет {f.review_priority}</span>
          <StatusBadge color={FINDING_STATUS[f.status]?.color}>{FINDING_STATUS[f.status]?.label}</StatusBadge>
        </div>
      </div>

      {f.status === 'SUSPICION' && (
        <div className="scenario-banner" style={{ background: 'var(--purple-100)', color: 'var(--purple-700)' }}>
          <Icon name="question" size={16} />
          Гипотеза свободного поиска (confidence {Math.round((f.confidence || 0) * 100)}%) — не считается нарушением до привязки доказательств и решения инспектора.
        </div>
      )}

      <div className="evidence-grid">
        <EvidenceColumn kind="pd" title="Проектная документация (ПД) — база сравнения" source={f.pd_source} value={f.expected_value} />
        <EvidenceColumn kind="rd" title="Рабочая / исполнительная документация — зона расхождения" source={f.rd_source} value={f.actual_value} />
      </div>

      <div className="card card-pad" style={{ marginTop: 18 }}>
        <div className="grid-3">
          <div>
            <div className="hint">ОЖИДАЕМОЕ ЗНАЧЕНИЕ</div>
            <div className="value-box" style={{ marginTop: 6, borderColor: 'var(--blue)' }}>{f.expected_value}</div>
          </div>
          <div>
            <div className="hint">ФАКТИЧЕСКОЕ ЗНАЧЕНИЕ</div>
            <div className="value-box" style={{ marginTop: 6, borderColor: 'var(--red)' }}>{f.actual_value}</div>
          </div>
          <div>
            <div className="hint">ТРИГГЕР / ОСНОВАНИЕ</div>
            <div className="value-box" style={{ marginTop: 6 }}>{f.trigger || '—'}</div>
          </div>
        </div>
        <div className="divider" />
        <div style={{ fontSize: 13, lineHeight: 1.6 }}>
          <b>Обоснование модели: </b>
          <span className="muted">{f.description}</span>
        </div>
        {f.normative && f.normative !== '—' && (
          <div style={{ fontSize: 12.5, marginTop: 8 }}>
            <b>Нормативная ссылка: </b><span className="muted">{f.normative}</span>
          </div>
        )}
      </div>

      {/* Decision panel */}
      <div className="card card-pad" style={{ marginTop: 18 }}>
        {isDecided ? (
          <DecisionSummary f={f} onUndo={() => undo(id, f.finding_id)} />
        ) : f.status === 'SUSPICION' ? (
          <>
            <div style={{ fontWeight: 700, marginBottom: 10, fontSize: 14 }}>Решение по гипотезе</div>
            <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
              <button className="btn btn-primary" onClick={convertSuspicionToCandidate}>
                <Icon name="check" size={14} /> Привязать доказательства → перевести в кандидата
              </button>
              <button className="btn btn-danger" onClick={rejectSuspicion}>
                <Icon name="x" size={14} /> Отклонить гипотезу
              </button>
            </div>
          </>
        ) : (
          <>
            <div style={{ fontWeight: 700, marginBottom: 10, fontSize: 14 }}>Решение инспектора</div>

            {mode === null && (
              <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
                <button className="btn btn-success" onClick={() => openReasonPanel('confirm')}>
                  <Icon name="check" size={14} /> Подтвердить нарушение
                </button>
                <button className="btn btn-danger" onClick={() => openReasonPanel('reject')}>
                  <Icon name="x" size={14} /> Отклонить
                </button>
                <button className="btn" onClick={() => openReasonPanel('clarify')}>
                  <Icon name="question" size={14} /> Требует уточнения
                </button>
              </div>
            )}

            {mode === 'confirm' && (
              <div>
                <div className="hint" style={{ marginBottom: 8 }}>Комментарий инспектора (необязательно)</div>
                <textarea className="input" style={{ width: '100%', minHeight: 70 }} value={comment} onChange={(e) => setComment(e.target.value)} placeholder="Например: подтверждено по журналу работ №14…" />
                <div style={{ display: 'flex', gap: 10, marginTop: 12, flexWrap: 'wrap' }}>
                  <button className="btn btn-success" onClick={confirmViolation}><Icon name="check" size={14} /> Подтвердить и сохранить</button>
                  <button className="btn btn-ghost" onClick={() => setMode(null)}>Отмена</button>
                </div>
              </div>
            )}

            {mode === 'reject' && (
              <div>
                <div className="hint" style={{ marginBottom: 8 }}>Код причины отклонения (обязательно)</div>
                <div className="reason-grid">
                  {REASON_CODES.map((r) => (
                    <div key={r.code} className={'reason-option' + (reason === r.code ? ' selected' : '')} onClick={() => setReason(r.code)}>
                      {r.label}
                    </div>
                  ))}
                </div>
                <div className="hint" style={{ margin: '12px 0 8px' }}>Комментарий</div>
                <textarea className="input" style={{ width: '100%', minHeight: 60 }} value={comment} onChange={(e) => setComment(e.target.value)} placeholder="Опишите основание отклонения…" />
                <div style={{ display: 'flex', gap: 10, marginTop: 12, flexWrap: 'wrap' }}>
                  <button className="btn btn-danger" disabled={!reason} onClick={submitReject}><Icon name="check" size={14} /> Отклонить и сохранить</button>
                  <button className="btn btn-ghost" onClick={() => setMode(null)}>Отмена</button>
                </div>
              </div>
            )}

            {mode === 'clarify' && (
              <div>
                <div className="hint" style={{ marginBottom: 8 }}>Что требуется уточнить</div>
                <textarea className="input" style={{ width: '100%', minHeight: 70 }} value={comment} onChange={(e) => setComment(e.target.value)} placeholder="Например: выбрать актуальную редакцию СПЗУ…" />
                <div style={{ display: 'flex', gap: 10, marginTop: 12, flexWrap: 'wrap' }}>
                  <button className="btn btn-primary" onClick={submitClarification}><Icon name="check" size={14} /> Сохранить запрос на уточнение</button>
                  <button className="btn btn-ghost" onClick={() => setMode(null)}>Отмена</button>
                </div>
              </div>
            )}
          </>
        )}
      </div>

      <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 18 }}>
        <button className="btn" disabled={!prev} onClick={() => prev && nav(`/objects/${id}/verify/${prev.finding_id}`)}>
          <Icon name="chevronLeft" size={14} /> Предыдущий
        </button>
        <span className="hint">Запись {idx + 1} из {findings.length}</span>
        <button className="btn" disabled={!next} onClick={() => next && nav(`/objects/${id}/verify/${next.finding_id}`)}>
          Следующий <Icon name="chevronRight" size={14} />
        </button>
      </div>
    </div>
  )
}

function EvidenceColumn({ kind, title, source, value }) {
  const label = kind === 'pd' ? 'ПД' : 'РД / ИД'
  return (
    <div className={`evidence-col ${kind}`}>
      <div className="evidence-col-head">
        <span>{title}</span>
      </div>
      <div className="evidence-visual">
        <div className="frame" style={{ width: '58%', height: '55%' }}>
          <span className="frame-label">{label} · {source?.sheet || '—'}</span>
        </div>
      </div>
      <div className="evidence-meta">
        <div className="evidence-meta-row"><span className="muted">Файл</span><span className="mono">{source?.file_name || '—'}</span></div>
        <div className="evidence-meta-row"><span className="muted">Раздел / марка</span><span>{source?.discipline || '—'}</span></div>
        <div className="evidence-meta-row"><span className="muted">Редакция</span><span>{source?.revision || '—'}</span></div>
        <div className="evidence-meta-row"><span className="muted">Статус утверждения</span><span>{source?.approval_status || '—'}</span></div>
        <div className="evidence-meta-row"><span className="muted">Лист / страница</span><span>{source?.sheet || '—'}</span></div>
      </div>
    </div>
  )
}

function DecisionSummary({ f, onUndo }) {
  const v = f.verification
  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 8 }}>
        <StatusBadge color={FINDING_STATUS[f.status]?.color}>{FINDING_STATUS[f.status]?.label}</StatusBadge>
        <span className="muted" style={{ fontSize: 12.5 }}>
          решение: {v?.user} · {formatDateTime(v?.timestamp)}
        </span>
      </div>
      {v?.reason_code && (
        <div style={{ fontSize: 12.5, marginBottom: 6 }}>
          <b>Причина: </b>{REASON_CODES.find((r) => r.code === v.reason_code)?.label}
        </div>
      )}
      {v?.comment && (
        <div className="value-box" style={{ fontSize: 13 }}>{v.comment}</div>
      )}
      <button className="btn btn-sm" style={{ marginTop: 12 }} onClick={onUndo}>
        <Icon name="refresh" size={13} /> Отменить решение (супервизор)
      </button>
    </div>
  )
}
