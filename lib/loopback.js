/**
 * Loopback trust fence for the /api/dsh-db route family.
 *
 * Adapted from @linxin666/dsh-ssh (Apache-2.0), which in turn generates it
 * from a shared dsh-web source: these routes carry database credentials and
 * execute SQL, so they must never be served to a LAN-exposed dsh web
 * deployment. Semantics: RFC 5735 IPv4 127/8, ::1, IPv4-mapped ::ffff:127/8,
 * localhost hostnames, plus the browser same-origin markers. A reverse proxy
 * (Cloudflare tunnel, frp, nginx) makes the socket and Host header describe
 * the proxy, so a request carrying forwarding headers is refused outright.
 */

/** IPv4 127/8 predicate. */
export function isIPv4Loopback(v4) {
  const parts = v4.split('.')
  return parts.length === 4
    && parts[0] === '127'
    && parts.every(part => /^\d{1,3}$/.test(part) && Number(part) <= 255)
}

/** Whether a socket remote address names the loopback range. */
export function isLoopbackAddress(address) {
  if (address === undefined) return false
  const normalized = address.toLowerCase()
  if (normalized === '::1') return true
  if (normalized.startsWith('::ffff:')) return isIPv4Loopback(normalized.slice('::ffff:'.length))
  return isIPv4Loopback(normalized)
}

/** Whether a URL hostname names the loopback authority. */
export function isLoopbackHostname(hostname) {
  if (hostname === 'localhost' || hostname === '[::1]') return true
  return isIPv4Loopback(hostname)
}

/** Whether a reverse proxy stood between the client and this host. */
export function isProxiedRequest(request) {
  return request.headers['cf-connecting-ip'] !== undefined
    || request.headers['x-forwarded-for'] !== undefined
}

/**
 * Request-level trust fence: a loopback socket address AND a loopback Host
 * header, plus browser same-origin markers.
 * @param {import('node:http').IncomingMessage} request - node HTTP request.
 * @returns {boolean} true when the request may reach a database route.
 */
export function isLoopbackRequest(request) {
  if (!isLoopbackAddress(request.socket.remoteAddress)) return false
  if (isProxiedRequest(request)) return false
  const host = request.headers.host
  if (typeof host !== 'string') return false
  let hostUrl
  try {
    hostUrl = new URL('http://' + host)
  } catch {
    return false
  }
  if (!isLoopbackHostname(hostUrl.hostname)) return false
  if (request.headers['sec-fetch-site'] === 'cross-site') return false
  const origin = request.headers.origin
  if (origin === undefined) return true
  try {
    return new URL(origin).host === hostUrl.host
  } catch {
    return false
  }
}
