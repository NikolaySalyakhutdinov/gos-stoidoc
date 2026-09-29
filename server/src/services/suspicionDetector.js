const DISCOVERY_METHODS = new Set([
  'LOGICAL_ANALYSIS',
  'SEMANTIC_DISSONANCE',
  'NORMATIVE_ANALYSIS',
  'ML_PATTERN',
])

const SEMANTIC_PAIRS = [
  { left: /техническ\w*/i, right: /склад\s+гсм|горюче[- ]смазочн/i, label: 'техническое помещение / склад ГСМ' },
  { left: /жил\w*|квартир\w*/i, right: /производствен\w*|цех\w*/i, label: 'жилое назначение / производственное назначение' },
  { left: /офис\w*|административн\w*/i, right: /склад\w*|производствен\w*/i, label: 'офисное назначение / складское или производственное назначение' },
]

function chunksFor(documents, stage = null) {
  return documents
    .filter((document) => !stage || document.file.stage === stage)
    .flatMap((document) => (document.result.searchable_chunks || [])
      .filter((chunk) => chunk.searchable !== false && chunk.content_kind !== 'drawing_dimension' && String(chunk.text || '').trim())
      .map((chunk) => ({ document, chunk })))
}

function sourceFrom(item) {
  if (!item) return null
  const { document, chunk } = item
  return {
    file_id: document.file.id,
    file_name: document.file.name,
    file_size: Number(document.file.size || 0),
    mime_type: document.file.mime_type || null,
    sha256: document.file.sha256 || null,
    page_count: Number(document.result.parser?.pages || 0) || null,
    page: chunk.page ?? null,
    bbox: chunk.bbox ?? null,
    text: String(chunk.text || '').slice(0, 900),
    source: document.file.name,
    source_hint: document.result.document_metadata?.document_code || document.file.name,
    stage: document.file.stage,
    section: chunk.section || null,
    chunk_id: chunk.id || null,
    content_kind: chunk.content_kind || 'text',
  }
}

function reference(source) {
  if (!source) return null
  const page = source.page ? `, стр.${source.page}` : ''
  return `${source.file_name}${page}`
}

function revisionKey(documents) {
  return documents
    .map((document) => `${document.file.stage}:${document.result.document_metadata?.revision || document.file.sha256 || document.file.id}`)
    .sort()
    .join('|')
}

function normalizedKey(value) {
  return String(value || '').toLocaleLowerCase('ru-RU').replace(/[^a-zа-яё0-9]+/gi, '_').replace(/^_|_$/g, '').slice(0, 120)
}

function makeHypothesis({ method, confidence, description, priority = 'MEDIUM', normativeBase = null, signature, pd, rd, id, details }, documents) {
  if (!DISCOVERY_METHODS.has(method)) throw new Error(`Unsupported suspicion method: ${method}`)
  const allSources = [pd, rd, id].filter(Boolean)
  const left = pd || rd || id
  const right = rd || id || (pd && allSources.length > 1 ? allSources[1] : null)
  const revision = revisionKey(documents)
  return {
    discovery_method: method,
    confidence: Math.max(0, Math.min(1, Number(confidence) || 0)),
    description,
    pd_reference: reference(pd),
    rd_reference: reference(rd || id),
    review_priority: priority,
    normative_base: normativeBase,
    pd_source: pd || null,
    rd_source: { RD: rd || null, ID: id || null },
    comparison: {
      left_stage: left?.stage || null,
      right_stage: right?.stage || null,
      relation: 'SUSPICION',
      left_source: left || null,
      right_source: right || null,
      suspicion: { discovery_method: method, ...details },
    },
    dedup_key: `${method}:${revision}:${normalizedKey(signature)}`,
  }
}

function detectLogical(documents) {
  const floorItems = chunksFor(documents).filter(({ chunk }) => /(?:этаж(?:ей|а|и)?|этажность)\D{0,12}\d+|\d+\s*этаж/i.test(chunk.text))
  const floorItem = floorItems.find(({ chunk }) => {
    const match = chunk.text.match(/(\d{1,3})\s*этаж|этаж(?:ей|а|и)?\D{0,12}(\d{1,3})/i)
    return Number(match?.[1] || match?.[2] || 0) > 10
  })
  if (!floorItem) return []

  const rdItems = chunksFor(documents, 'RD')
  if (!rdItems.length || rdItems.some(({ chunk }) => /лифтов\w*|лифт\b|подъёмник\w*|подъемник\w*/i.test(chunk.text))) return []
  const floorMatch = floorItem.chunk.text.match(/(\d{1,3})\s*этаж|этаж(?:ей|а|и)?\D{0,12}(\d{1,3})/i)
  const floors = Number(floorMatch?.[1] || floorMatch?.[2])
  const rdContext = rdItems.find(({ chunk }) => /шахт|вертикальн|лестниц|эвакуац/i.test(chunk.text)) || rdItems[0]
  return [makeHypothesis({
    method: 'LOGICAL_ANALYSIS',
    confidence: 0.87,
    priority: 'HIGH',
    description: `В РД не найдено лифтовой шахты или лифта при ${floors} этажах. Требуется проверить логическое правило «при количестве этажей более 10 должна быть предусмотрена вертикальная транспортная связь».`,
    signature: `floors_gt_10_without_lift:${floors}`,
    pd: sourceFrom(floorItem),
    rd: sourceFrom(rdContext),
    details: { rule_code: 'FLOORS_GT_10_REQUIRES_LIFT', floors, missing_anchor: 'lift' },
  }, documents)]
}

function detectSemanticDissonance(documents) {
  const pdItems = chunksFor(documents, 'PD')
  const rdItems = chunksFor(documents, 'RD')
  const result = []
  for (const pair of SEMANTIC_PAIRS) {
    const left = pdItems.find(({ chunk }) => pair.left.test(chunk.text))
    const right = rdItems.find(({ chunk }) => pair.right.test(chunk.text))
    if (!left || !right) continue
    result.push(makeHypothesis({
      method: 'SEMANTIC_DISSONANCE',
      confidence: 0.78,
      priority: 'HIGH',
      description: `В терминологии ПД и РД обнаружено потенциальное расхождение: ${pair.label}. Требуется проверить актуальность назначения и редакций документов.`,
      signature: pair.label,
      pd: sourceFrom(left),
      rd: sourceFrom(right),
      details: { left_term: left.chunk.text.slice(0, 180), right_term: right.chunk.text.slice(0, 180) },
    }, documents))
  }
  return result
}

function detectNormative(documents) {
  const items = chunksFor(documents).filter(({ chunk }) => /высот\w{0,8}\s+(?:комнат|помещ|жил)|высота\s+(?:комнат|помещ|жил)/i.test(chunk.text))
  const result = []
  for (const item of items) {
    const match = item.chunk.text.match(/(\d+(?:[.,]\d+)?)\s*(?:м|метр\w*)/i)
    const value = Number(String(match?.[1] || '').replace(',', '.'))
    if (!Number.isFinite(value) || value >= 2.5) continue
    const source = sourceFrom(item)
    result.push(makeHypothesis({
      method: 'NORMATIVE_ANALYSIS',
      confidence: 0.74,
      priority: 'HIGH',
      normativeBase: 'CONFIGURED_RULE: ROOM_HEIGHT_MIN_2_5M',
      description: `В документе указана высота помещений ${String(match[1]).replace('.', ',')} м, что ниже настроенного нормативного порога 2,5 м. Требуется проверить применимый СП/ГОСТ/СанПиН и редакцию документа.`,
      signature: `room_height_below_2_5:${value}`,
      pd: item.document.file.stage === 'PD' ? source : null,
      rd: item.document.file.stage === 'RD' ? source : null,
      id: item.document.file.stage === 'ID' ? source : null,
      details: { rule_code: 'ROOM_HEIGHT_MIN_2_5M', observed_value_m: value, threshold_m: 2.5 },
    }, documents))
  }
  return result
}

function numericMetric(item) {
  if (!/(расход|объ[её]м|масса|количеств|потреблен|бетон|материал)/i.test(item.chunk.text)) return null
  const match = item.chunk.text.match(/(-?\d+(?:[.,]\d+)?)\s*(м³|м3|т|кг|шт\.?|%)/i)
  if (!match) return null
  return { value: Number(match[1].replace(',', '.')), unit: match[2].toLocaleLowerCase('ru-RU'), label: normalizedKey(item.chunk.text.replace(match[0], '')) }
}

function detectMlPatterns(documents) {
  const metrics = chunksFor(documents).map((item) => ({ item, metric: numericMetric(item) })).filter(({ metric }) => metric && Number.isFinite(metric.value))
  const result = []
  for (let index = 0; index < metrics.length; index += 1) {
    for (let rightIndex = index + 1; rightIndex < metrics.length; rightIndex += 1) {
      const left = metrics[index]
      const right = metrics[rightIndex]
      if (left.item.document.file.stage === right.item.document.file.stage || left.metric.unit !== right.metric.unit) continue
      const sameMetric = left.metric.label && right.metric.label && left.metric.label.slice(0, 18) === right.metric.label.slice(0, 18)
      if (!sameMetric) continue
      const baseline = Math.max(left.metric.value, right.metric.value)
      const observed = Math.min(left.metric.value, right.metric.value)
      if (!baseline || (baseline - observed) / baseline < 0.2) continue
      const lower = left.metric.value <= right.metric.value ? left.item : right.item
      const higher = left.metric.value > right.metric.value ? left.item : right.item
      result.push(makeHypothesis({
        method: 'ML_PATTERN',
        confidence: Math.min(0.95, 0.65 + (baseline - observed) / baseline),
        priority: 'MEDIUM',
        description: `Обнаружен аномальный паттерн: значение ${observed} ${left.metric.unit} ниже сопоставимого значения ${baseline} ${left.metric.unit} на ${Math.round((baseline - observed) / baseline * 100)}%. Требуется проверить исходные объёмы и редакции документов.`,
        signature: `metric_deviation:${left.metric.label}:${observed}:${baseline}`,
        pd: lower.document.file.stage === 'PD' ? sourceFrom(lower) : higher.document.file.stage === 'PD' ? sourceFrom(higher) : null,
        rd: lower.document.file.stage === 'RD' ? sourceFrom(lower) : higher.document.file.stage === 'RD' ? sourceFrom(higher) : null,
        id: lower.document.file.stage === 'ID' ? sourceFrom(lower) : higher.document.file.stage === 'ID' ? sourceFrom(higher) : null,
        details: { baseline, observed, deviation_ratio: (baseline - observed) / baseline, baseline_source: reference(sourceFrom(higher)), observed_source: reference(sourceFrom(lower)) },
      }, documents))
    }
  }
  return result.slice(0, 20)
}

export function detectSuspicions(documents) {
  const all = [
    ...detectLogical(documents),
    ...detectSemanticDissonance(documents),
    ...detectNormative(documents),
    ...detectMlPatterns(documents),
  ]
  const unique = new Map()
  for (const item of all) unique.set(item.dedup_key, item)
  return [...unique.values()]
}
