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

export function serializeFinding(row) {
  if (!row) return null
  const jsonValue = (value) => {
    if (!value) return null
    return typeof value === 'string' ? JSON.parse(value) : value
  }
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
    expected_value: row.expected_value,
    actual_value: row.actual_value,
    trigger: row.trigger_text,
    description: row.description,
    normative: row.normative,
    confidence: row.confidence,
    pd_source: jsonValue(row.pd_source),
    rd_source: jsonValue(row.rd_source),
    verification: jsonValue(row.verification),
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
