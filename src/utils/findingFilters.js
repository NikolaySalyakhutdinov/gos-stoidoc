function hasValue(value) {
  if (value === null || value === undefined) return false
  const text = String(value).trim()
  if (!text || text === 'null' || text === 'undefined') return false
  if (text.startsWith('{') && /:\s*null\b/.test(text)) return false
  return true
}

function sourceValue(source) {
  if (!source || typeof source !== 'object') return null
  return source.normalized_value ?? source.extracted_value ?? source.value ?? source.text ?? null
}

export function hasBothComparisonValues(finding) {
  const leftSource = finding?.comparison?.left_source
  const rightSource = finding?.comparison?.right_source

  if (leftSource || rightSource) {
    return Boolean(leftSource && rightSource && hasValue(sourceValue(leftSource)) && hasValue(sourceValue(rightSource)))
  }

  return hasValue(finding?.expected_value) && hasValue(finding?.actual_value)
}
