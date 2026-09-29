import { useEffect, useMemo, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { useVerification } from '../store/VerificationStore'
import StatusBadge from '../components/StatusBadge'
import Icon from '../components/Icon'
import { FINDING_STATUS, LOAD_STATUS, SCENARIOS } from '../data/constants'
import { hasBothComparisonValues } from '../utils/findingFilters'

const TABS = [
  { key: 'completeness', label: 'Комплектность', statuses: [] },
  { key: 'candidates', label: 'Кандидаты', statuses: ['CANDIDATE', 'PENDING'] },
  { key: 'confirmed', label: 'Подтверждённые нарушения', statuses: ['CONFIRMED_VIOLATION'] },
  { key: 'negative', label: 'Отрицательные (проверено)', statuses: ['NEGATIVE_VERIFIED'] },
  { key: 'other', label: 'Без данных / уточнение', statuses: ['MISSING_EVIDENCE', 'NOT_FOUND', 'NOT_APPLICABLE', 'NOT_COMPARABLE', 'CLARIFICATION_REQUIRED'] },
  { key: 'suspicion', label: 'Гипотезы (вне матрицы)', statuses: ['SUSPICION'] },
]

export default function Protocol() {
  const { id } = useParams()
  const nav = useNavigate()
  const {
    objects, ensureObjects, getFindings, ensureFindings, getCompleteness, ensureCompleteness,
    finalizeProtocol, reopenProtocol,
  } = useVerification()
  const obj = objects.find((o) => o.id === id)
  const [tab, setTab] = useState('candidates')
  const [exportMsg, setExportMsg] = useState(null)

  useEffect(() => {
    ensureObjects()
    ensureFindings(id)
    ensureCompleteness(id)
  }, [id, ensureObjects, ensureFindings, ensureCompleteness])

  const status = obj?.process_status
  const findings = getFindings(id)
  const comparableFindings = findings.filter(hasBothComparisonValues)
  const completeness = getCompleteness(id)

  const counts = useMemo(() => {
    const c = {}
    TABS.forEach((t) => {
      c[t.key] = t.statuses.length ? comparableFindings.filter((f) => t.statuses.includes(f.status)).length : completeness.length
    })
    return c
  }, [comparableFindings, completeness])

  if (!obj) return <div className="empty-state">Загрузка объекта… <Link className="link-btn" to="/">На дашборд</Link></div>

  const activeTabDef = TABS.find((t) => t.key === tab)
  const rows = activeTabDef.statuses.length ? comparableFindings.filter((f) => activeTabDef.statuses.includes(f.status)) : null

  const openCandidates = comparableFindings.filter((f) => ['CANDIDATE', 'PENDING'].includes(f.status)).length
  const canFinalize = status === 'VERIFYING' || status === 'COMPLETED'
  const isFinalizeReady = openCandidates === 0

  function handleFinalize() {
    finalizeProtocol(id)
  }

  function handleExport(type) {
    setExportMsg(`Экспорт протокола в ${type} — демо-режим, файл не генерируется.`)
    setTimeout(() => setExportMsg(null), 3200)
  }

  return (
    <div>
      <div className="page-header">
        <div>
          <div className="page-title">Протокол проверки · {obj.name}</div>
          <div className="page-subtitle">
            Матрица v{obj.matrix_version?.replace('v', '')} · набор {obj.dataset_version} · модель {obj.model_version}
          </div>
        </div>
        <div className="status-strip">
          <button className="btn btn-sm" onClick={() => handleExport('PDF')}>Экспорт PDF</button>
          <button className="btn btn-sm" onClick={() => handleExport('DOCX')}>Экспорт DOCX</button>
          <button className="btn btn-sm" onClick={() => handleExport('XML')}>Экспорт XML</button>
          {status === 'FINALIZED' ? (
            <button className="btn btn-sm" onClick={() => reopenProtocol(id)}>Отменить финализацию</button>
          ) : (
            <button className="btn btn-primary btn-sm" disabled={!canFinalize || !isFinalizeReady} onClick={handleFinalize} title={!isFinalizeReady ? 'Обработайте все CANDIDATE перед финализацией' : ''}>
              <Icon name="lock" size={13} /> Финализировать протокол
            </button>
          )}
        </div>
      </div>

      {exportMsg && (
        <div className="scenario-banner" style={{ background: 'var(--blue-bg)', color: 'var(--blue)' }}>
          <Icon name="file" size={15} /> {exportMsg}
        </div>
      )}

      {obj.scenario && (
        <div className="scenario-banner">
          <Icon name="layers" size={16} />
          Тип проверки: {SCENARIOS[obj.scenario]}
        </div>
      )}

      {status === 'FINALIZED' && (
        <div className="scenario-banner" style={{ background: 'var(--green-bg)', color: 'var(--green)' }}>
          <Icon name="lock" size={15} />
          Протокол финализирован{obj.finalized_at ? ` · ${new Date(obj.finalized_at).toLocaleString('ru-RU')}` : ''}. Дозагрузка и изменение решений недоступны. В ИАИС «РиН» переданы только подтверждённые записи.
        </div>
      )}

      {!isFinalizeReady && status !== 'FINALIZED' && (
        <div className="scenario-banner" style={{ background: 'var(--yellow-bg)', color: 'var(--yellow)' }}>
          <Icon name="alert" size={15} />
          Финализация недоступна: {openCandidates} кандидат(ов) ожидают решения инспектора.
        </div>
      )}

      <div className="tabs">
        {TABS.map((t) => (
          <div key={t.key} className={'tab' + (tab === t.key ? ' active' : '')} onClick={() => setTab(t.key)}>
            {t.label} <span className="count">{counts[t.key]}</span>
          </div>
        ))}
      </div>

      {tab === 'completeness' ? (
        <div className="card">
          <div className="table-wrap">
            <table className="data-table">
              <thead>
                <tr><th>Раздел</th><th>ПД</th><th>РД</th><th>ИД</th><th>Примечание</th></tr>
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
              </tbody>
            </table>
          </div>
        </div>
      ) : (
        <div className="card">
          <div className="table-wrap">
            <table className="data-table">
              <thead>
                <tr>
                  <th>ID</th>
                  <th>Код</th>
                  <th>Параметр</th>
                  <th>Сравнение</th>
                  <th>Значение 1</th>
                  <th>Значение 2</th>
                  <th>Приоритет</th>
                  <th>Статус</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {rows.map((f) => (
                  <tr key={f.finding_id} className="row-link" onClick={() => nav(`/objects/${id}/verify/${f.finding_id}`)}>
                    <td className="mono faint">{f.finding_id}</td>
                    <td className="mono">{f.matrix_code || '—'}</td>
                    <td style={{ maxWidth: 260 }}>
                      <div style={{ fontWeight: 600 }}>{f.parameter_name}</div>
                      <div className="faint" style={{ fontSize: 11.5 }}>{f.section}</div>
                    </td>
                    <td className="mono" style={{ fontSize: 12.5, whiteSpace: 'nowrap' }}>{comparisonLabel(f)}</td>
                    <td className="muted" style={{ fontSize: 12.5, maxWidth: 200 }}>{f.expected_value}</td>
                    <td className="muted" style={{ fontSize: 12.5, maxWidth: 200 }}>{f.actual_value}</td>
                    <td>
                      <span className="badge badge-grey">
                        <span className={`dot priority-dot-${f.review_priority}`} /> {f.review_priority}
                      </span>
                    </td>
                    <td><StatusBadge color={FINDING_STATUS[f.status]?.color}>{FINDING_STATUS[f.status]?.label}</StatusBadge></td>
                    <td><Icon name="chevronRight" size={14} className="faint" /></td>
                  </tr>
                ))}
                {rows.length === 0 && (
                  <tr><td colSpan={9}><div className="empty-state"><div className="icon">✓</div>Нет записей в этой категории</div></td></tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  )
}

function comparisonLabel(finding) {
  const labels = { PD: 'ПД', RD: 'РД', ID: 'ИД' }
  const left = finding.comparison?.left_stage || finding.pd_source?.stage || 'PD'
  const right = finding.comparison?.right_stage || finding.rd_source?.RD?.stage || finding.rd_source?.ID?.stage || 'RD'
  return `${labels[left] || left} ↔ ${labels[right] || right}`
}
