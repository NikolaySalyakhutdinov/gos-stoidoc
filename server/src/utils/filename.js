const MOJIBAKE_MARKERS = /[ÃÂÐÑ]/

/**
 * Repairs UTF-8 filenames that were decoded as Latin-1 by a multipart parser.
 * For example, "ПД.pdf" can arrive as "Ð\x9FÐ\x94.pdf" depending on the client.
 */
export function normalizeFilename(value) {
  const name = String(value ?? '').replaceAll(String.fromCharCode(0), '')
  if (!MOJIBAKE_MARKERS.test(name)) return name

  try {
    const decoded = Buffer.from(name, 'latin1').toString('utf8')
    if (!decoded.includes('\uFFFD') && decoded !== name) return decoded
  } catch {
    // Keep the original name when it is not a valid Latin-1/UTF-8 sequence.
  }

  return name
}
