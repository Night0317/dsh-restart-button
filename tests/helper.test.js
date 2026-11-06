import assert from 'node:assert/strict'
import { test } from 'node:test'
import { spawn } from 'node:child_process'
import { mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { launchEnvironment, run, waitGone } from '../restart-helper.js'

const HELPER = fileURLToPath(new URL('../restart-helper.js', import.meta.url))

/** Run the helper with ignored stdio (piped stdio is unavailable in some sandboxes). */
function runHelper(args) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [HELPER, ...args], {
      stdio: 'ignore',
      windowsHide: true,
    })
    child.once('error', reject)
    child.once('close', (code) => resolve(code))
  })
}

test('launchEnvironment removes the Node-mode flag in any casing', () => {
  const environment = launchEnvironment({
    ELECTRON_RUN_AS_NODE: '1',
    electron_run_as_node: '1',
    KEEP: 'yes',
  })
  assert.equal(environment.KEEP, 'yes')
  assert.equal(
    Object.keys(environment).some((key) => key.toUpperCase() === 'ELECTRON_RUN_AS_NODE'),
    false,
  )
})

test('waitGone waits for a process and gives up at the deadline', async () => {
  let alive = true
  const gone = await waitGone(10, 500, {
    isAlive: () => alive,
    sleep: async () => { alive = false },
  })
  assert.equal(gone, true)

  const stillAlive = await waitGone(10, 0, {
    isAlive: () => true,
    sleep: async () => {},
  })
  assert.equal(stillAlive, false)
})

test('run relaunches once with a clean environment', async () => {
  const calls = []
  const spawnedWith = []
  const code = await run(['10', '20', process.execPath, ''], {
    isAlive: () => false,
    sleep: async (ms) => { calls.push(ms) },
    spawnApp: (exe, environment) => {
      spawnedWith.push({ exe, environment })
      return { pid: 99, unref() {} }
    },
  })
  assert.equal(code, 0)
  assert.equal(spawnedWith.length, 1)
  assert.equal(spawnedWith[0].exe, process.execPath)
  assert.equal(spawnedWith[0].environment.ELECTRON_RUN_AS_NODE, undefined)
  assert.ok(calls.includes(900))
})

test('run rejects invalid arguments without spawning', async () => {
  let spawned = false
  const code = await run(['0', '20', process.execPath, ''], {
    isAlive: () => false,
    sleep: async () => {},
    spawnApp: () => { spawned = true; return { unref() {} } },
  })
  assert.equal(code, 1)
  assert.equal(spawned, false)
})

test('the helper script relaunches a stand-in executable', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'dsh-restart-button-helper-'))
  const logPath = join(directory, 'helper.log')

  // PIDs that cannot exist: both waits return immediately, then the helper
  // launches node with no script, which exits by itself.
  const code = await runHelper(['2147483000', '2147483001', process.execPath, logPath])
  assert.equal(code, 0)

  const log = readFileSync(logPath, 'utf8')
  assert.match(log, /helper started main=2147483000/)
  assert.match(log, /launched /)
  assert.match(log, /helper done/)
})
