import { randomUUID } from 'node:crypto'
import { query, withTransaction } from '../db.js'
import { recordAudit } from '../utils/http.js'
import { processDocumentWithAi } from './aiGateway.js'

const STAGES = ['PD', 'RD', 'ID']
const AI_DISCOVERY_METHOD = 'AI_SEMANTIC_COMPARATOR'

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

function comparableValues(text) {
  return new Set([...tokens(text)].filter((value) => /\d/.test(value)))
}

function intersectionSize(sets) {
  if (!sets.length || sets.some((set) => set.size === 0)) return 0
  const [first, ...rest] = sets
  return [...first].filter((value) => rest.every((set) => set.has(value))).length
}

function topEvidence(documents, stage, code) {
  const candidates = documents
    .filter((document) => document.file.stage === stage)
    .flatMap((document) => (document.result.results_by_parameter?.[code] || []).map((item) => ({ ...item, file: document.file })))
    .sort((left, right) => Number(right.rank_score ?? right.semantic_score ?? 0) - Number(left.rank_score ?? left.semantic_score ?? 0))
  return candidates[0] || null
}

function evidenceForFinding(evidence) {
  if (!evidence) return null
  return {
    file_id: evidence.file.id,
    file_name: evidence.file.name,
    stage: evidence.file.stage,
    page: evidence.page ?? null,
    bbox: evidence.bbox ?? null,
    text: truncate(evidence.text),
    semantic_score: evidence.semantic_score ?? null,
    rank_score: evidence.rank_score ?? null,
  }
}

function compareParameter(parameter, documents) {
  const evidence = Object.fromEntries(STAGES.map((stage) => [stage, topEvidence(documents, stage, parameter.code)]))
  const requiredStages = STAGES.filter((stage) => String(stageSource(parameter, stage) || '').trim())
  const presentStages = STAGES.filter((stage) => evidence[stage])
  const comparisonStages = requiredStages.length ? requiredStages : presentStages
  const comparisonEvidence = comparisonStages.map((stage) => evidence[stage]).filter(Boolean)
  const snippets = Object.fromEntries(STAGES.map((stage) => [stage, evidence[stage] ? truncate(evidence[stage].text, 1500) : null]))
  const scoreValues = presentStages.map((stage) => Number(evidence[stage].semantic_score ?? evidence[stage].rank_score ?? 0)).filter(Number.isFinite)
  const confidence = scoreValues.length ? Math.max(0, Math.min(1, scoreValues.reduce((sum, value) => sum + value, 0) / scoreValues.length)) : null

  let status = 'MISSING_EVIDENCE'
  let description = `Недостаточно доказательств для параметра «${parameter.parameter}».`
  if (comparisonStages.length && comparisonEvidence.length < comparisonStages.length) {
    const missing = comparisonStages.filter((stage) => !evidence[stage]).map(stageLabel).join(', ')
    description = `Не найдены сопоставимые фрагменты: ${missing}.`
  } else if (comparisonEvidence.length >= 2) {
    const valueSets = comparisonEvidence.map((item) => comparableValues(item.text))
    if (valueSets.every((set) => set.size > 0) && intersectionSize(valueSets) > 0) {
      status = 'NEGATIVE_VERIFIED'
      description = 'В найденных фрагментах ПД, РД и ИД совпадают извлечённые числовые или кодовые значения.'
    } else if (valueSets.every((set) => set.size > 0)) {
      status = 'CANDIDATE'
      description = 'Найдены семантически связанные, но различающиеся числовые или кодовые значения; требуется проверка инспектора.'
    } else {
      status = 'CLARIFICATION_REQUIRED'
      description = 'Фрагменты найдены, но автоматическое извлечение сопоставимого значения неоднозначно.'
    }
  } else if (comparisonEvidence.length === 1 && comparisonStages.length <= 1) {
    status = 'CLARIFICATION_REQUIRED'
    description = 'Найден один источник; автоматическое сравнение редакций невозможно.'
  }

  return {
    parameter,
    evidence,
    status,
    confidence,
    expectedValue: snippets.PD,
    actualValue: JSON.stringify({ RD: snippets.RD, ID: snippets.ID }, null, 0),
    description,
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
}

async function persistFileResult({ client, objectId, processId, file, result }) {
  const results = result.results_by_parameter || {}
  await client.query(
    `UPDATE files SET parse_status = 'COMPLETED', parse_error = NULL WHERE id = $1 AND object_id = $2`,
    [file.id, objectId],
  )
  await client.query(
    `UPDATE process_jobs
     SET status = 'COMPLETED', error = NULL, updated_at = NOW()
     WHERE process_id = $1 AND file_id = $2`,
    [processId, file.id],
  )

  for (const [code, evidenceList] of Object.entries(results)) {
    for (const [rank, evidence] of (evidenceList || []).slice(0, 5).entries()) {
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
    const { parameter, evidence, status, confidence, expectedValue, actualValue, description } = comparison
    const findingId = `ai-${objectId}-${parameter.code}`
    const pdSource = evidenceForFinding(evidence.PD)
    const rdSource = {
      RD: evidenceForFinding(evidence.RD),
      ID: evidenceForFinding(evidence.ID),
    }
    const checkId = `check-${objectId}-${parameter.code}`
    await client.query(
      `INSERT INTO checks (id, param_id, object_id, expected_value, actual_value, delta, completeness_status, finding_status, review_priority, evidence_group_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
       ON CONFLICT (id) DO UPDATE SET expected_value = EXCLUDED.expected_value, actual_value = EXCLUDED.actual_value,
         completeness_status = EXCLUDED.completeness_status, finding_status = EXCLUDED.finding_status,
         review_priority = EXCLUDED.review_priority, updated_at = NOW()`,
      [checkId, parameter.id, objectId, expectedValue, actualValue, null, status === 'MISSING_EVIDENCE' ? 'MISSING' : 'PRESENT', status, parameter.priority || null, findingId],
    )
    await client.query(
      `INSERT INTO findings (finding_id, object_id, matrix_code, section, parameter_name, unit, status, review_priority, discovery_method, expected_value, actual_value, trigger_text, description, normative, confidence, pd_source, rd_source)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16::jsonb, $17::jsonb)
       ON CONFLICT (finding_id) DO UPDATE SET section = EXCLUDED.section, parameter_name = EXCLUDED.parameter_name,
         status = CASE WHEN findings.status = 'CONFIRMED_VIOLATION' THEN findings.status ELSE EXCLUDED.status END,
         expected_value = EXCLUDED.expected_value, actual_value = EXCLUDED.actual_value,
         description = EXCLUDED.description, confidence = EXCLUDED.confidence,
         pd_source = EXCLUDED.pd_source, rd_source = EXCLUDED.rd_source, updated_at = NOW()`,
      [findingId, objectId, parameter.code, parameter.section, parameter.parameter, parameter.unit || null, status, parameter.priority || null, AI_DISCOVERY_METHOD, expectedValue, actualValue, parameter.trigger_text || null, description, parameter.trigger_text || null, confidence, JSON.stringify(pdSource), JSON.stringify(rdSource)],
    )

    const section = bySection.get(parameter.section) || { count: 0, missing: 0 }
    section.count += 1
    if (status === 'MISSING_EVIDENCE') section.missing += 1
    bySection.set(parameter.section, section)
  }

  for (const [section, summary] of bySection) {
    const stageStatus = Object.fromEntries(STAGES.map((stage) => [stage, stages.has(stage) ? 'UPLOADED' : 'MISSING']))
    const note = `${summary.count} параметров матрицы; без доказательств: ${summary.missing}`
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
    const files = filesResult.rows
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
        parameters: parameters.map((parameter) => ({ code: parameter.code, parameter: parameter.parameter, trigger: parameter.trigger_text })),
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
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    await withTransaction(async (client) => {
      await client.query(`UPDATE process_jobs SET status = 'FAILED', error = $1, updated_at = NOW() WHERE process_id = $2 AND status <> 'COMPLETED'`, [message, processId]).catch(() => {})
      await client.query(`UPDATE files SET parse_status = 'FAILED', parse_error = $1 WHERE object_id = $2 AND parse_status <> 'COMPLETED'`, [message, objectId]).catch(() => {})
      await client.query(`UPDATE analysis_processes SET status = 'FAILED', current_step = 'Ошибка', error = $1, updated_at = NOW() WHERE process_id = $2`, [message, processId]).catch(() => {})
      await client.query(`UPDATE objects SET process_status = 'FAILED', process_step = 'Ошибка обработки', process_error = $1, updated_at = NOW() WHERE id = $2`, [message, objectId]).catch(() => {})
      await recordAudit(client, { req, objectId, action: 'AI_ANALYSIS_FAILED', details: { processId, error: message } }).catch(() => {})
    })
    console.error(`AI analysis failed for ${objectId}:`, message)
  }
}
