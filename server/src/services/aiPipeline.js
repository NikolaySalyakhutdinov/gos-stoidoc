import { randomUUID } from 'node:crypto'
import { query, withTransaction } from '../db.js'
import { recordAudit } from '../utils/http.js'
import { normalizeFilename } from '../utils/filename.js'
import { processDocumentWithAi } from './aiGateway.js'
import { publishProgress } from './progressEvents.js'

const STAGES = ['PD', 'RD', 'ID']
const AI_DISCOVERY_METHOD = 'AI_SEMANTIC_COMPARATOR'
const MAX_EVIDENCE_CANDIDATES = 12

function stageSource(parameter, stage) {
  return { PD: parameter.source_pd, RD: parameter.source_rd, ID: parameter.source_id }[stage]
}

function stageLabel(stage) {
  return { PD: 'ПД', RD: 'РД', ID: 'ИД' }[stage]
}

function truncate(value, max = 4000) {
  const text = String(value || '')
  return text.length > max ? `${text.slice(0, max - 1)}…` : text
}

function tokens(text) {
  const stop = new Set(['это', 'для', 'или', 'при', 'между', 'данные', 'раздел', 'таблица', 'лист', 'по', 'из', 'и', 'в', 'на'])
  return new Set(
    String(text || '')
      .toLocaleLowerCase('ru-RU')
      .match(/[a-zа-яё0-9]+(?:[.,/%°xх/-][a-zа-яё0-9]+)*/gi)
      ?.map((value) => value.replace(/^[-./]+|[-./]+$/g, ''))
      .filter((value) => value.length > 1 && !stop.has(value)) || [],
  )
}

function comparableValues(evidenceOrText) {
  if (evidenceOrText && typeof evidenceOrText === 'object') {
    const normalized = evidenceOrText.normalized_value
      || evidenceOrText.extracted_value
      || evidenceOrText.value
    if (normalized) return new Set([String(normalized).toLocaleLowerCase('ru-RU')])
  }
  const text = typeof evidenceOrText === 'string' ? evidenceOrText : evidenceOrText?.text
  return new Set([...tokens(text)].filter((value) => /\d/.test(value)))
}

function anchorTokens(text) {
  return [...tokens(text)].filter((value) => !/\d/.test(value) && value.length >= 4)
}

function anchorTokenMatches(left, right) {
  if (left === right) return true
  const suffixes = ['иями', 'ами', 'ями', 'ого', 'ему', 'ому', 'ыми', 'ими', 'ей', 'ий', 'ый', 'ой', 'ая', 'яя', 'ов', 'ев', 'ам', 'ям', 'ах', 'ях', 'ом', 'ем', 'ы', 'и', 'а', 'я', 'у', 'ю', 'е']
  const stem = (value) => {
    const suffix = suffixes.find((item) => value.length - item.length >= 4 && value.endsWith(item))
    return suffix ? value.slice(0, -suffix.length) : value
  }
  const leftStem = stem(left.replaceAll('ё', 'е'))
  const rightStem = stem(right.replaceAll('ё', 'е'))
  return leftStem === rightStem || (leftStem.length >= 5 && rightStem.startsWith(leftStem.slice(0, 5)))
}

const GENERIC_PARAMETER_TERMS = new Set([
  'общий', 'общие', 'общего', 'общая', 'основной', 'основные', 'данные', 'сведения',
  'работа', 'работы', 'рабочий', 'рабочие', 'конструкция', 'конструкции', 'объект',
  'объекта', 'здание', 'здания', 'устройство', 'система', 'системы', 'материал',
  'материалы', 'схема', 'схемы', 'план', 'планы', 'чертеж', 'чертежи', 'ведомость',
  'ведомости', 'раздел', 'лист', 'таблица', 'значение', 'показатель', 'параметр',
])

function anchorRelevance(candidate, parameter, stage) {
  const primary = anchorTokens(parameter.parameter)
  const source = anchorTokens(stageSource(parameter, stage))
  const textTerms = anchorTokens(candidate.text)
  if (!primary.length || !textTerms.length) return null

  const distinctivePrimary = primary.filter((term) => !GENERIC_PARAMETER_TERMS.has(term))
  const primaryMatches = primary.filter((term) => textTerms.some((value) => anchorTokenMatches(term, value))).length
  const distinctiveMatches = distinctivePrimary.filter((term) => textTerms.some((value) => anchorTokenMatches(term, value))).length
  const requiredDistinctiveMatches = distinctivePrimary.length >= 2 ? 2 : 1
  if (distinctivePrimary.length && distinctiveMatches < requiredDistinctiveMatches) return null
  if (!distinctivePrimary.length && primaryMatches < 2) return null

  const allTerms = [...new Set([...primary, ...source])]
  const matchedTerms = allTerms.filter((term) => textTerms.some((value) => anchorTokenMatches(term, value))).length
  return {
    score: allTerms.length ? matchedTerms / allTerms.length : 0,
    matchCount: matchedTerms,
  }
}

function intersectionSize(sets) {
  if (!sets.length || sets.some((set) => set.size === 0)) return 0
  const [first, ...rest] = sets
  return [...first].filter((value) => rest.every((set) => set.has(value))).length
}

function difference(left, right) {
  return [...left].filter((value) => !right.has(value))
}

function pairPriority(leftStage, rightStage) {
  return {
    'RD-ID': 0,
    'PD-RD': 1,
    'PD-ID': 2,
  }[`${leftStage}-${rightStage}`] ?? 99
}

function comparePair(leftStage, rightStage, left, right) {
  const leftValues = comparableValues(left)
  const rightValues = comparableValues(right)
  const sharedValues = [...leftValues].filter((value) => rightValues.has(value))
  const relation = !leftValues.size || !rightValues.size
    ? 'UNCERTAIN'
    : sharedValues.length > 0
      ? 'MATCH'
      : 'MISMATCH'

  return {
    leftStage,
    rightStage,
    left,
    right,
    relation,
    sharedValues,
    leftOnly: difference(leftValues, rightValues),
    rightOnly: difference(rightValues, leftValues),
  }
}

function candidateValueKey(evidence) {
  const values = [...comparableValues(evidence)].sort()
  return values.length ? values.join('|') : null
}

function pairCandidates(leftStage, rightStage, leftCandidates, rightCandidates) {
  const pairs = []
  const leftGroups = new Map()
  const rightGroups = new Map()
  const usedLeft = new Set()
  const usedRight = new Set()

  leftCandidates.forEach((candidate, index) => {
    const key = candidateValueKey(candidate)
    if (!key) return
    const group = leftGroups.get(key) || []
    group.push({ candidate, index })
    leftGroups.set(key, group)
  })
  rightCandidates.forEach((candidate, index) => {
    const key = candidateValueKey(candidate)
    if (!key) return
    const group = rightGroups.get(key) || []
    group.push({ candidate, index })
    rightGroups.set(key, group)
  })

  for (const [key, leftGroup] of leftGroups) {
    const rightGroup = rightGroups.get(key)
    if (!rightGroup) continue
    const count = Math.min(leftGroup.length, rightGroup.length)
    for (let index = 0; index < count; index += 1) {
      const left = leftGroup[index]
      const right = rightGroup[index]
      usedLeft.add(left.index)
      usedRight.add(right.index)
      pairs.push(comparePair(leftStage, rightStage, left.candidate, right.candidate))
    }
  }

  const unmatchedLeft = leftCandidates
    .map((candidate, index) => ({ candidate, index }))
    .filter((item) => !usedLeft.has(item.index))
  const unmatchedRight = rightCandidates
    .map((candidate, index) => ({ candidate, index }))
    .filter((item) => !usedRight.has(item.index))
  const remainingCount = Math.max(unmatchedLeft.length, unmatchedRight.length)

  for (let index = 0; index < remainingCount; index += 1) {
    pairs.push(comparePair(
      leftStage,
      rightStage,
      unmatchedLeft[index]?.candidate || null,
      unmatchedRight[index]?.candidate || null,
    ))
  }

  return pairs
}

function selectComparisonPair(candidates, stages) {
  const pairs = []
  for (let leftIndex = 0; leftIndex < stages.length; leftIndex += 1) {
    for (let rightIndex = leftIndex + 1; rightIndex < stages.length; rightIndex += 1) {
      const leftStage = stages[leftIndex]
      const rightStage = stages[rightIndex]
      const occurrences = pairCandidates(leftStage, rightStage, candidates[leftStage] || [], candidates[rightStage] || [])
      if (occurrences.length) {
        const relation = occurrences.some((pair) => pair.relation === 'MISMATCH')
          ? 'MISMATCH'
          : occurrences.some((pair) => pair.relation === 'UNCERTAIN') ? 'UNCERTAIN' : 'MATCH'
        pairs.push({ leftStage, rightStage, relation, occurrences })
      }
    }
  }

  const rank = { MISMATCH: 0, UNCERTAIN: 1, MATCH: 2 }
  pairs.sort((left, right) => {
    const relationOrder = rank[left.relation] - rank[right.relation]
    if (relationOrder !== 0) return relationOrder
    return pairPriority(left.leftStage, left.rightStage) - pairPriority(right.leftStage, right.rightStage)
  })
  return pairs[0] || null
}

function evidenceCandidates(documents, stage, parameter) {
  const candidates = documents
    .filter((document) => document.file.stage === stage)
    .flatMap((document) => (document.result.results_by_parameter?.[parameter.code] || []).map((item) => ({ ...item, file: document.file })))
    .sort((left, right) => Number(right.rank_score ?? right.semantic_score ?? 0) - Number(left.rank_score ?? left.semantic_score ?? 0))
  const unique = []
  const keys = new Set()
  for (const candidate of candidates) {
    if (candidate.status && candidate.status !== 'CONFIRMED' && candidate.extraction_status !== 'CONFIRMED') continue
    const relevance = anchorRelevance(candidate, parameter, stage)
    if (!relevance) continue
    const key = [candidate.file.id, candidate.page || '', candidateValueKey(candidate) || String(candidate.text || '').slice(0, 180)].join(':')
    if (keys.has(key)) continue
    keys.add(key)
    unique.push({ ...candidate, anchor_score: relevance.score, anchor_match_count: relevance.matchCount })
    if (unique.length >= MAX_EVIDENCE_CANDIDATES) break
  }
  return unique
}

function evidenceForFinding(evidence, parameter = null) {
  if (!evidence) return null
  const documentMetadata = evidence.document_metadata || {}
  return {
    file_id: evidence.file.id,
    file_name: evidence.file.name,
    file_size: Number(evidence.file.size || 0),
    mime_type: evidence.file.mime_type || null,
    sha256: evidence.file.sha256 || null,
    page_count: Number(evidence.file.page_count || 0) || null,
    page: evidence.page ?? evidence.metadata?.page ?? null,
    document_code: evidence.document_code ?? documentMetadata.document_code ?? null,
    bbox: evidence.bbox ?? null,
    text: truncate(evidence.text, 900),
    semantic_score: evidence.semantic_score ?? null,
    rank_score: evidence.rank_score ?? null,
    source: evidence.source ?? evidence.file.name ?? null,
    source_hint: evidence.source_hint ?? (parameter ? stageSource(parameter, evidence.file.stage) || null : null),
    stage: evidence.stage ?? evidence.file.stage,
    section: evidence.section ?? parameter?.section ?? null,
    chunk_id: evidence.id ?? evidence.chunk_id ?? null,
    content_kind: evidence.content_kind ?? null,
    extracted_value: evidence.extracted_value ?? evidence.value ?? null,
    normalized_value: evidence.normalized_value ?? null,
    unit: evidence.unit ?? parameter?.unit ?? null,
    extractor: evidence.extractor ?? null,
    extraction_status: evidence.extraction_status ?? evidence.status ?? null,
    rerank_score: evidence.rerank_score ?? null,
  }
}

function serializeComparison(pair, parameter = null) {
  if (!pair) return null
  return {
    left_stage: pair.leftStage,
    right_stage: pair.rightStage,
    relation: pair.relation,
    left_source: evidenceForFinding(pair.left, parameter),
    right_source: evidenceForFinding(pair.right, parameter),
    shared_values: pair.sharedValues,
    left_only: pair.leftOnly,
    right_only: pair.rightOnly,
  }
}

function extractedDisplayValue(evidence) {
  if (!evidence) return null
  return evidence.extracted_value || evidence.value || truncate(evidence.text, 900)
}

function parameterStageStatus(documents, stage, code) {
  const document = documents.find((item) => item.file.stage === stage)
  return document?.result?.parameter_status?.[code]?.status || null
}

function buildFindingOccurrence(parameter, pair, candidates, comparisonStages, documents) {
  const evidence = Object.fromEntries(STAGES.map((stage) => [stage, candidates[stage]?.[0] || null]))
  if (pair) {
    evidence[pair.leftStage] = pair.left
    evidence[pair.rightStage] = pair.right
  }

  const requiredStages = STAGES.filter((stage) => String(stageSource(parameter, stage) || '').trim())
  const presentStages = STAGES.filter((stage) => candidates[stage]?.length)
  const expectedStages = requiredStages.length ? requiredStages : comparisonStages
  const comparisonEvidence = expectedStages.map((stage) => evidence[stage]).filter(Boolean)
  const snippets = Object.fromEntries(STAGES.map((stage) => [stage, evidence[stage] ? truncate(evidence[stage].text, 900) : null]))
  const confidenceValues = presentStages
    .map((stage) => Number(evidence[stage]?.extraction_confidence ?? evidence[stage]?.rerank_score ?? evidence[stage]?.semantic_score ?? 0))
    .filter(Number.isFinite)
  const confidence = confidenceValues.length
    ? Math.max(0, Math.min(1, confidenceValues.reduce((sum, value) => sum + value, 0) / confidenceValues.length))
    : null
  const notFoundStages = expectedStages.filter((stage) => (
    !evidence[stage] && parameterStageStatus(documents, stage, parameter.code) === 'NOT_FOUND'
  ))

  let status = notFoundStages.length ? 'NOT_FOUND' : 'MISSING_EVIDENCE'
  let description = `Недостаточно доказательств для параметра «${parameter.parameter}».`
  if (notFoundStages.length) {
    const missing = notFoundStages.map(stageLabel).join(', ')
    description = `Подтверждённое значение параметра «${parameter.parameter}» не найдено в источниках: ${missing}.`
  } else if (expectedStages.length && comparisonEvidence.length < expectedStages.length) {
    const missing = expectedStages.filter((stage) => !evidence[stage]).map(stageLabel).join(', ')
    description = `Не найдены сопоставимые фрагменты: ${missing}.`
  } else if (pair?.relation === 'MATCH') {
    status = 'NEGATIVE_VERIFIED'
    description = `В источниках ${stageLabel(pair.leftStage)} и ${stageLabel(pair.rightStage)} совпадают извлечённые числовые или кодовые значения.`
  } else if (pair?.relation === 'MISMATCH') {
    status = 'CANDIDATE'
    description = `Найдены различия между источниками ${stageLabel(pair.leftStage)} и ${stageLabel(pair.rightStage)}: значения или коды не совпадают.`
  } else if (comparisonEvidence.length >= 2) {
    if (pair?.relation === 'UNCERTAIN') {
      status = 'CLARIFICATION_REQUIRED'
      description = `Источники ${stageLabel(pair.leftStage)} и ${stageLabel(pair.rightStage)} найдены, но сопоставимое значение извлечено неоднозначно.`
    } else if (intersectionSize(comparisonEvidence.map((item) => comparableValues(item))) > 0) {
      status = 'NEGATIVE_VERIFIED'
      description = 'В найденных фрагментах ПД, РД и ИД совпадают извлечённые числовые или кодовые значения.'
    } else {
      status = 'CLARIFICATION_REQUIRED'
      description = 'Фрагменты найдены, но автоматическое извлечение сопоставимого значения неоднозначно.'
    }
  } else if (comparisonEvidence.length === 1 && expectedStages.length <= 1) {
    status = 'CLARIFICATION_REQUIRED'
    description = 'Найден один источник; автоматическое сравнение редакций невозможно.'
  }

  return {
    evidence,
    status,
    confidence,
    expectedValue: pair?.left ? extractedDisplayValue(pair.left) : extractedDisplayValue(evidence.PD) || snippets.PD,
    actualValue: pair?.right ? extractedDisplayValue(pair.right) : extractedDisplayValue(evidence.RD) || extractedDisplayValue(evidence.ID) || JSON.stringify({ RD: snippets.RD, ID: snippets.ID }, null, 0),
    comparison: serializeComparison(pair, parameter),
    description,
  }
}

function compareParameter(parameter, documents) {
  const candidates = Object.fromEntries(STAGES.map((stage) => [stage, evidenceCandidates(documents, stage, parameter)]))
  const requiredStages = STAGES.filter((stage) => String(stageSource(parameter, stage) || '').trim())
  const presentStages = STAGES.filter((stage) => candidates[stage].length)
  const comparisonStages = requiredStages.length ? requiredStages : presentStages
  const selectedGroup = comparisonStages.length >= 2
    ? selectComparisonPair(candidates, comparisonStages)
    : null
  const missingStages = comparisonStages.filter((stage) => !candidates[stage].length)
  let selectedOccurrences = selectedGroup?.occurrences || []

  if (missingStages.length) {
    selectedOccurrences = selectedOccurrences.slice(0, 1)
  } else if (selectedOccurrences.some((pair) => pair.relation === 'MISMATCH')) {
    selectedOccurrences = selectedOccurrences.filter((pair) => pair.relation === 'MISMATCH')
  } else if (selectedOccurrences.some((pair) => pair.relation === 'UNCERTAIN')) {
    selectedOccurrences = selectedOccurrences.filter((pair) => pair.relation === 'UNCERTAIN').slice(0, 1)
  } else {
    selectedOccurrences = selectedOccurrences.slice(0, 1)
  }

  if (!selectedOccurrences.length) selectedOccurrences = [null]

  return {
    parameter,
    candidates,
    occurrences: selectedOccurrences.map((pair) => buildFindingOccurrence(parameter, pair, candidates, comparisonStages, documents)),
  }
}

function scenarioForStages(stages) {
  const key = [...stages].sort().join('_')
  return {
    ID_PD_RD: 'FULL',
    PD_RD: 'PD_RD_ONLY',
    ID_PD: 'PD_ID_ONLY',
    ID_RD: 'RD_ID_ONLY',
  }[key] || 'SINGLE_ONLY'
}

async function updateProgress({ objectId, processId, status, step, progress, error = null }) {
  await withTransaction(async (client) => {
    await client.query(
      `UPDATE analysis_processes
       SET status = $1, current_step = $2, progress = $3, error = $4, updated_at = NOW()
       WHERE process_id = $5`,
      [status, step, progress, error, processId],
    )
    await client.query(
      `UPDATE objects
       SET process_status = $1, process_step = $2, process_progress = $3, process_error = $4, updated_at = NOW()
       WHERE id = $5`,
      [status === 'COMPLETED' ? 'READY' : status, step, progress, error, objectId],
    )
  })
  publishProgress(objectId, {
    process_id: processId,
    process_status: status === 'COMPLETED' ? 'READY' : status,
    process_step: step,
    process_progress: progress,
    process_error: error,
  })
}

async function persistFileResult({ client, objectId, processId, file, result }) {
  const results = result.results_by_parameter || {}
  await client.query(
    `UPDATE files SET parse_status = 'COMPLETED', parse_error = NULL, page_count = $3 WHERE id = $1 AND object_id = $2`,
    [file.id, objectId, Number(result.parser?.pages || 0) || null],
  )
  await client.query(
    `UPDATE process_jobs
     SET status = 'COMPLETED', error = NULL, updated_at = NOW()
     WHERE process_id = $1 AND file_id = $2`,
    [processId, file.id],
  )

  for (const [code, evidenceList] of Object.entries(results)) {
    for (const [rank, evidence] of (evidenceList || []).slice(0, MAX_EVIDENCE_CANDIDATES).entries()) {
      const evidenceId = `ev-${file.id}-${code}-${rank + 1}`
      await client.query(
        `INSERT INTO evidence_fragments (id, object_id, file_id, page, fragment_type, text, bbox)
         VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb)
         ON CONFLICT (id) DO UPDATE SET page = EXCLUDED.page, text = EXCLUDED.text, bbox = EXCLUDED.bbox`,
        [evidenceId, objectId, file.id, evidence.page ?? null, `AI_SEARCH_${file.stage}`, truncate(evidence.text), JSON.stringify(evidence.bbox ?? null)],
      )
    }
  }
}

async function persistComparison({ client, objectId, comparisons, documents, parameters }) {
  const stages = new Set(documents.map((document) => document.file.stage))
  const bySection = new Map()
  for (const comparison of comparisons) {
    const { parameter } = comparison
    const occurrences = comparison.occurrences?.length ? comparison.occurrences : [comparison]
    const findingPrefix = `ai-${objectId}-${parameter.code}`
    const checkPrefix = `check-${objectId}-${parameter.code}`
    const findingIds = occurrences.map((_, index) => index === 0 ? findingPrefix : `${findingPrefix}-${index + 1}`)

    // При повторном запуске удаляем только старые автоматически созданные
    // результаты этого параметра. Подтверждённые инспектором нарушения
    // сохраняем, чтобы повторный анализ не стирал решение пользователя.
    await client.query(
      `DELETE FROM checks WHERE object_id = $1 AND (id = $2 OR id LIKE $3)`,
      [objectId, checkPrefix, `${checkPrefix}-%`],
    )
    await client.query(
      `DELETE FROM findings
       WHERE object_id = $1 AND discovery_method = $2
         AND (finding_id = $3 OR finding_id LIKE $4)
         AND NOT (finding_id = ANY($5::text[]))
         AND status <> 'CONFIRMED_VIOLATION'`,
      [objectId, AI_DISCOVERY_METHOD, findingPrefix, `${findingPrefix}-%`, findingIds],
    )

    for (const [index, occurrence] of occurrences.entries()) {
      const { evidence, status, confidence, expectedValue, actualValue, comparison: selectedComparison, description } = occurrence
      const findingId = findingIds[index]
      const pdSource = evidenceForFinding(evidence.PD, parameter)
      const rdSource = {
        RD: evidenceForFinding(evidence.RD, parameter),
        ID: evidenceForFinding(evidence.ID, parameter),
      }
      const checkId = index === 0 ? checkPrefix : `${checkPrefix}-${index + 1}`
      await client.query(
        `INSERT INTO checks (id, param_id, object_id, expected_value, actual_value, delta, completeness_status, finding_status, review_priority, evidence_group_id)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
         ON CONFLICT (id) DO UPDATE SET expected_value = EXCLUDED.expected_value, actual_value = EXCLUDED.actual_value,
           completeness_status = EXCLUDED.completeness_status, finding_status = EXCLUDED.finding_status,
           review_priority = EXCLUDED.review_priority, evidence_group_id = EXCLUDED.evidence_group_id, updated_at = NOW()`,
         [checkId, parameter.id, objectId, expectedValue, actualValue, null, ['MISSING_EVIDENCE', 'NOT_FOUND'].includes(status) ? 'MISSING' : 'PRESENT', status, parameter.priority || null, findingId],
      )
      await client.query(
        `INSERT INTO findings (finding_id, object_id, matrix_code, section, parameter_name, unit, status, review_priority, discovery_method, expected_value, actual_value, trigger_text, description, normative, confidence, pd_source, rd_source, comparison)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16::jsonb, $17::jsonb, $18::jsonb)
         ON CONFLICT (finding_id) DO UPDATE SET section = EXCLUDED.section, parameter_name = EXCLUDED.parameter_name,
           status = CASE WHEN findings.status = 'CONFIRMED_VIOLATION' THEN findings.status ELSE EXCLUDED.status END,
           expected_value = EXCLUDED.expected_value, actual_value = EXCLUDED.actual_value,
           description = EXCLUDED.description, confidence = EXCLUDED.confidence,
           pd_source = EXCLUDED.pd_source, rd_source = EXCLUDED.rd_source, comparison = EXCLUDED.comparison, updated_at = NOW()`,
        [findingId, objectId, parameter.code, parameter.section, parameter.parameter, parameter.unit || null, status, parameter.priority || null, AI_DISCOVERY_METHOD, expectedValue, actualValue, parameter.trigger_text || null, description, parameter.trigger_text || null, confidence, JSON.stringify(pdSource), JSON.stringify(rdSource), JSON.stringify(selectedComparison)],
      )
    }

    const section = bySection.get(parameter.section) || { parameters: 0, findings: 0, missing: 0 }
    section.parameters += 1
    section.findings += occurrences.length
    section.missing += occurrences.filter(({ status }) => ['MISSING_EVIDENCE', 'NOT_FOUND'].includes(status)).length
    bySection.set(parameter.section, section)
  }

  for (const [section, summary] of bySection) {
    const stageStatus = Object.fromEntries(STAGES.map((stage) => [stage, stages.has(stage) ? 'UPLOADED' : 'MISSING']))
    const note = `${summary.parameters} параметров матрицы; результатов: ${summary.findings}; без доказательств: ${summary.missing}`
    await client.query(
      `INSERT INTO completeness (object_id, section, pd_status, rd_status, id_status, note)
       VALUES ($1, $2, $3, $4, $5, $6)
       ON CONFLICT (object_id, section) DO UPDATE SET pd_status = EXCLUDED.pd_status, rd_status = EXCLUDED.rd_status,
         id_status = EXCLUDED.id_status, note = EXCLUDED.note`,
      [objectId, section, stageStatus.PD, stageStatus.RD, stageStatus.ID, note],
    )
  }

  return { stages: [...stages], parameterCount: parameters.length }
}

export async function runObjectAnalysis({ objectId, processId, req }) {
  try {
    const [filesResult, parametersResult] = await Promise.all([
      query('SELECT id, stage, name, mime_type, size, sha256, content FROM files WHERE object_id = $1 ORDER BY uploaded_at ASC', [objectId]),
      query('SELECT * FROM matrix_params ORDER BY id ASC'),
    ])
    const files = filesResult.rows.map((file) => ({ ...file, name: normalizeFilename(file.name) }))
    const parameters = parametersResult.rows
    if (!files.length) throw Object.assign(new Error('Нет документов для запуска проверки'), { code: 'DOCUMENTS_REQUIRED' })

    await updateProgress({ objectId, processId, status: 'PARSING', step: 'Подготовка документов', progress: 2 })
    for (const file of files) {
      await query(
        `INSERT INTO process_jobs (job_id, process_id, file_id)
         SELECT $1, $2, $3
         WHERE NOT EXISTS (SELECT 1 FROM process_jobs WHERE process_id = $2 AND file_id = $3)`,
        [randomUUID(), processId, file.id],
      )
    }
    await query(`UPDATE process_jobs SET status = 'PROCESSING', error = NULL, updated_at = NOW() WHERE process_id = $1`, [processId])

    const documents = []
    for (let index = 0; index < files.length; index += 1) {
      const file = files[index]
      const progress = 5 + Math.round((index / files.length) * 70)
      await updateProgress({ objectId, processId, status: 'PARSING', step: `Распознавание ${file.name}`, progress })
      const result = await processDocumentWithAi({
        objectId,
        processId,
        file,
        parameters: parameters.map((parameter) => ({
          code: parameter.code,
          parameter: parameter.parameter,
          section: parameter.section,
          unit: parameter.unit,
          source: stageSource(parameter, file.stage),
          trigger: parameter.trigger_text,
          stage: file.stage,
        })),
      })
      documents.push({ file, result })
      await withTransaction(async (client) => persistFileResult({ client, objectId, processId, file, result }))
    }

    await updateProgress({ objectId, processId, status: 'VERIFYING', step: 'Сопоставление ПД / РД / ИД', progress: 82 })
    const comparisons = parameters.map((parameter) => compareParameter(parameter, documents))
    const comparisonSummary = await withTransaction(async (client) => persistComparison({ client, objectId, comparisons, documents, parameters }))
    const stages = new Set(documents.map((document) => document.file.stage))
    const modelVersion = documents.find((document) => document.result.model?.name)?.result.model.name || 'construction-minilm-132'

    await withTransaction(async (client) => {
      await client.query(
        `UPDATE analysis_processes SET status = 'COMPLETED', current_step = 'Готово', progress = 100, error = NULL, updated_at = NOW() WHERE process_id = $1`,
        [processId],
      )
      await client.query(
        `UPDATE objects SET process_status = 'READY', scenario = $1, matrix_version = 'v1.1', dataset_version = 'matrix-132', model_version = $2,
         process_step = 'Готово', process_progress = 100, process_error = NULL, updated_at = NOW() WHERE id = $3`,
        [scenarioForStages(stages), modelVersion, objectId],
      )
      await recordAudit(client, { req, objectId, action: 'AI_ANALYSIS_COMPLETED', details: { processId, files: files.length, ...comparisonSummary, modelVersion } })
    })
    publishProgress(objectId, {
      process_id: processId,
      process_status: 'READY',
      process_step: 'Готово',
      process_progress: 100,
      process_error: null,
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    await withTransaction(async (client) => {
      await client.query(`UPDATE process_jobs SET status = 'FAILED', error = $1, updated_at = NOW() WHERE process_id = $2 AND status <> 'COMPLETED'`, [message, processId]).catch(() => {})
      await client.query(`UPDATE files SET parse_status = 'FAILED', parse_error = $1 WHERE object_id = $2 AND parse_status <> 'COMPLETED'`, [message, objectId]).catch(() => {})
      await client.query(`UPDATE analysis_processes SET status = 'FAILED', current_step = 'Ошибка', error = $1, updated_at = NOW() WHERE process_id = $2`, [message, processId]).catch(() => {})
      await client.query(`UPDATE objects SET process_status = 'FAILED', process_step = 'Ошибка обработки', process_error = $1, updated_at = NOW() WHERE id = $2`, [message, objectId]).catch(() => {})
      await recordAudit(client, { req, objectId, action: 'AI_ANALYSIS_FAILED', details: { processId, error: message } }).catch(() => {})
    })
    publishProgress(objectId, {
      process_id: processId,
      process_status: 'FAILED',
      process_step: 'Ошибка обработки',
      process_progress: 0,
      process_error: message,
    })
    console.error(`AI analysis failed for ${objectId}:`, message)
  }
}
