import assert from 'node:assert/strict'
import { test } from 'node:test'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import vm from 'node:vm'

const SOURCE = readFileSync(fileURLToPath(new URL('../client.js', import.meta.url)), 'utf8')

function loadClient() {
  let loaded
  const styles = []

  const sandbox = {
    console,
    setTimeout,
    clearTimeout,
    fetch: async () => ({ ok: false }),
    document: {
      head: { appendChild: (node) => { styles.push(node) } },
      createElement: () => ({ dataset: {}, textContent: '', remove() {} }),
    },
  }
  sandbox.window = sandbox
  sandbox.__ModuleLoader__ = { load: (definition) => { loaded = definition } }

  vm.createContext(sandbox)
  vm.runInContext(SOURCE, sandbox, { filename: 'client.js' })

  assert.ok(loaded, 'the loader definition is registered')
  assert.equal(loaded.id, 'dsh-restart-button')

  const react = {
    createElement: (type, props, ...children) => ({ type, props: props ?? {}, children }),
    useState: (initial) => [initial, () => {}],
    useEffect: () => {},
  }
  const module = loaded.factory((name) => {
    if (name === 'react') return react
    throw new Error(`unexpected require: ${name}`)
  })

  return { module, sandbox, styles }
}

function makeContext(state) {
  return {
    effect: (fn, label) => {
      state.effects.push(label)
      const dispose = fn()
      return typeof dispose === 'function' ? dispose : () => {}
    },
    locale: {
      register: (ns, dict) => {
        state.locales.push({ ns, dict })
        return () => {}
      },
    },
    slots: {
      inject: (name, declare) => declare(),
      register: (options, component) => {
        state.registrations.push({ options, component })
        return () => {}
      },
    },
  }
}

function makeState() {
  return { locales: [], registrations: [], effects: [] }
}

test('the client half declares the expected plugin faces', () => {
  const { module } = loadClient()
  // The array is created in the VM realm, so compare its contents, not its prototype.
  assert.equal(Array.from(module.inject).join(','), 'slots,locale')
  assert.equal(typeof module.apply, 'function')
  assert.equal(SOURCE.includes('location.reload'), false)
})

test('apply installs styles, locale and the footer slot entry', () => {
  const { module, styles } = loadClient()
  const state = makeState()
  module.apply(makeContext(state))

  assert.equal(styles.length, 1)
  assert.equal(styles[0].dataset.dshPlugin, 'dsh-restart-button')
  assert.ok(styles[0].textContent.includes('dsh-restart-row'))
  assert.equal(state.locales.length, 1)
  assert.equal(state.locales[0].ns, 'dsh-restart-button')
  assert.equal(state.locales[0].dict.zh.label, '重启 DSH')
  assert.equal(state.locales[0].dict.en.label, 'Restart DSH')
  assert.equal(state.registrations.length, 1)
  assert.equal(state.registrations[0].options.name, 'sidebar.footer.action')
  assert.equal(state.registrations[0].options.id, 'dsh-restart-button')
  assert.equal(state.registrations[0].options.locale, 'dsh-restart-button')
  assert.ok(state.effects.length >= 2)
})

test('the row renders nothing outside the desktop shell', () => {
  const { module, sandbox } = loadClient()
  const state = makeState()
  module.apply(makeContext(state))
  const Row = state.registrations[0].component

  delete sandbox.dshDesktop
  assert.equal(Row({ wide: true, t: (key) => key }), null)

  sandbox.dshDesktop = {}
  assert.equal(Row({ wide: true, t: (key) => key }), null)
})

test('the row renders a button when the desktop restart bridge exists', () => {
  const { module, sandbox } = loadClient()
  const state = makeState()
  module.apply(makeContext(state))
  const Row = state.registrations[0].component

  sandbox.dshDesktop = { restartApp: () => Promise.resolve() }
  const wide = Row({ wide: true, t: (key) => key })
  assert.equal(wide.type, 'button')
  assert.equal(wide.props.className, 'dsh-restart-row')
  assert.equal(wide.props['data-rail'], 'false')
  assert.equal(wide.props['aria-label'], 'label')
  assert.equal(wide.children[1].children[0], 'label')

  const rail = Row({ wide: false, t: (key) => key })
  assert.equal(rail.props['data-rail'], 'true')
  assert.equal(rail.children[1], null)
})
