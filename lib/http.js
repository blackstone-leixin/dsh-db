/**
 * Minimal JSON body/response helpers for the /api/dsh-db routes: one bounded
 * body reader, one JSON writer. Kept local so the plugin depends on nothing
 * but the official SDK packages and its two database drivers.
 */

/** Default body cap (identifiers and SQL fit comfortably). */
const DEFAULT_JSON_BODY_MAX_BYTES = 256 * 1024

/**
 * Read a JSON body, bounded.
 * @param {import('node:http').IncomingMessage} req - request stream.
 * @param {number} [maxBytes] - cap in bytes.
 * @returns {Promise<unknown|null>} parsed JSON, or null on empty/invalid/oversized.
 */
export async function readJsonBody(req, maxBytes = DEFAULT_JSON_BODY_MAX_BYTES) {
  const chunks = []
  let size = 0
  for await (const chunk of req) {
    const buffer = /** @type {Buffer} */ (chunk)
    size += buffer.length
    if (size > maxBytes) {
      req.destroy()
      return null
    }
    chunks.push(buffer)
  }
  const text = Buffer.concat(chunks).toString('utf8')
  if (text === '') return null
  try {
    return JSON.parse(text)
  } catch {
    return null
  }
}

/**
 * Write one JSON response.
 * @param {import('node:http').ServerResponse} res - response.
 * @param {number} status - HTTP status.
 * @param {unknown} body - JSON-serializable body.
 */
export function writeJson(res, status, body) {
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    'referrer-policy': 'no-referrer',
  })
  res.end(JSON.stringify(body))
}
