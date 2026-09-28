import { useEffect, useRef, useState } from 'react'
import { useNavigate, useParams, Link } from 'react-router-dom'
import { useVerification } from '../store/VerificationStore'
import StatusBadge from '../components/StatusBadge'
import Icon from '../components/Icon'
import { formatDateTime } from '../utils/helpers'
import { PROCESS_STATUS, LOAD_STATUS, SCENARIOS } from '../data/constants'

const PARSE_STEPS = [
  'Распознавание текста (OCR)…',
  'Разбиение текста на фрагменты…',
  'Поиск по 132 параметрам MiniLM…',
  'Сопоставление ПД / РД / ИД…',
  'Формирование доказательств и протокола…',
]

const DELETE_REASONS = [
  { value: 'DUPLICATE_OBJECT', label: 'Дубликат объекта' },
  { value: 'TEST_OBJECT', label: 'Тестовый объект' },
  { value: 'WRONG_DATA', label: 'Ошибка в данных объекта' },
  { value: 'PROJECT_CANCELLED', label: 'Объект больше не ведётся' },
  { value: 'OTHER', label: 'Другое' },
]

export default function ObjectOverview() {
  const { id } = useParams()
  const nav = useNavigate()
  const { objects, ensureObjects, getFindings, ensureFindings, getCompleteness, ensureCompleteness, setProcessStatus, refreshObject, deleteObject } = useVerification()
  const obj = objects.find((o) => o.id === id)
  const [deleting, setDeleting] = useState(false)
  const [deleteError, setDeleteError] = useState('')
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false)
  const [deleteReason, setDeleteReason] = useState('')
  const [deleteComment, setDeleteComment] = useState('')
  const [analysisError, setAnalysisError] = useState('')
  const pollRef = useRef(null)
  const refreshObjectRef = useRef(refreshObject)

  const status = obj?.process_status
  const findings = obj ? getFindings(id) : []
  const completeness = obj ? getCompleteness(id) : []

  useEffect(() => {
    ensureObjects()
    ensureFindings(id)
    ensureCompleteness(id)
    return () => clearTimeout(pollRef.current)
  }, [id, ensureObjects, ensureFindings, ensureCompleteness])

  useEffect(() => {
    refreshObjectRef.current = refreshObject
  }, [refreshObject])

  useEffect(() => {
    if (status !== 'PARSING') return undefined
    let stopped = false
    const poll = async () => {
      try {
        const updated = await refreshObjectRef.current(id)
        if (!stopped && updated?.process_status === 'PARSING') pollRef.current = setTimeout(poll, 1500)
      } catch {
        if (!stopped) pollRef.current = setTimeout(poll, 2500)
      }
    }
    poll()
    return () => {
      stopped = true
      clearTimeout(pollRef.current)
    }
  }, [id, status])

  if (!obj) {
    return <div className="empty-state">Загрузка объекта… <Link className="link-btn" to="/">Вернуться на дашборд</Link></div>
  }

  const color = obj.color

  const confirmed = findings.filter((f) => f.status === 'CONFIRMED_VIOLATION').length
  const candidates = findings.filter((f) => ['CANDIDATE', 'PENDING'].includes(f.status)).length
  const negative = findings.filter((f) => f.status === 'NEGATIVE_VERIFIED').length
  const missing = findings.filter((f) => ['MISSING_EVIDENCE', 'NOT_APPLICABLE', 'NOT_COMPARABLE', 'CLARIFICATION_REQUIRED'].includes(f.status)).length
  const suspicion = findings.filter((f) => f.status === 'SUSPICION').length

  async function runAnalysis() {
    setAnalysisError('')
    try {
      await setProcessStatus(id, 'PARSING')
    } catch (error) {
      setAnalysisError(error.message || 'Не удалось запустить проверку')
      return
    }
  }

  function openDeleteDialog() {
    setDeleteDialogOpen(true)
    setDeleteError('')
    setDeleteReason('')
    setDeleteComment('')
  }

  async function handleDelete() {
    if (!deleteReason) {
      setDeleteError('Выберите причину удаления объекта')
      return
    }
    if (deleteReason === 'OTHER' && !deleteComment.trim()) {
      setDeleteError('Для причины «Другое» укажите комментарий')
      return
    }
    setDeleting(true)
    setDeleteError('')
    try {
      await deleteObject(id, { reasonCode: deleteReason, comment: deleteComment.trim() })
      nav('/')
    } catch (error) {
      setDeleteError(error.message || 'Не удалось удалить объект')
      setDeleting(false)
    }
  }

  return (
    <div>
      <div className="page-header">
        <div>
          <div className="page-title">{obj.name}</div>
          <div className="page-subtitle">{obj.address} · Разрешение № {obj.permit_number}</div>
        </div>
        <div className="status-strip">
          <StatusBadge color={color}>{colorLabel(color)}</StatusBadge>
          <StatusBadge color={PROCESS_STATUS[status]?.color}>{PROCESS_STATUS[status]?.label}</StatusBadge>
          <button className="btn btn-primary btn-sm" onClick={() => nav(`/objects/${id}/upload`)}>
            <Icon name="upload" size={13} /> Загрузить документы
          </button>
          <button className="btn btn-danger btn-sm" onClick={openDeleteDialog} disabled={deleting}>
            <Icon name="trash" size={13} /> {deleting ? 'Удаление…' : 'Удалить объект'}
          </button>
        </div>
      </div>

      {deleteError && !deleteDialogOpen && <div className="form-error" role="alert" style={{ marginBottom: 14 }}><Icon name="alert" size={13} /> {deleteError}</div>}

      {deleteDialogOpen && (
        <div className="card card-pad" style={{ marginBottom: 18, borderColor: 'var(--red-border)' }}>
          <div style={{ fontWeight: 700, marginBottom: 6 }}>Удаление объекта</div>
          <div className="muted" style={{ fontSize: 13, marginBottom: 12 }}>
            Объект «{obj.name}» будет удалён вместе с документами и результатами проверки. Действие нельзя отменить.
          </div>
          <div className="form-group">
            <label className="form-label" htmlFor="delete-reason">Причина удаления *</label>
            <select id="delete-reason" className="select" style={{ width: '100%' }} value={deleteReason} onChange={(event) => setDeleteReason(event.target.value)}>
              <option value="">Выберите причину</option>
              {DELETE_REASONS.map((reason) => <option key={reason.value} value={reason.value}>{reason.label}</option>)}
            </select>
          </div>
          <div className="form-group">
            <label className="form-label" htmlFor="delete-comment">Комментарий{deleteReason === 'OTHER' ? ' *' : ''}</label>
            <textarea
              id="delete-comment"
              className="input"
              style={{ width: '100%', minHeight: 88, resize: 'vertical' }}
              value={deleteComment}
              maxLength={2000}
              placeholder="Укажите подробности при необходимости"
              required={deleteReason === 'OTHER'}
              onChange={(event) => setDeleteComment(event.target.value)}
            />
          </div>
          {deleteError && <div className="form-error" role="alert" style={{ marginBottom: 12 }}><Icon name="alert" size={13} /> {deleteError}</div>}
          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
            <button className="btn btn-danger" onClick={handleDelete} disabled={deleting}>
              <Icon name="trash" size={14} /> {deleting ? 'Удаление…' : 'Подтвердить удаление'}
            </button>
            <button className="btn btn-ghost" onClick={() => setDeleteDialogOpen(false)} disabled={deleting}>Отмена</button>
          </div>
        </div>
      )}

      <div className="grid-2">
        <div className="card card-pad">
          <div style={{ fontWeight: 700, marginBottom: 12, fontSize: 14 }}>Сведения об объекте</div>
          <InfoRow label="Шифр объекта" value={obj.object_code} mono />
          <InfoRow label="Застройщик / заказчик" value={obj.customer} />
          <InfoRow label="Подрядчик" value={obj.contractor} />
          <InfoRow label="Версия матрицы" value={obj.matrix_version} mono />
          <InfoRow label="Версия набора данных" value={obj.dataset_version} mono />
          <InfoRow label="Версия модели" value={obj.model_version} mono />
          <InfoRow label="Обновлено" value={formatDateTime(obj.updated_at)} />
          {obj.finalized_at && <InfoRow label="Финализировано" value={formatDateTime(obj.finalized_at)} />}
        </div>

        <div className="card card-pad">
          <div style={{ fontWeight: 700, marginBottom: 12, fontSize: 14 }}>Статус загрузки документов</div>
          <UploadRow label="Проектная документация (ПД)" status={obj.pd_status} />
          <UploadRow label="Рабочая документация (РД)" status={obj.rd_status} />
          <UploadRow label="Исполнительная документация (ИД)" status={obj.id_status} />
          <div className="divider" />
          {obj.scenario ? (
            <div className="scenario-banner" style={{ marginBottom: 0 }}>
              <Icon name="layers" size={16} />
              {SCENARIOS[obj.scenario]}
            </div>
          ) : (
            <div className="hint">Сценарий проверки будет определён после запуска анализа.</div>
          )}
          <div style={{ marginTop: 14 }}>
            <Link to={`/objects/${id}/upload`} className="link-btn">
              <Icon name="upload" size={13} /> Дозагрузить документы
            </Link>
          </div>
        </div>
      </div>

      {(status === 'PENDING') && (
        <div className="card card-pad" style={{ marginTop: 18 }}>
          <div style={{ fontWeight: 700, marginBottom: 6, fontSize: 14 }}>Запуск проверки</div>
          <p className="muted" style={{ fontSize: 13, marginTop: 0 }}>
            Документы загружены. Нажмите «Запустить проверку», чтобы выполнить сверку по 132 параметрам матрицы контроля
            (OCR → NLP → CV-анализ → сопоставление редакций → формирование протокола).
          </p>
          <button className="btn btn-primary" onClick={runAnalysis}>
            <Icon name="play" size={14} /> Запустить проверку
          </button>
          {analysisError && <div className="form-error" role="alert" style={{ marginTop: 12 }}><Icon name="alert" size={13} /> {analysisError}</div>}
        </div>
      )}

      {status === 'PARSING' && (
        <div className="card card-pad" style={{ marginTop: 18 }}>
          <div style={{ fontWeight: 700, marginBottom: 10, fontSize: 14 }}>Идёт обработка документов</div>
          <div className="progress-track"><div className="progress-fill" style={{ width: `${Number(obj.process_progress || 0)}%` }} /></div>
          <div className="muted" style={{ fontSize: 12.5, marginTop: 10 }}>{obj.process_step || PARSE_STEPS[0]}</div>
        </div>
      )}

      {status === 'FAILED' && (
        <div className="card card-pad" style={{ marginTop: 18, borderColor: 'var(--red-border)' }}>
          <div style={{ fontWeight: 700, marginBottom: 6, color: 'var(--red)' }}>Проверка не выполнена</div>
          <div className="muted" style={{ fontSize: 13 }}>{obj.process_error || 'AI-сервис вернул ошибку. Проверьте журнал и запустите проверку повторно.'}</div>
          <button className="btn btn-primary" style={{ marginTop: 12 }} onClick={runAnalysis}>
            <Icon name="refresh" size={14} /> Повторить проверку
          </button>
        </div>
      )}

      {['READY', 'VERIFYING', 'COMPLETED', 'FINALIZED'].includes(status) && (
        <div className="card card-pad" style={{ marginTop: 18 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 12 }}>
            <div>
              <div style={{ fontWeight: 700, fontSize: 14 }}>Протокол проверки</div>
              <div className="muted" style={{ fontSize: 12.5, marginTop: 3 }}>
                {findings.length} записей: {confirmed} подтверждено, {candidates} кандидатов, {negative} отрицательных,{' '}
                {missing} без данных/уточнений, {suspicion} гипотез
              </div>
            </div>
            <button className="btn btn-primary" onClick={() => nav(`/objects/${id}/protocol`)}>
              Открыть протокол <Icon name="chevronRight" size={14} />
            </button>
          </div>
        </div>
      )}

      <div className="card card-pad" style={{ marginTop: 18 }}>
        <div style={{ fontWeight: 700, marginBottom: 12, fontSize: 14 }}>Комплектность по разделам</div>
        <div className="table-wrap">
          <table className="data-table">
            <thead>
              <tr>
                <th>Раздел</th>
                <th>ПД</th>
                <th>РД</th>
                <th>ИД</th>
                <th>Примечание</th>
              </tr>
            </thead>
            <tbody>
              {completeness.map((c) => (
                <tr key={c.section}>
                  <td style={{ fontWeight: 600 }}>{c.section}</td>
                  <td><StatusBadge color={LOAD_STATUS[c.pd]?.color}>{LOAD_STATUS[c.pd]?.label}</StatusBadge></td>
                  <td><StatusBadge color={LOAD_STATUS[c.rd]?.color}>{LOAD_STATUS[c.rd]?.label}</StatusBadge></td>
                  <td><StatusBadge color={LOAD_STATUS[c.id]?.color}>{LOAD_STATUS[c.id]?.label}</StatusBadge></td>
                  <td className="muted" style={{ fontSize: 12.5 }}>{c.note}</td>
                </tr>
              ))}
              {completeness.length === 0 && (
                <tr><td colSpan={5}><div className="empty-state">Нет данных о комплектности</div></td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}

function colorLabel(color) {
  return { green: 'Нарушений нет', yellow: 'Есть кандидаты', red: 'Есть нарушения', grey: 'Проверка не запущена' }[color] || 'Проверка требует внимания'
}

function InfoRow({ label, value, mono }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', padding: '6px 0', borderBottom: '1px dashed var(--border)', fontSize: 13 }}>
      <span className="muted">{label}</span>
      <span className={mono ? 'mono' : ''} style={{ fontWeight: 600, textAlign: 'right' }}>{value}</span>
    </div>
  )
}

function UploadRow({ label, status }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '7px 0' }}>
      <span style={{ fontSize: 13 }}>{label}</span>
      <StatusBadge color={LOAD_STATUS[status]?.color}>{LOAD_STATUS[status]?.label}</StatusBadge>
    </div>
  )
}
