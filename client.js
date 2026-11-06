window.__ModuleLoader__.load({
  id: 'dsh-restart-button',
  factory: (require) => {
    const module = { exports: {} }
    const React = require('react')
    const h = React.createElement

    const NS = 'dsh-restart-button'
    const ROUTE = '/dsh-restart-button'
    /** Availability probes: first immediately, then twice more while the host comes up. */
    const RETRY_DELAYS = [0, 1000, 3000]
    const ARMED_RESET_MS = 4000
    const ERROR_RESET_MS = 6000

    // The row follows the sidebar's own `.panelRow` recipe (36px row, the same
    // custom properties, the same hover/focus tokens), so it sits in the footer
    // directly above the account entry without looking bolted on.
    const CSS = `
      .dsh-restart-row {
        box-sizing: border-box;
        display: flex;
        align-items: center;
        gap: var(--dsh-sidebar-label-gap, 6px);
        width: 100%;
        min-height: 36px;
        margin: 0;
        padding: 7px calc(var(--dsh-sidebar-row-padding, 12px) - var(--dsh-sidebar-paint-inset, 3px));
        border: none;
        border-inline: var(--dsh-sidebar-paint-inset, 3px) solid transparent;
        border-radius: var(--dsw-radius-md, 8px);
        background: transparent;
        background-clip: padding-box;
        color: var(--dsw-alias-label-primary);
        font: inherit;
        font-size: 14px;
        line-height: 22px;
        text-align: left;
        cursor: pointer;
      }
      @media (hover: hover) {
        .dsh-restart-row:hover { background-color: var(--dsw-alias-interactive-bg-hover); }
      }
      .dsh-restart-row:active { background-color: var(--dsw-alias-interactive-bg-active, var(--dsw-alias-interactive-bg-hover)); }
      .dsh-restart-row:focus-visible {
        outline: var(--dsw-focus-ring-width, 2px) solid var(--dsw-focus-ring-color, var(--dsw-alias-state-business-primary));
        outline-offset: -2px;
      }
      .dsh-restart-row[data-armed='true'] { color: var(--dsw-alias-state-warn-label, var(--dsw-alias-label-primary)); }
      .dsh-restart-row[data-busy='true'] { cursor: progress; opacity: 0.72; }
      .dsh-restart-row[data-error='true'] { color: var(--dsw-alias-state-error-primary, var(--dsw-alias-label-primary)); }
      .dsh-restart-row__icon { flex: none; display: inline-flex; align-items: center; justify-content: center; color: var(--dsw-alias-label-secondary); }
      .dsh-restart-row[data-armed='true'] .dsh-restart-row__icon,
      .dsh-restart-row[data-busy='true'] .dsh-restart-row__icon,
      .dsh-restart-row[data-error='true'] .dsh-restart-row__icon { color: inherit; }
      .dsh-restart-row__label { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
      .dsh-restart-row[data-busy='true'] .dsh-restart-row__icon { animation: dsh-restart-spin 1s linear infinite; }
      @keyframes dsh-restart-spin { to { transform: rotate(360deg); } }
      @media (prefers-reduced-motion: reduce) { .dsh-restart-row[data-busy='true'] .dsh-restart-row__icon { animation: none; } }
      /* Collapsed rail: an icon-only 36px square, like the other rail rows. */
      .dsh-restart-row[data-rail='true'] {
        width: 36px;
        height: 36px;
        min-height: 36px;
        justify-content: center;
        padding: 0;
        border-inline: 0;
      }
      .dsh-restart-row[data-rail='true'] .dsh-restart-row__icon { color: var(--dsw-alias-label-primary); }
    `

    // A circular restart arrow, drawn with currentColor so it follows the
    // sidebar's text-color tokens in both themes.
    const ICON = h('svg', {
      width: 16,
      height: 16,
      viewBox: '0 0 16 16',
      fill: 'none',
      'aria-hidden': 'true',
    }, [
      h('path', {
        key: 'arc',
        d: 'M13.4 8a5.4 5.4 0 1 1-1.58-3.82',
        stroke: 'currentColor',
        strokeWidth: 1.5,
        strokeLinecap: 'round',
      }),
      h('path', {
        key: 'arrow',
        d: 'M13.4 1.9v3.1h-3.1',
        stroke: 'currentColor',
        strokeWidth: 1.5,
        strokeLinecap: 'round',
        strokeLinejoin: 'round',
      }),
    ])

    /** The desktop preload bridge, or undefined in a plain Web/CLI deployment. */
    function desktopBridge() {
      const desktop = globalThis.dshDesktop
      return typeof desktop === 'object' && desktop !== null ? desktop : undefined
    }

    /** Whether the host half can actually restart this deployment. */
    async function readStatus() {
      try {
        const response = await fetch(`${ROUTE}/status`, {
          credentials: 'same-origin',
          cache: 'no-store',
          headers: { accept: 'application/json' },
        })
        if (!response.ok) return false
        const status = await response.json().catch(() => null)
        return status?.ok === true && status?.desktop === true && status?.supported === true
      } catch {
        return false
      }
    }

    /**
     * `true` once a restart path is usable. A patched/future shell exposes
     * `dshDesktop.restartApp`; the stock shell is reached through the host
     * half's local route. Nothing is rendered while this is still unknown, so
     * the footer never flashes a button that is about to disappear.
     */
    function useAvailability() {
      const bridge = desktopBridge()
      const hasBridge = bridge !== undefined
      const bridgeReady = typeof bridge?.restartApp === 'function'
      const [available, setAvailable] = React.useState(bridgeReady)

      React.useEffect(() => {
        // No bridge means a plain browser tab: do not even ask the host.
        if (!hasBridge || bridgeReady) return undefined
        let live = true
        let timer
        const check = async (index) => {
          const ok = await readStatus()
          if (!live) return
          if (ok) {
            setAvailable(true)
            return
          }
          if (index + 1 < RETRY_DELAYS.length) {
            const delay = RETRY_DELAYS[index + 1] - RETRY_DELAYS[index]
            timer = setTimeout(() => { void check(index + 1) }, delay)
          } else {
            setAvailable(false)
          }
        }
        void check(0)
        return () => {
          live = false
          if (timer !== undefined) clearTimeout(timer)
        }
      }, [hasBridge, bridgeReady])

      return available === true
    }

    function RestartRow({ wide, t }) {
      const bridge = desktopBridge()
      const available = useAvailability()
      const [armed, setArmed] = React.useState(false)
      const [phase, setPhase] = React.useState('idle')

      React.useEffect(() => {
        if (!armed) return undefined
        const timer = setTimeout(() => setArmed(false), ARMED_RESET_MS)
        return () => clearTimeout(timer)
      }, [armed])

      React.useEffect(() => {
        if (phase !== 'error') return undefined
        const timer = setTimeout(() => setPhase('idle'), ERROR_RESET_MS)
        return () => clearTimeout(timer)
      }, [phase])

      if (bridge === undefined) return null
      if (!available) return null

      const busy = phase === 'busy'
      const failed = phase === 'error'
      const label = busy ? t('busy') : failed ? t('failed') : armed ? t('armed') : t('label')
      const hint = busy ? t('busy') : failed ? t('failed') : t('hint')

      async function restart() {
        if (busy) return
        if (!armed) {
          setArmed(true)
          return
        }
        setArmed(false)
        setPhase('busy')
        try {
          if (typeof bridge.restartApp === 'function') {
            try {
              await bridge.restartApp()
              return
            } catch (error) {
              // A patched shell whose IPC is unavailable still has the route.
              console.warn('[dsh-restart-button] desktop restart bridge failed, falling back to the host route', error)
            }
          }
          const response = await fetch(`${ROUTE}/restart`, {
            method: 'POST',
            credentials: 'same-origin',
            cache: 'no-store',
            headers: { 'content-type': 'application/json' },
            body: '{}',
          })
          if (!response.ok) throw new Error(`restart rejected with status ${String(response.status)}`)
        } catch (error) {
          console.error('[dsh-restart-button] restart failed', error)
          setPhase('error')
        }
      }

      return h('button', {
        type: 'button',
        className: 'dsh-restart-row',
        'data-rail': String(wide !== true),
        'data-armed': String(armed),
        'data-busy': String(busy),
        'data-error': String(failed),
        'aria-label': label,
        'aria-busy': busy ? 'true' : undefined,
        disabled: busy ? true : undefined,
        title: hint,
        onClick: restart,
      },
      h('span', { className: 'dsh-restart-row__icon' }, ICON),
      wide === true ? h('span', { className: 'dsh-restart-row__label' }, label) : null)
    }

    function apply(ctx) {
      const style = document.createElement('style')
      style.dataset.dshPlugin = NS
      style.textContent = CSS
      document.head.appendChild(style)
      ctx.effect(() => () => style.remove(), `${NS}: styles`)

      ctx.effect(() => ctx.locale.register(NS, {
        zh: {
          label: '閲嶅惎 DSH',
          armed: '鍐嶆鐐瑰嚮閲嶅惎',
          busy: '姝ｅ湪閲嶅惎鈥?,
          failed: '閲嶅惎澶辫触锛岃鎵嬪姩閲嶅惎',
          hint: '閲嶅惎 DSH锛堣繘琛屼腑鐨勪换鍔′細涓柇锛?,
        },
        en: {
          label: 'Restart DSH',
          armed: 'Click again to restart',
          busy: 'Restarting鈥?,
          failed: 'Restart failed 鈥?restart manually',
          hint: 'Restart DSH (running tasks will be interrupted)',
        },
      }), `${NS}: locale`)

      ctx.slots.inject('sidebar.footer.action', () => ctx.slots.register({
        name: 'sidebar.footer.action',
        id: NS,
        order: 10,
        locale: NS,
      }, RestartRow))
    }

    module.exports.inject = ['slots', 'locale']
    module.exports.apply = apply
    return module.exports
  },
})
