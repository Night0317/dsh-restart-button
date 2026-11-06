import assert from 'node:assert/strict'
import { test } from 'node:test'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { apply, createRestartRoutes, desktopMainPid } from '../index.js'

const HELPER = fileURLToPath(new URL('../restart-helper.js', import.meta.url))
const LOG = join(tmpdir(), 'dsh-restart-button-test.log')
const DESKTOP_ENV = { ELECTRON_RUN_AS_NODE: '1' }

function makeReq(method) {
  return { method, headers: {}, resume() {} }
}

function makeRes() {
  return {
    statusCode: 0,
    headers: {},
    body: undefined,
    ended: false,
    setHeader(name, value) {
      this.headers[String(name).toLowerCase()] = value
    },
    end(body) {
      this.body = body
      this.ended = true
    },
  }
}

function makeRoutes(overrides = {}) {
  const spawned = []
  const killed = []
  const timers = []
  const routes = createRestartRoutes({
    platform: 'win32',
    environment: DESKTOP_ENV,
    parentPid: 4242,
    hostPid: 5252,
    execPath: process.execPath,
    helperPath: HELPER,
    logPath: LOG,
    isAlive: () => true,
    spawnHelper: (args) => {
      spawned.push(args)
      return { unref() {} }
    },
    killProcess: (pid) => killed.push(pid),
    schedule: (fn, ms) => {
      timers.push({ fn, ms })
      return { unref() {} }
    },
    ...overrides,
  })
  return { routes, spawned, killed, timers }
}

test('desktopMainPid only answers inside the desktop shell', () => {
  assert.equal(desktopMainPid({ environment: DESKTOP_ENV, parentPid: 10, isAlive: () => true }), 10)
  assert.equal(desktopMainPid({ environment: {}, parentPid: 10, isAlive: () => true }), undefined)
  assert.equal(desktopMainPid({ environment: DESKTOP_ENV, parentPid: 10, isAlive: () => false }), undefined)
})

test('GET status reports a restartable desktop host', () => {
  const { routes } = makeRoutes()
  const res = makeRes()
  routes.status(makeReq('GET'), res)
  assert.equal(res.statusCode, 200)
  assert.equal(res.headers['cache-control'], 'no-store')
  const body = JSON.parse(res.body)
  assert.deepEqual(body, {
    ok: true,
    desktop: true,
    supported: true,
    platform: 'win32',
    restarting: false,
  })
})

test('HEAD status answers without a body', () => {
  const { routes } = makeRoutes()
  const res = makeRes()
  routes.status(makeReq('HEAD'), res)
  assert.equal(res.statusCode, 200)
  assert.equal(res.body, undefined)
})

test('status reports a non-desktop host without hiding the route', () => {
  const { routes } = makeRoutes({ environment: {} })
  const res = makeRes()
  routes.status(makeReq('GET'), res)
  assert.equal(res.statusCode, 200)
  assert.equal(JSON.parse(res.body).desktop, false)
})

test('status reports an unsupported platform', () => {
  const { routes } = makeRoutes({ platform: 'darwin' })
  const res = makeRes()
  routes.status(makeReq('GET'), res)
  assert.equal(res.statusCode, 200)
  assert.equal(JSON.parse(res.body).supported, false)
})

test('POST restart spawns the helper once and schedules killing the main process', () => {
  const { routes, spawned, killed, timers } = makeRoutes()
  const res = makeRes()
  routes.restart(makeReq('POST'), res)

  assert.equal(res.statusCode, 202)
  assert.equal(JSON.parse(res.body).ok, true)
  assert.equal(spawned.length, 1)
  assert.deepEqual(spawned[0], [HELPER, '4242', '5252', process.execPath, LOG])

  const killTimer = timers.find((timer) => timer.ms === 600)
  assert.ok(killTimer, 'a 600ms kill timer is scheduled')
  assert.deepEqual(killed, [])
  killTimer.fn()
  assert.deepEqual(killed, [4242])
})

test('a repeated POST is idempotent while a restart is pending', () => {
  const { routes, spawned } = makeRoutes()
  routes.restart(makeReq('POST'), makeRes())
  const res = makeRes()
  routes.restart(makeReq('POST'), res)
  assert.equal(res.statusCode, 202)
  assert.equal(spawned.length, 1)
})

test('POST restart refuses a non-desktop host', () => {
  const { routes, spawned } = makeRoutes({ environment: {} })
  const res = makeRes()
  routes.restart(makeReq('POST'), res)
  assert.equal(res.statusCode, 409)
  assert.equal(JSON.parse(res.body).reason, 'not-desktop')
  assert.equal(spawned.length, 0)
})

test('POST restart refuses a non-Windows platform', () => {
  const { routes, spawned } = makeRoutes({ platform: 'linux' })
  const res = makeRes()
  routes.restart(makeReq('POST'), res)
  assert.equal(res.statusCode, 501)
  assert.equal(JSON.parse(res.body).reason, 'unsupported-platform')
  assert.equal(spawned.length, 0)
})

test('a helper spawn failure keeps the app running and reports 500', () => {
  const { routes, killed, timers } = makeRoutes({
    spawnHelper: () => {
      throw new Error('spawn failed')
    },
  })
  const res = makeRes()
  routes.restart(makeReq('POST'), res)
  assert.equal(res.statusCode, 500)
  assert.equal(JSON.parse(res.body).reason, 'helper-failed')
  assert.deepEqual(killed, [])
  assert.equal(timers.length, 0)
})

test('a missing helper is a 500 instead of a partial restart', () => {
  const { routes } = makeRoutes({ helperPath: join(tmpdir(), 'no-such-helper.js') })
  const res = makeRes()
  routes.restart(makeReq('POST'), res)
  assert.equal(res.statusCode, 500)
  assert.equal(JSON.parse(res.body).reason, 'helper-missing')
})

test('wrong methods answer 405 with the allowed method', () => {
  const { routes } = makeRoutes()
  const get = makeRes()
  routes.restart(makeReq('GET'), get)
  assert.equal(get.statusCode, 405)
  assert.equal(get.headers.allow, 'POST')

  const post = makeRes()
  routes.status(makeReq('POST'), post)
  assert.equal(post.statusCode, 405)
  assert.equal(post.headers.allow, 'GET, HEAD')
})

test('a rejected request never reaches the route logic', () => {
  const { routes, spawned } = makeRoutes({
    guard: (req, res) => {
      res.statusCode = 401
      res.end()
      return true
    },
  })
  const res = makeRes()
  routes.restart(makeReq('POST'), res)
  assert.equal(res.statusCode, 401)
  assert.equal(spawned.length, 0)
})

test('apply registers both handlers on the composition and delegates admission', () => {
  const registered = []
  const disposers = []
  let rejection
  let unregistered = false
  const ctx = {
    webServer: {
      register: (route) => {
        registered.push(route)
        return () => { unregistered = true }
      },
    },
    connection: {
      requestRejection: () => rejection,
    },
    effect: (fn) => {
      const dispose = fn()
      disposers.push(dispose)
      return dispose
    },
    logger: { info() {}, warn() {} },
  }

  apply(ctx)

  assert.deepEqual(registered.map((route) => route.path), [
    '/dsh-restart-button/status',
    '/dsh-restart-button/restart',
  ])
  assert.ok(registered.every((route) => route.kind === 'exact'))
  assert.ok(registered.every((route) => typeof route.handler === 'function'))
  assert.equal(disposers.length, 2)
  assert.ok(disposers.every((dispose) => typeof dispose === 'function'))

  rejection = 403
  const res = makeRes()
  registered[1].handler(makeReq('POST'), res)
  assert.equal(res.statusCode, 403)

  rejection = undefined
  const status = makeRes()
  registered[0].handler(makeReq('GET'), status)
  assert.equal(status.statusCode, 200)
  assert.equal(typeof JSON.parse(status.body).desktop, 'boolean')

  for (const dispose of disposers) dispose()
  assert.equal(unregistered, true, 'the routes are disposable with the plugin fiber')
})
