// Справочные статусы и словари согласно ТЗ "Инспектор ИИ"

export const PROCESS_STATUS = {
  PENDING: { label: 'Ожидает проверки', color: 'grey' },
  PARSING: { label: 'Идёт распознавание', color: 'blue' },
  READY: { label: 'Протокол сформирован', color: 'blue' },
  VERIFYING: { label: 'Верификация', color: 'yellow' },
  COMPLETED: { label: 'Верификация завершена', color: 'blue' },
  FINALIZED: { label: 'Протокол финализирован', color: 'green' },
  FAILED: { label: 'Ошибка проверки', color: 'red' },
}

export const DOC_STAGES = [
  { key: 'PD', label: 'Проектная документация', short: 'ПД', hint: 'Разделы ПЗ, СПЗУ, АР, КР, ИОС1–5, ПОС, ППМ, ОДИ, ЗУ, СМ и др.' },
  { key: 'RD', label: 'Рабочая документация', short: 'РД', hint: 'Основные комплекты рабочих чертежей, спецификации, ведомости' },
  { key: 'ID', label: 'Исполнительная документация', short: 'ИД', hint: 'Акты АОСР, исполнительные схемы, журналы работ, паспорта' },
]

export const UPLOAD_LIMITS = {
  maxFileMB: 50,
  maxTotalMB: 200,
  acceptedExt: ['.pdf', '.docx', '.xml'],
}

export const LOAD_STATUS = {
  UPLOADED: { label: 'загружена полностью', color: 'green' },
  PARTIAL: { label: 'загружена частично', color: 'yellow' },
  MISSING: { label: 'отсутствует', color: 'red' },
}

export const SCENARIOS = {
  FULL: 'Загружены ПД, РД и ИД — полная сверка по 132 параметрам',
  PD_RD_ONLY: 'Загружены ПД и РД, ИД отсутствует — сверка без исполнительной документации',
  PD_ID_ONLY: 'Загружены ПД и ИД, РД отсутствует',
  RD_ID_ONLY: 'Загружены РД и ИД, ПД отсутствует',
  SINGLE_ONLY: 'Загружен только один тип документации',
  PARTIALLY_LOADED: 'Документы загружены частично',
}

export const FINDING_STATUS = {
  CANDIDATE: {
    label: 'Кандидат', color: 'yellow',
    desc: 'Модель нашла предварительное расхождение с доказательными фрагментами',
  },
  CONFIRMED_VIOLATION: {
    label: 'Подтверждённое нарушение', color: 'red',
    desc: 'Кандидат подтверждён инспектором',
  },
  NEGATIVE_VERIFIED: {
    label: 'Отклонено (проверено)', color: 'green',
    desc: 'Сопоставимые актуальные источники проверены, расхождение не подтверждено',
  },
  MISSING_EVIDENCE: {
    label: 'Нет доказательств', color: 'grey',
    desc: 'Отсутствует обязательный документ или доказательный фрагмент',
  },
  NOT_APPLICABLE: {
    label: 'Неприменимо', color: 'grey',
    desc: 'Параметр или стадия неприменимы к объекту',
  },
  NOT_COMPARABLE: {
    label: 'Несопоставимо', color: 'grey',
    desc: 'Источники нельзя корректно сопоставить',
  },
  CLARIFICATION_REQUIRED: {
    label: 'Требуется уточнение', color: 'blue',
    desc: 'Не определена актуальная редакция либо есть противоречивые метаданные',
  },
  SUSPICION: {
    label: 'Гипотеза (вне матрицы)', color: 'purple',
    desc: 'Результат свободного поиска — не считается нарушением до решения инспектора',
  },
  PENDING: { label: 'Ожидает решения', color: 'yellow', desc: 'Кандидат ожидает решения инспектора' },
}

export const REASON_CODES = [
  { code: 'WRONG_REVISION', label: 'Актуальная редакция выбрана неверно' },
  { code: 'APPROVED_CHANGE', label: 'Есть согласованное изменение, отменяющее требование' },
  { code: 'OCR_ERROR', label: 'Ошибка распознавания (OCR)' },
  { code: 'LINK_ERROR', label: 'Ошибка привязки доказательства' },
  { code: 'NOT_APPLICABLE_PARAM', label: 'Параметр неприменим к объекту' },
  { code: 'OTHER', label: 'Иная причина (комментарий обязателен)' },
]

export const DISCOVERY_METHODS = {
  MATRIX: 'Матрица контроля (132 параметра)',
  LOGICAL_ANALYSIS: 'Свободный поиск · логический анализ',
  SEMANTIC_DISSONANCE: 'Свободный поиск · семантический диссонанс',
  NORMATIVE_ANALYSIS: 'Свободный поиск · нормативный анализ',
  ML_PATTERN: 'Свободный поиск · ML-паттерн-анализ',
}

export const OBJECT_STATUS_COLOR = {
  green: { color: 'green', label: 'Нарушений нет' },
  yellow: { color: 'yellow', label: 'Есть кандидаты, ожидают верификации' },
  red: { color: 'red', label: 'Есть подтверждённые нарушения' },
  grey: { color: 'grey', label: 'Проверка не запущена' },
}
