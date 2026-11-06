# dsh-restart-button

Adds a **Restart DSH** row directly above the account entry in the DeepSeek
Harness sidebar footer.

- First click arms the row ("Click again to restart"); it disarms after 4s.
- Second click fully restarts the desktop app. Session history is kept.
- Matches the native sidebar row: 36px, hover/focus tokens, light/dark themes,
  icon-only in the collapsed rail.
- Installed as a profile plugin: it does **not** patch `app.asar` or the DSH
  installation.

> GitHub: <https://github.com/Night0317/dsh-restart-button> — install from
> Code → Download ZIP, or build a tgz with `pnpm pack`. See Releases for version
> notes.

## Requirements

- DSH Desktop 0.2.2-rc.1 (or a compatible 0.2.x) on Windows x64.
- Desktop app only; a plain `dsh web` Host or browser tab shows no button.

## Install

1. Unzip the plugin folder somewhere permanent (for example
   `C:\dsh-plugins\dsh-restart-button`).
2. DSH → Settings → Plugins → Install third-party plugin → paste the absolute
   path of the plugin folder → install and enable.
3. **Fully quit DSH** (including the tray icon) and reopen it.

A single-file alternative: the packaged zip from the project archive includes a
`dsh-restart-button-1.0.0.tgz` (or build one with `pnpm pack`). Keep the tgz
somewhere permanent and paste its absolute path in step 2 instead.

> Keep the install source either way. A folder install is referenced through a
> directory junction, so moving or deleting the folder makes the button
> disappear (restoring the path brings it back). A tgz install keeps running if
> the tgz is deleted, but a later plugin install in the profile fails until the
> tgz is restored. `INSTALL.zh-CN.md` compares both.

## Development

- Host half: `index.js` (local `webServer` routes + `connection` admission)
- Client half: `client.js` (the `sidebar.footer.action` slot)
- Relaunch helper: `restart-helper.js`
- Tests: `node --test tests/` (Node ≥ 22)
- Package: `pnpm pack`; release assets are `dsh-restart-button-1.0.0.tgz` and a zip

## How it works

The stock desktop shell exposes no page-level relaunch API. The plugin ships a
client half that renders the row in the `sidebar.footer.action` slot, and a host
half that registers two local routes (`/dsh-restart-button/status` and
`/dsh-restart-button/restart`). The host starts a detached Node helper, stops
the Electron main process, and the helper relaunches the app once both DSH
processes have exited. Routes are admitted by DSH's own Host/Origin + browser
cookie check; unauthenticated or cross-site requests are rejected.

## License

MIT
