import { useEffect, useMemo, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { useVerification } from '../store/VerificationStore'
import StatusBadge from '../components/StatusBadge'
import Icon from '../components/Icon'
import { FINDING_STATUS, REASON_CODES, DISCOVERY_METHODS } from '../data/constants'
import { formatDateTime } from '../utils/helpers'
import { isReviewableFinding } from '../utils/findingFilters'
import { apiFetchBlob } from '../api/client'

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

  const allFindings = getFindings(id)
  const findings = allFindings.filter(isReviewableFinding)
  const idx = findings.findIndex((f) => f.finding_id === findingId)
  const f = findings[idx]
  const hiddenFinding = allFindings.find((finding) => finding.finding_id === findingId)
  const prev = findings[idx - 1]
  const next = findings[idx + 1]
  const comparison = useMemo(() => getComparisonPair(f || {}), [f])
  const [previewUrls, setPreviewUrls] = useState({})
  const [previewErrors, setPreviewErrors] = useState({})
  const [viewer, setViewer] = useState(null)

  useEffect(() => {
    let active = true
    const objectUrls = []
    const sources = [comparison.leftSource, comparison.rightSource]
      .filter((source) => source?.file_id && isPdfSource(source))

    Promise.all(sources.map(async (source) => {
      try {
        const blob = await apiFetchBlob(`/api/objects/${encodeURIComponent(id)}/files/${encodeURIComponent(source.file_id)}/content`)
        if (!active) return
        const url = URL.createObjectURL(blob)
        objectUrls.push(url)
        setPreviewUrls((current) => ({ ...current, [source.file_id]: url }))
      } catch (error) {
        if (active) setPreviewErrors((current) => ({ ...current, [source.file_id]: error.message }))
      }
    }))

    return () => {
      active = false
      objectUrls.forEach((url) => URL.revokeObjectURL(url))
    }
  }, [id, comparison.leftSource, comparison.rightSource])

  const isDecided = f && ['CONFIRMED_VIOLATION', 'NEGATIVE_VERIFIED', 'NOT_APPLICABLE', 'NOT_COMPARABLE'].includes(f.status) && f.verification

  const openReasonPanel = (m) => {
    setMode(m)
    setReason(null)
    setComment('')
  }

  if (!obj || !f) {
    return <div className="empty-state">{obj && hiddenFinding ? 'Запись скрыта: отсутствуют подтверждённые значения с обеих сторон.' : 'Загрузка записи…'} <Link className="link-btn" to={`/objects/${id}/protocol`}>Вернуться к протоколу</Link></div>
  }

  const stageLabel = (stage) => ({ PD: 'ПД', RD: 'РД', ID: 'ИД' }[stage] || stage || 'Документ')

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

  function markManualStatus(status, reason_code, comment) {
    decide(id, f.finding_id, { status, reason_code, comment })
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
        <EvidenceColumn
          kind="pd"
          title={`${stageLabel(comparison.leftStage)} — первый источник сравнения`}
          source={comparison.leftSource}
          previewUrl={previewUrls[comparison.leftSource?.file_id]}
          previewError={previewErrors[comparison.leftSource?.file_id]}
          onOpen={() => setViewer({ source: comparison.leftSource, url: previewUrls[comparison.leftSource?.file_id] })}
        />
        <EvidenceColumn
          kind="rd"
          title={`${stageLabel(comparison.rightStage)} — второй источник сравнения`}
          source={comparison.rightSource}
          previewUrl={previewUrls[comparison.rightSource?.file_id]}
          previewError={previewErrors[comparison.rightSource?.file_id]}
          onOpen={() => setViewer({ source: comparison.rightSource, url: previewUrls[comparison.rightSource?.file_id] })}
        />
      </div>

      <div className="card card-pad" style={{ marginTop: 18 }}>
        <div className="grid-3">
          <div>
            <div className="hint">{stageLabel(comparison.leftStage)} — ЗНАЧЕНИЕ</div>
            <div className="value-box" style={{ marginTop: 6, borderColor: 'var(--blue)' }}>{f.expected_value}</div>
          </div>
          <div>
            <div className="hint">{stageLabel(comparison.rightStage)} — ЗНАЧЕНИЕ</div>
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
              <button className="btn" onClick={() => markManualStatus('NOT_APPLICABLE', 'NOT_APPLICABLE_PARAM', 'Параметр признан инспектором неприменимым к объекту.')}>
                Неприменимо
              </button>
              <button className="btn" onClick={() => markManualStatus('NOT_COMPARABLE', 'LINK_ERROR', 'Источники признаны инспектором несопоставимыми.')}>
                Несопоставимо
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
                <button className="btn" onClick={() => markManualStatus('NOT_APPLICABLE', 'NOT_APPLICABLE_PARAM', 'Параметр признан инспектором неприменимым к объекту.')}>
                  Неприменимо
                </button>
                <button className="btn" onClick={() => markManualStatus('NOT_COMPARABLE', 'LINK_ERROR', 'Источники признаны инспектором несопоставимыми.')}>
                  Несопоставимо
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

      {viewer?.url && (
        <div className="document-viewer-backdrop" role="presentation" onClick={() => setViewer(null)}>
          <div className="document-viewer-modal" role="dialog" aria-modal="true" aria-label={`Просмотр ${viewer.source?.file_name || 'документа'}`} onClick={(event) => event.stopPropagation()}>
            <div className="document-viewer-head">
              <div>
                <div className="document-viewer-title">{viewer.source?.file_name || 'Документ'}</div>
                <div className="document-viewer-subtitle">
                  {stageLabel(viewer.source?.stage)} · {getValidPage(viewer.source) ? `страница ${getValidPage(viewer.source)}` : 'страница не определена'}
                </div>
              </div>
              <button className="btn btn-sm" type="button" onClick={() => setViewer(null)}>Закрыть</button>
            </div>
            <iframe
              className="document-viewer-frame"
              src={`${viewer.url}${pdfPageFragment(getValidPage(viewer.source))}`}
              title={`Просмотр ${viewer.source?.file_name || 'документа'}`}
            />
          </div>
        </div>
      )}
    </div>
  )
}

function EvidenceColumn({ kind, title, source, previewUrl, previewError, onOpen }) {
  const stage = source?.stage || '—'
  const page = getValidPage(source)
  const section = source?.section
  const hasFile = Boolean(source?.file_id)
  return (
    <div className={`evidence-col ${kind}`}>
      <div className="evidence-col-head">
        <span>{title}</span>
      </div>
      <div className="evidence-visual">
        {previewUrl ? (
          <div className="evidence-preview" role="button" tabIndex={0} onClick={onOpen} onKeyDown={(event) => event.key === 'Enter' && onOpen?.()}>
            <iframe
              className="evidence-preview-frame"
              src={`${previewUrl}${pdfPageFragment(page)}`}
              title={`Предпросмотр ${source?.file_name || 'документа'}`}
              tabIndex={-1}
            />
            <span className="evidence-preview-overlay">Открыть просмотр</span>
          </div>
        ) : (
          <div className="frame" style={{ width: '58%', height: '55%' }}>
            <span className="frame-label">{stage} · {page || '—'}</span>
            <span className="evidence-preview-status">
              {previewError ? 'Не удалось открыть скан' : hasFile && isPdfSource(source) ? 'Загрузка скана…' : 'Скан недоступен'}
            </span>
          </div>
        )}
      </div>
      <div className="evidence-meta">
        <div className="evidence-meta-row"><span className="muted">Файл</span><span className="mono">{source?.file_name || '—'}</span></div>
        <div className="evidence-meta-row"><span className="muted">Размер</span><span>{formatFileSize(source?.file_size)}</span></div>
        <div className="evidence-meta-row"><span className="muted">Раздел</span><span>{section || '—'}</span></div>
        <div className="evidence-meta-row"><span className="muted">Код документа</span><span>{source?.document_code || '—'}</span></div>
        <div className="evidence-meta-row"><span className="muted">Лист / страница</span><span>{page || '—'}</span></div>
      </div>
    </div>
  )
}

function formatFileSize(bytes) {
  const value = Number(bytes)
  if (!Number.isFinite(value) || value <= 0) return '—'
  if (value < 1024) return `${value} Б`
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} КБ`
  return `${(value / (1024 * 1024)).toFixed(1)} МБ`
}

function getValidPage(source) {
  const page = Number(source?.page)
  const pageCount = Number(source?.page_count)
  if (!Number.isInteger(page) || page < 1) return null
  if (Number.isInteger(pageCount) && pageCount > 0 && page > pageCount) return null
  return page
}

function pdfPageFragment(page) {
  return page ? `#page=${page}` : ''
}

function isPdfSource(source) {
  return source?.mime_type === 'application/pdf' || /\.pdf$/i.test(source?.file_name || '')
}

function getComparisonPair(finding) {
  if (finding.comparison?.left_source || finding.comparison?.right_source) {
    return {
      leftStage: finding.comparison.left_stage || finding.comparison.left_source?.stage || 'PD',
      rightStage: finding.comparison.right_stage || finding.comparison.right_source?.stage || 'RD',
      leftSource: finding.comparison.left_source,
      rightSource: finding.comparison.right_source,
    }
  }

  const rightSource = finding.rd_source?.RD || finding.rd_source?.ID || finding.rd_source || null
  return {
    leftStage: finding.pd_source?.stage || 'PD',
    rightStage: rightSource?.stage || 'RD',
    leftSource: finding.pd_source,
    rightSource,
  }
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
