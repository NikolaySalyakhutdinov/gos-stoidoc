import { normalizeFilename } from './filename.js'

export function serializeObject(row) {
  if (!row) return null
  return {
    id: row.id,
    name: row.name,
    address: row.address,
    customer: row.customer,
    contractor: row.contractor,
    permit_number: row.permit_number,
    object_code: row.object_code,
    process_status: row.process_status,
    scenario: row.scenario,
    pd_status: row.pd_status,
    rd_status: row.rd_status,
    id_status: row.id_status,
    matrix_version: row.matrix_version,
    dataset_version: row.dataset_version,
    model_version: row.model_version,
    process_step: row.process_step,
    process_progress: Number(row.process_progress || 0),
    process_error: row.process_error,
    updated_at: row.updated_at,
    finalized_at: row.finalized_at,
  }
}

export function serializeFinding(row, filesById = new Map(), fragmentsByFile = new Map()) {
  if (!row) return null
  const jsonValue = (value) => {
    if (!value) return null
    return typeof value === 'string' ? JSON.parse(value) : value
  }
  const normalizeSource = (value) => {
    if (!value || typeof value !== 'object') return value
    if (Array.isArray(value)) return value.map(normalizeSource)
    const normalized = Object.fromEntries(
      Object.entries(value).map(([key, item]) => [
        key,
        key === 'file_name' ? normalizeFilename(item) : normalizeSource(item),
      ]),
    )
    const file = value.file_id ? filesById.get(value.file_id) : null
    if (!file) return normalized
    const fragments = fragmentsByFile.get(value.file_id) || []
    const sourceText = String(normalized.text || '').trim()
    const matchedFragment = fragments.find((fragment) => fragment.text === sourceText)
      || fragments.find((fragment) => {
        const fragmentText = String(fragment.text || '').trim()
        const probe = sourceText.slice(0, 160)
        return probe && fragmentText.includes(probe)
      })
    const fragmentPageCount = fragments.reduce((max, fragment) => Math.max(max, Number(fragment.page) || 0), 0)
    const pageCount = Number(file.page_count || fragmentPageCount) || null
    const sourcePage = Number(normalized.page)
    const validSourcePage = Number.isInteger(sourcePage)
      && sourcePage > 0
      && (!pageCount || sourcePage <= pageCount)
    return {
      ...normalized,
      file_name: normalizeFilename(file.name),
      file_size: Number(file.size || 0),
      mime_type: file.mime_type || null,
      sha256: file.sha256 || null,
      stage: file.stage,
      page_count: pageCount,
      section: row.section || normalized.section || null,
      document_code: normalized.document_code || normalizeFilename(file.name).replace(/\.[^.]+$/, ''),
      page: validSourcePage ? sourcePage : matchedFragment?.page ?? null,
      bbox: matchedFragment?.bbox ?? normalized.bbox ?? null,
    }
  }
  const sourceValues = (source) => new Set(
    String(source?.text || '')
      .toLocaleLowerCase('ru-RU')
      .match(/[a-zа-яё0-9]+/gi)
      ?.filter((value) => /\d/.test(value)) || [],
  )
  const inferComparison = (pdSource, rdSource) => {
    const sources = { PD: pdSource, RD: rdSource?.RD, ID: rdSource?.ID }
    const pairs = [['RD', 'ID'], ['PD', 'RD'], ['PD', 'ID']]
      .map(([leftStage, rightStage]) => ({ leftStage, rightStage, leftSource: sources[leftStage], rightSource: sources[rightStage] }))
      .filter((pair) => pair.leftSource && pair.rightSource)
    if (!pairs.length) return null
    const ranked = pairs.map((pair) => {
      const leftValues = sourceValues(pair.leftSource)
      const rightValues = sourceValues(pair.rightSource)
      const shared = [...leftValues].filter((value) => rightValues.has(value))
      return {
        ...pair,
        relation: !leftValues.size || !rightValues.size ? 'UNCERTAIN' : shared.length ? 'MATCH' : 'MISMATCH',
      }
    })
    const selected = ranked.find((pair) => pair.relation === 'MISMATCH')
      || ranked.find((pair) => pair.relation === 'UNCERTAIN')
      || ranked[0]
    return {
      left_stage: selected.leftStage,
      right_stage: selected.rightStage,
      relation: selected.relation,
      left_source: selected.leftSource,
      right_source: selected.rightSource,
    }
  }
  const pdSource = normalizeSource(jsonValue(row.pd_source))
  const rdSource = normalizeSource(jsonValue(row.rd_source))
  const comparison = normalizeSource(jsonValue(row.comparison)) || inferComparison(pdSource, rdSource)
  return {
    finding_id: row.finding_id,
    object_id: row.object_id,
    matrix_code: row.matrix_code,
    section: row.section,
    parameter_name: row.parameter_name,
    unit: row.unit,
    status: row.status,
    review_priority: row.review_priority,
    discovery_method: row.discovery_method,
    expected_value: comparison?.left_source?.extracted_value || comparison?.left_source?.text || row.expected_value,
    actual_value: comparison?.right_source?.extracted_value || comparison?.right_source?.text || row.actual_value,
    trigger: row.trigger_text,
    description: row.description,
    normative: row.normative,
    confidence: row.confidence,
    pd_source: pdSource,
    rd_source: rdSource,
    comparison,
    suspicion: comparison?.suspicion || null,
    verification: jsonValue(row.verification),
  }
}

export function serializeSuspicion(row) {
  if (!row) return null
  return {
    suspicion_id: row.suspicion_id || row.id,
    object_id: row.object_id,
    finding_id: row.finding_id,
    discovery_method: row.discovery_method,
    confidence: row.confidence === null || row.confidence === undefined ? null : Number(row.confidence),
    description: row.description || row.reason || null,
    pd_reference: row.pd_reference,
    rd_reference: row.rd_reference,
    review_priority: row.review_priority,
    normative_base: row.normative_base,
    finding_status: 'SUSPICION',
    inspector_status: row.inspector_status || 'PENDING',
    status: row.status,
    evidence: row.evidence || {},
    dedup_key: row.dedup_key,
    created_at: row.created_at,
    resolved_at: row.resolved_at,
  }
}

export function findingsSummary(findings) {
  const confirmed = findings.filter((f) => f.status === 'CONFIRMED_VIOLATION').length
  const candidates = findings.filter((f) => ['CANDIDATE', 'PENDING'].includes(f.status)).length
  const suspicions = findings.filter((f) => f.status === 'SUSPICION').length
  const open = findings.filter((f) =>
    ['CANDIDATE', 'PENDING', 'SUSPICION', 'CLARIFICATION_REQUIRED'].includes(f.status)
  ).length
  return { total: findings.length, confirmed, candidates, suspicions, open }
}

export function objectColor(processStatus, summary) {
  if (processStatus === 'PENDING' || processStatus === 'PARSING') return 'grey'
  if (processStatus === 'FAILED') return 'red'
  if (summary.confirmed > 0) return 'red'
  if (summary.open > 0) return 'yellow'
  return 'green'
}
