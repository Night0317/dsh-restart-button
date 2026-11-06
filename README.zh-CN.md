# dsh-restart-button

在 DeepSeek Harness 侧边栏底部、用户名（账户行）正上方添加一个「重启 DSH」按钮。

- 点击一次进入确认态（「再次点击重启」），4 秒后自动取消。
- 再次点击：整个 DSH 应用退出并自动重新打开，会话记录保留。
- 样式跟随原生侧边栏行（36px 高、同样的 hover/focus token、明暗主题、折叠成图标）。
- 不修改 `app.asar` 或 DSH 安装目录，只作为插件安装在当前 profile 中。

> GitHub 仓库：<https://github.com/Night0317/dsh-restart-button>（安装：Code → Download ZIP；版本记录见 Releases）

## 兼容性

- DSH Desktop **0.2.2-rc.1**（或兼容的 0.2.x），**Windows x64**。
- 只在桌面应用窗口里显示；`dsh web` / 普通浏览器标签不会显示。
- 其他平台会隐藏按钮，避免给出无法兑现的操作。

## 安装

完整步骤见 `INSTALL.zh-CN.md`（zip 里是 `安装说明.md`）。核心步骤：

1. 把插件文件夹解压到一个长期保留的位置（例如 `C:\dsh-plugins\dsh-restart-button`）。
2. DSH → 设置 → 插件 → 安装第三方插件 → 在「包名或地址」里填**插件文件夹的绝对路径** → 安装 → 立即启用。
3. **完全退出 DSH**（包含托盘里的 DSH）并重新打开。

如果使用打包好的压缩包，里面还有 `dsh-restart-button-1.0.0.tgz`；也可以自己运行 `pnpm pack` 生成。把 tgz 放在稳定位置，在第 2 步填这个 tgz 的绝对路径即可。

> 两种方式都要保留安装源：用文件夹安装时 DSH 通过目录链接引用它，移动/删除后按钮会消失（放回原路径可恢复）；用 tgz 安装时 tgz 也要保留，否则以后在 profile 里安装/更新其他插件会因找不到 tgz 而失败。详细对比见 `INSTALL.zh-CN.md`。

## 开发

- 宿主半：`index.js`（`webServer` 路由 + `connection` 鉴权）
- 客户端半：`client.js`（`sidebar.footer.action` 槽位）
- 重启辅助：`restart-helper.js`（等两个 DSH 进程退出后重新拉起）
- 测试：`node --test tests/`（Node ≥ 22）
- 打包：`pnpm pack`；发布资产为 `dsh-restart-button-1.0.0.tgz` 与 zip

## 使用

按钮位于左侧边栏最下方、账户行上方：

1. 第一次点击：文字变为「再次点击重启」。
2. 第二次点击：显示「正在重启…」，应用退出并自动重新启动。
3. 重启期间进行中的任务会被中断；会话记录已持久化，重开后可以继续。

## 卸载

DSH → 设置 → 插件 → 已安装 → 找到 `dsh-restart-button` → 卸载，然后重启 DSH；最后可以删除插件文件夹。

## 工作原理

桌面版把 Web 界面放在 Electron 主进程里，普通页面无法调用 `app.relaunch()`。插件因此分两半：

1. **客户端**：在 `sidebar.footer.action` 槽位渲染按钮；点击后请求宿主半的本地路由。
2. **宿主半**：注册 `/dsh-restart-button/status` 与 `/dsh-restart-button/restart`，启动一个 detached 的 Node helper 后停止 Electron 主进程；helper 等主进程和 Host 都退出，再拉起 `DeepSeek Harness.exe`。

路由只监听本机回环地址，并通过 DSH 自带的 `connection` 服务校验 Host/Origin 与浏览器登录 Cookie；跨站或未登录请求返回 401/403。插件不含任何网络请求或数据上报。helper 的日志写在 `%TEMP%\dsh-restart-button.log`。

## 故障排查

| 现象 | 处理 |
| --- | --- |
| 按钮不显示 | 确认是桌面应用窗口、DSH ≥ 0.2.2-rc.1、插件已启用；安装后需要完全退出并重开一次 |
| 点击后没反应 | 查看 `%TEMP%\dsh-restart-button.log`；确认 DSH 是桌面版而非 `dsh web` |
| 提示「重启失败」 | 手动退出并重新打开 DSH；若反复失败，把日志发给插件作者 |
| 安装时提示无法识别路径 | 使用文件夹的**绝对路径**，并确认文件夹里有 `package.json` |

## License

MIT
