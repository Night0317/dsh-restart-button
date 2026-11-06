/**
 * Host half of the restart button.
 *
 * DSH Desktop runs its Web GUI inside an Electron main process and spawns this
 * Host as a Node-mode child. Nothing in the stock shell lets a page call
 * `app.relaunch()`, and the page is not allowed to touch the shell. So the
 * plugin takes the portable route: the Web page asks this Host to restart, the
 * Host starts a detached helper, replies, and stops the Electron main process.
 * The helper waits for both DSH processes to exit and launches the app again.
 *
 * The route is registered on the composition's `webServer` and guarded with the
 * `connection` service's Host/Origin + browser-cookie admission, exactly like
 * the shipped open-in-app routes.
 */
import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

/** Local-only route prefix; the client half calls these exact paths. */
const ROUTE = '/dsh-restart-button'

/** Time between the reply and stopping the app, so the page receives the 202. */
const REPLY_GRACE_MS = 600

/** Last-resort Host exit when the desktop main process was already gone. */
const EXIT_FALLBACK_MS = 20_000

const HELPER = fileURLToPath(new URL('./restart-helper.js', import.meta.url))
const LOG_PATH = join(tmpdir(), 'dsh-restart-button.log')

/** Environment flag the desktop shell sets on the Host child. */
const DESKTOP_FLAG = 'ELECTRON_RUN_AS_NODE'

/** True while the process exists; EPERM means it exists but is not ours to signal. */
export function processAlive(pid) {
  if (!Number.isSafeInteger(pid) || pid <= 0) return false
  try {
    process.kill(pid, 0)
    return true
  } catch (error) {
    return error?.code === 'EPERM'
  }
}

/**
 * The Electron main process PID when this Host runs inside DSH Desktop, or
 * `undefined` for a plain `dsh web` Host (which has no shell to restart).
 */
export function desktopMainPid({
  environment = process.env,
  parentPid = process.ppid,
  isAlive = processAlive,
} = {}) {
  if (environment[DESKTOP_FLAG] !== '1') return undefined
  if (!Number.isSafeInteger(parentPid) || parentPid <= 0) return undefined
  return isAlive(parentPid) ? parentPid : undefined
}

/** JSON response with no store (status and restart outcomes are live facts). */
function sendJson(res, status, payload, headOnly = false) {
  res.statusCode = status
  res.setHeader('content-type', 'application/json; charset=utf-8')
  res.setHeader('cache-control', 'no-store')
  res.end(headOnly ? undefined : JSON.stringify(payload))
}

/** 405 with the route's one supported method (or method pair). */
function sendMethodNotAllowed(res, allow) {
  res.statusCode = 405
  res.setHeader('allow', allow)
  res.setHeader('content-type', 'text/plain; charset=utf-8')
  res.end('method not allowed')
}

/** Start the detached relaunch helper. Kept injectable for tests. */
function startHelper(execPath, args) {
  return spawn(execPath, args, {
    env: { ...process.env, [DESKTOP_FLAG]: '1' },
    detached: true,
    stdio: 'ignore',
    windowsHide: true,
  })
}

/**
 * Build the two route handlers.
 *
 * Dependencies are injectable so the host half is testable without a running
 * desktop app; `apply()` supplies the real process facts.
 *
 * @param {object} [options]
 * @param {string} [options.platform] - `process.platform` of the host.
 * @param {object} [options.environment] - host environment.
 * @param {number} [options.parentPid] - Electron main process PID (`process.ppid`).
 * @param {number} [options.hostPid] - this Host process PID.
 * @param {string} [options.execPath] - executable to relaunch.
 * @param {string} [options.helperPath] - detached helper script.
 * @param {string} [options.logPath] - helper log file.
 * @param {(req, res) => boolean} [options.guard] - returns true when the request was already rejected.
 * @param {(args: string[]) => object} [options.spawnHelper] - starts the helper.
 * @param {(pid: number) => void} [options.killProcess] - stops the main process.
 * @param {(fn: () => void, ms: number) => object} [options.schedule] - timer.
 * @param {(pid: number) => boolean} [options.isAlive] - process liveness probe.
 * @param {object} [options.logger] - optional Cordis logger.
 * @returns {{ status: Function, restart: Function }}
 */
export function createRestartRoutes({
  platform = process.platform,
  environment = process.env,
  parentPid = process.ppid,
  hostPid = process.pid,
  execPath = process.execPath,
  helperPath = HELPER,
  logPath = LOG_PATH,
  guard = () => false,
  spawnHelper = (args) => startHelper(execPath, args),
  killProcess = (pid) => process.kill(pid),
  schedule = (fn, ms) => setTimeout(fn, ms),
  isAlive = processAlive,
  logger = undefined,
} = {}) {
  const supported = platform === 'win32'
  let restarting = false

  const mainPid = () => desktopMainPid({ environment, parentPid, isAlive })

  function status(req, res) {
    if (guard(req, res)) return
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      sendMethodNotAllowed(res, 'GET, HEAD')
      return
    }
    sendJson(res, 200, {
      ok: true,
      desktop: mainPid() !== undefined,
      supported,
      platform,
      restarting,
    }, req.method === 'HEAD')
  }

  function restart(req, res) {
    if (guard(req, res)) return
    if (req.method !== 'POST') {
      sendMethodNotAllowed(res, 'POST')
      return
    }
    // The body is unused; drain it so the keep-alive socket stays healthy.
    req.resume?.()

    const pid = mainPid()
    if (pid === undefined) {
      sendJson(res, 409, { ok: false, reason: 'not-desktop' })
      return
    }
    if (!supported) {
      sendJson(res, 501, { ok: false, reason: 'unsupported-platform' })
      return
    }
    if (restarting) {
      sendJson(res, 202, { ok: true, scheduled: true, log: logPath })
      return
    }
    if (!existsSync(helperPath) || !existsSync(execPath)) {
      logger?.warn?.('[dsh-restart-button] helper or executable is missing')
      sendJson(res, 500, { ok: false, reason: 'helper-missing' })
      return
    }

    try {
      const child = spawnHelper([helperPath, String(pid), String(hostPid), String(execPath), logPath])
      child?.unref?.()
    } catch (error) {
      logger?.warn?.(`[dsh-restart-button] could not start relaunch helper: ${String(error?.message ?? error)}`)
      sendJson(res, 500, { ok: false, reason: 'helper-failed' })
      return
    }

    restarting = true
    logger?.info?.(`[dsh-restart-button] scheduling restart (main pid ${pid})`)
    sendJson(res, 202, { ok: true, scheduled: true, log: logPath })

    schedule(() => {
      try {
        killProcess(pid)
      } catch (error) {
        // The app may already be gone; the helper still relaunches it.
        logger?.warn?.(`[dsh-restart-button] main process was already gone: ${String(error?.message ?? error)}`)
      }
    }, REPLY_GRACE_MS)

    // The Host normally exits through its IPC-disconnect shutdown once the
    // Electron main process dies. This timer only guards against a Host that
    // never observes the disconnect.
    const exitTimer = schedule(() => process.exit(0), EXIT_FALLBACK_MS)
    exitTimer?.unref?.()
  }

  return { status, restart }
}

/** Cordis plugin: the Web carrier and the trust fence guarding every route. */
export const inject = ['webServer', 'connection']

/** Register the status and restart routes on the composition. */
export function apply(ctx) {
  const routes = createRestartRoutes({
    guard: (req, res) => {
      const rejection = ctx.connection.requestRejection(req)
      if (rejection === undefined) return false
      res.statusCode = rejection
      res.setHeader('content-type', 'text/plain; charset=utf-8')
      res.end(rejection === 401 ? 'unauthorized' : 'forbidden')
      return true
    },
    logger: ctx.logger,
  })

  ctx.effect(() => ctx.webServer.register({
    kind: 'exact',
    path: `${ROUTE}/status`,
    handler: routes.status,
  }), `dsh-restart-button: GET ${ROUTE}/status`)

  ctx.effect(() => ctx.webServer.register({
    kind: 'exact',
    path: `${ROUTE}/restart`,
    handler: routes.restart,
  }), `dsh-restart-button: POST ${ROUTE}/restart`)

  ctx.logger?.info?.('[dsh-restart-button] restart routes registered')
}
