import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { useVerification } from '../store/VerificationStore'
import { DOC_STAGES, UPLOAD_LIMITS, LOAD_STATUS } from '../data/constants'
import StatusBadge from '../components/StatusBadge'
import Icon from '../components/Icon'

function uid() {
  return Math.random().toString(36).slice(2) + Date.now().toString(36)
}

function fmtSize(bytes) {
  if (bytes < 1024) return `${bytes} Б`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} КБ`
  return `${(bytes / (1024 * 1024)).toFixed(1)} МБ`
}

function extOf(name) {
  const m = /\.[^.]+$/.exec(name)
  return m ? m[0].toLowerCase() : ''
}

export default function UploadPage() {
  const { id } = useParams()
  const nav = useNavigate()
  const { objects, ensureObjects, getUploads, ensureUploads, addFiles, removeFile, setProcessStatus, getProcessStatus } = useVerification()
  const obj = objects.find((o) => o.id === id)

  const [inFlight, setInFlight] = useState([]) // {tempId, stage, name, size, progress}
  const [errors, setErrors] = useState([])
  const timers = useRef({})

  useEffect(() => {
    ensureObjects()
    ensureUploads(id)
  }, [id, ensureObjects, ensureUploads])

  const uploads = getUploads(id)
  const sessionTotalBytes = useMemo(() => {
    const committed = ['PD', 'RD', 'ID'].reduce((sum, k) => sum + uploads[k].reduce((s, f) => s + f.size, 0), 0)
    const pending = inFlight.reduce((s, f) => s + f.size, 0)
    return committed + pending
  }, [uploads, inFlight])

  if (!obj) {
    return <div className="empty-state">Загрузка объекта… <Link className="link-btn" to="/">На дашборд</Link></div>
  }

  const docStatus = { PD: obj.pd_status, RD: obj.rd_status, ID: obj.id_status }

  function pushError(msg) {
    const errId = uid()
    setErrors((e) => [...e, { id: errId, msg }])
    setTimeout(() => setErrors((e) => e.filter((x) => x.id !== errId)), 5000)
  }

  function validateAndStage(stage, fileList) {
    const files = Array.from(fileList)
    let runningTotal = sessionTotalBytes
    files.forEach((file) => {
      const ext = extOf(file.name)
      if (!UPLOAD_LIMITS.acceptedExt.includes(ext)) {
        pushError(`«${file.name}»: неподдерживаемый формат. Разрешены: ${UPLOAD_LIMITS.acceptedExt.join(', ')}`)
        return
      }
      if (file.size > UPLOAD_LIMITS.maxFileMB * 1024 * 1024) {
        pushError(`«${file.name}»: файл больше ${UPLOAD_LIMITS.maxFileMB} МБ — отклонён`)
        return
      }
      if (runningTotal + file.size > UPLOAD_LIMITS.maxTotalMB * 1024 * 1024) {
        pushError(`Превышен общий лимит загрузки ${UPLOAD_LIMITS.maxTotalMB} МБ — «${file.name}» не загружен`)
        return
      }
      runningTotal += file.size
      startUpload(stage, file)
    })
  }

  function startUpload(stage, file) {
    const tempId = uid()
    setInFlight((list) => [...list, { tempId, stage, name: file.name, size: file.size, progress: 4 }])
    const started = Date.now()
    const duration = 900 + Math.random() * 900
    timers.current[tempId] = setInterval(() => {
      const pct = Math.min(100, Math.round(((Date.now() - started) / duration) * 100))
      setInFlight((list) => list.map((f) => (f.tempId === tempId ? { ...f, progress: pct } : f)))
      if (pct >= 100) {
        clearInterval(timers.current[tempId])
        delete timers.current[tempId]
        addFiles(id, stage, [file])
          .catch((error) => pushError(error.message || 'Не удалось загрузить файл'))
          .finally(() => setInFlight((list) => list.filter((f) => f.tempId !== tempId)))
      }
    }, 90)
  }

  async function handleRunAnalysis() {
    const status = getProcessStatus(id)
    const hasFiles = ['PD', 'RD', 'ID'].some((key) => uploads[key].length > 0)
    if (status === 'PENDING' && !hasFiles) {
      pushError('Нельзя запустить проверку: сначала загрузите хотя бы один документ')
      return
    }
    if (status === 'PENDING') {
      try {
        await setProcessStatus(id, 'PARSING')
      } catch (error) {
        pushError(error.message || 'Не удалось запустить проверку')
        return
      }
    }
    nav(`/objects/${id}`)
  }

  const readyToAnalyze = ['PD', 'RD', 'ID'].some((k) => docStatus[k] !== 'MISSING')

  return (
    <div>
      <div className="page-header">
        <div>
          <div className="breadcrumbs" style={{ marginBottom: 6 }}>
            <Link to={`/objects/${id}`} className="link-btn">← К карточке объекта</Link>
          </div>
          <div className="page-title">Загрузка документов</div>
          <div className="page-subtitle">{obj.name} · {obj.address}</div>
        </div>
        <button className="btn btn-primary" onClick={handleRunAnalysis}>
          <Icon name="bolt" size={14} /> {getProcessStatus(id) === 'PENDING' ? 'Запустить проверку' : 'К объекту'}
        </button>
      </div>

      <div className="scenario-banner">
        <Icon name="cloud" size={16} />
        Форматы: PDF, DOCX, XML · до {UPLOAD_LIMITS.maxFileMB} МБ на файл · до {UPLOAD_LIMITS.maxTotalMB} МБ на пакет.
        Дозагрузка возможна до финализации протокола — инкрементально, без повторной обработки уже проверенных параметров.
      </div>

      {errors.map((e) => (
        <div key={e.id} className="scenario-banner" style={{ background: 'var(--red-bg)', color: 'var(--red)' }}>
          <Icon name="alert" size={15} /> {e.msg}
        </div>
      ))}

      <div className="grid-3">
        {DOC_STAGES.map((s) => (
          <DropzoneCard
            key={s.key}
            stage={s}
            baseStatus={docStatus[s.key]}
            effectiveStatus={docStatus[s.key]}
            files={uploads[s.key]}
            inFlight={inFlight.filter((f) => f.stage === s.key)}
            onFiles={(fl) => validateAndStage(s.key, fl)}
            onRemove={(fileId) => removeFile(id, s.key, fileId)}
          />
        ))}
      </div>

      <div className="card card-pad" style={{ marginTop: 4 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12.5, marginBottom: 8 }}>
          <span className="muted">Использовано в этой сессии</span>
          <span className="mono">{fmtSize(sessionTotalBytes)} / {UPLOAD_LIMITS.maxTotalMB} МБ</span>
        </div>
        <div className="progress-track">
          <div
            className="progress-fill"
            style={{ width: `${Math.min(100, (sessionTotalBytes / (UPLOAD_LIMITS.maxTotalMB * 1024 * 1024)) * 100)}%` }}
          />
        </div>
      </div>

      {!readyToAnalyze && (
        <div className="hint" style={{ marginTop: 10 }}>
          Загрузите хотя бы один комплект документов, чтобы запустить проверку.
        </div>
      )}
    </div>
  )
}

function DropzoneCard({ stage, baseStatus, effectiveStatus, files, inFlight, onFiles, onRemove }) {
  const [drag, setDrag] = useState(false)
  const inputRef = useRef(null)

  const onDrop = useCallback(
    (e) => {
      e.preventDefault()
      setDrag(false)
      if (e.dataTransfer?.files?.length) onFiles(e.dataTransfer.files)
    },
    [onFiles]
  )

  return (
    <div className="card card-pad">
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 4 }}>
        <div>
          <div style={{ fontWeight: 700, fontSize: 13.5 }}>{stage.label}</div>
          <div className="faint" style={{ fontSize: 11.5 }}>{stage.short}</div>
        </div>
        <StatusBadge color={LOAD_STATUS[effectiveStatus]?.color}>{LOAD_STATUS[effectiveStatus]?.label}</StatusBadge>
      </div>
      <div className="hint" style={{ marginBottom: 10 }}>{stage.hint}</div>

      <div
        className={'dropzone' + (drag ? ' drag' : '')}
        onDragOver={(e) => { e.preventDefault(); setDrag(true) }}
        onDragLeave={() => setDrag(false)}
        onDrop={onDrop}
        onClick={() => inputRef.current?.click()}
        style={{ cursor: 'pointer' }}
      >
        <input
          ref={inputRef}
          type="file"
          multiple
          accept=".pdf,.docx,.xml"
          style={{ display: 'none' }}
          onChange={(e) => { onFiles(e.target.files); e.target.value = '' }}
        />
        <Icon name="cloud" size={26} className="faint" />
        <div style={{ fontWeight: 600, fontSize: 13, marginTop: 8 }}>Перетащите файлы сюда</div>
        <div className="hint" style={{ marginTop: 2 }}>или нажмите, чтобы выбрать · PDF, DOCX, XML</div>
      </div>

      <div style={{ marginTop: 12 }}>
        {baseStatus !== 'MISSING' && files.length === 0 && (
          <div className="hint" style={{ marginBottom: 8 }}>
            В системе уже числится пакет документов ({LOAD_STATUS[baseStatus]?.label}) — дозагрузите недостающие файлы при необходимости.
          </div>
        )}

        {inFlight.map((f) => (
          <div className="file-row" key={f.tempId}>
            <div className="file-icon"><Icon name="file" size={14} /></div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontWeight: 600, fontSize: 12.5, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{f.name}</div>
              <div className="progress-track" style={{ height: 5, marginTop: 5 }}>
                <div className="progress-fill" style={{ width: `${f.progress}%` }} />
              </div>
            </div>
            <span className="faint mono" style={{ fontSize: 11 }}>{f.progress}%</span>
          </div>
        ))}

        {files.map((f) => (
          <div className="file-row" key={f.id}>
            <div className="file-icon" style={{ background: 'var(--green-bg)', color: 'var(--green)' }}>
              <Icon name="check" size={14} />
            </div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontWeight: 600, fontSize: 12.5, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{f.name}</div>
              <div className="faint" style={{ fontSize: 11 }}>{fmtSize(f.size)}</div>
            </div>
            <button className="btn btn-ghost btn-sm" onClick={(e) => { e.stopPropagation(); onRemove(f.id) }} title="Удалить">
              <Icon name="trash" size={13} className="faint" />
            </button>
          </div>
        ))}

        {files.length === 0 && inFlight.length === 0 && baseStatus === 'MISSING' && (
          <div className="hint">Файлы ещё не загружены</div>
        )}
      </div>
    </div>
  )
}
