/**
 * Relaunch helper for the DSH restart button.
 *
 * The host half starts this script detached, then stops the Electron main
 * process. This script waits for both DSH processes to exit, and only then
 * launches the app again: starting it earlier would hit the single-instance
 * lock or the listening port still held by the old instance.
 *
 * It intentionally uses only `node:` built-ins and no shell: DSH already runs
 * its Host as an Electron Node-mode child, so this file is launched the same
 * way and spawns the app with a clean environment.
 */
import { spawn } from 'node:child_process'
import { appendFileSync, existsSync, statSync, writeFileSync } from 'node:fs'
import { dirname, isAbsolute } from 'node:path'
import { fileURLToPath } from 'node:url'

/** How long the main process may stay alive after the host's reply. */
const MAIN_WAIT_MS = 5_000
/** How long the Host may take to finish its graceful shutdown. */
const HOST_WAIT_MS = 20_000
/** How long a process may take to die after this script force-stops it. */
const KILL_WAIT_MS = 3_000
/** Time for Windows to release the single-instance lock and the listening port. */
const PORT_RELEASE_MS = 900
/** Keep this process alive briefly after spawning, so the child is fully started. */
const KEEP_ALIVE_MS = 1_500
const POLL_MS = 120
const MAX_LOG_BYTES = 64 * 1024
const LOG_ENV_KEY = 'ELECTRON_RUN_AS_NODE'

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

/**
 * The environment used to launch the app again.
 *
 * The helper itself runs in Electron's Node mode, so its environment carries
 * `ELECTRON_RUN_AS_NODE=1`. Passing that to the app would start a short-lived
 * Node process instead of DSH, so every spelling of the flag is removed.
 */
export function launchEnvironment(environment = process.env) {
  const clean = { ...environment }
  for (const key of Object.keys(clean)) {
    if (key.toUpperCase() === LOG_ENV_KEY) delete clean[key]
  }
  return clean
}

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

/** Wait until `pid` exits; false when it is still alive at the deadline. */
export async function waitGone(pid, timeoutMs, {
  sleep: sleepFn = sleep,
  isAlive = processAlive,
} = {}) {
  const deadline = Date.now() + timeoutMs
  while (isAlive(pid)) {
    if (Date.now() >= deadline) return false
    await sleepFn(POLL_MS)
  }
  return true
}

function messageOf(error) {
  return String(error?.message ?? error)
}

/** Append one diagnostic line; rotate the file once it grows past the budget. */
function appendLog(logPath, message) {
  if (typeof logPath !== 'string' || logPath === '') return
  try {
    const line = `${new Date().toISOString()} ${message}\n`
    try {
      if (existsSync(logPath) && statSync(logPath).size > MAX_LOG_BYTES) writeFileSync(logPath, '')
    } catch {
      // Rotation is best effort; the append below still records the event.
    }
    appendFileSync(logPath, line, 'utf8')
  } catch {
    // Logging must never change the restart outcome.
  }
}

/** Read and validate the helper arguments. */
function parseArgs(argv) {
  const [mainPidText, hostPidText, exe] = argv
  const mainPid = Number.parseInt(String(mainPidText ?? ''), 10)
  const hostPid = Number.parseInt(String(hostPidText ?? ''), 10)
  if (!Number.isSafeInteger(mainPid) || mainPid <= 0) throw new Error('main pid is invalid')
  if (!Number.isSafeInteger(hostPid) || hostPid <= 0) throw new Error('host pid is invalid')
  if (typeof exe !== 'string' || exe === '' || !isAbsolute(exe) || !existsSync(exe)) throw new Error('executable is missing')
  return { mainPid, hostPid, exe }
}

/**
 * Wait for both DSH processes, then relaunch the app.
 *
 * @param {string[]} argv - mainPid, hostPid, executable, log path.
 * @param {object} [deps] - injectable for tests.
 * @returns {Promise<number>} process exit code.
 */
export async function run(argv, {
  sleep: sleepFn = sleep,
  spawnApp = (exe, environment) => spawn(exe, [], {
    detached: true,
    stdio: 'ignore',
    cwd: dirname(exe),
    env: environment,
  }),
  kill = (pid, signal) => process.kill(pid, signal),
  isAlive = processAlive,
} = {}) {
  const logPath = typeof argv[3] === 'string' ? argv[3] : ''
  const log = (message) => appendLog(logPath, message)

  let mainPid
  let hostPid
  let exe
  try {
    ({ mainPid, hostPid, exe } = parseArgs(argv))
  } catch (error) {
    log(`invalid arguments: ${messageOf(error)}`)
    return 1
  }

  log(`helper started main=${mainPid} host=${hostPid}`)

  if (!await waitGone(mainPid, MAIN_WAIT_MS, { sleep: sleepFn, isAlive })) {
    log('main still running; stopping it')
    try {
      kill(mainPid, 'SIGKILL')
    } catch (error) {
      log(`stop main failed: ${messageOf(error)}`)
    }
    await waitGone(mainPid, KILL_WAIT_MS, { sleep: sleepFn, isAlive })
  }

  if (!await waitGone(hostPid, HOST_WAIT_MS, { sleep: sleepFn, isAlive })) {
    log('host still running; stopping it')
    try {
      kill(hostPid, 'SIGKILL')
    } catch (error) {
      log(`stop host failed: ${messageOf(error)}`)
    }
    await waitGone(hostPid, KILL_WAIT_MS, { sleep: sleepFn, isAlive })
  }

  await sleepFn(PORT_RELEASE_MS)

  try {
    const child = spawnApp(exe, launchEnvironment())
    child?.unref?.()
    log(`launched ${exe} (pid ${child?.pid ?? 'unknown'})`)
  } catch (error) {
    log(`relaunch failed: ${messageOf(error)}`)
    return 1
  }

  await sleepFn(KEEP_ALIVE_MS)
  log('helper done')
  return 0
}

/** Whether this module is the process entry rather than an import in a test. */
function invokedDirectly() {
  if (typeof import.meta.main === 'boolean') return import.meta.main
  const entry = process.argv[1]
  if (typeof entry !== 'string') return false
  try {
    return fileURLToPath(import.meta.url).toLowerCase() === entry.toLowerCase()
  } catch {
    return false
  }
}

if (invokedDirectly()) {
  const argv = process.argv.slice(2)
  run(argv).then((code) => {
    process.exitCode = code
  }).catch((error) => {
    appendLog(typeof argv[3] === 'string' ? argv[3] : '', `fatal: ${messageOf(error)}`)
    process.exitCode = 1
  })
}
