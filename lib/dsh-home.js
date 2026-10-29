/**
 * DSH_HOME resolution shared by this plugin's host modules. Mirrors the
 * convention used by the installed dsh-ssh plugin: a non-empty DSH_HOME
 * environment override wins, the platform home fallback follows.
 */

import { homedir } from 'node:os'
import { isAbsolute, join } from 'node:path'

/** Expand a leading `~` in a path, platform-style. */
function expandHome(path, home) {
  if (path === '~') return home
  if (path.startsWith('~/') || path.startsWith('~\\')) return join(home, path.slice(2))
  return path
}

/**
 * Resolve the DSH home directory.
 * @param {NodeJS.ProcessEnv} [env] - environment to read DSH_HOME from.
 * @param {string} [home] - platform home directory fallback.
 * @returns {string} absolute DSH home path.
 */
export function resolveDshHome(env = process.env, home = homedir()) {
  const raw = env.DSH_HOME
  if (raw !== undefined && raw.trim() !== '') {
    const expanded = expandHome(raw.trim(), home)
    return isAbsolute(expanded) ? expanded : join(process.cwd(), expanded)
  }
  return join(home, '.dsh')
}

/** Resolve the DSH home directory from the live environment. */
export function dshHome() {
  return resolveDshHome()
}
