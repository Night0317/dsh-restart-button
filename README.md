# dsh-restart-button

在 DeepSeek Harness 桌面版侧边栏底部、用户名（账户行）正上方添加一个「重启 DSH」按钮。

- 点击一次进入确认态（「再次点击重启」），4 秒后自动取消。
- 再次点击：整个 DSH 应用退出并自动重新打开，会话记录保留。
- 样式跟随原生侧边栏行（36px 高、同样的 hover/focus token、明暗主题、折叠成图标）。
- 不修改 `app.asar` 或 DSH 安装目录，只作为插件安装在当前 profile 中。

## 用 AI 一句话安装

把下面这句话直接发给 DSH 里的 AI：

> 帮我安装并启用 DSH 插件「dsh-restart-button」：从 https://github.com/Night0317/dsh-restart-button/releases/download/v1.0.0/dsh-restart-button-1.0.0.tgz 下载 tgz 到本地，用插件管理器安装这个 tgz 并确认已启用；完成后提醒我完全退出并重新打开 DSH。

如果 AI 不能直接下载，先手动下载 tgz，再把它和这句话一起发给 AI：

> 用插件管理器安装并启用这个 tgz：C:\你的路径\dsh-restart-button-1.0.0.tgz，完成后提醒我完全退出并重新打开 DSH。

## 下载

- **完整包**（插件文件夹 + tgz + 安装说明）：[dsh-restart-button-1.0.0.zip](https://github.com/Night0317/dsh-restart-button/releases/download/v1.0.0/dsh-restart-button-1.0.0.zip)
- **单文件插件包**：[dsh-restart-button-1.0.0.tgz](https://github.com/Night0317/dsh-restart-button/releases/download/v1.0.0/dsh-restart-button-1.0.0.tgz)
- 也可以从仓库 **Code → Download ZIP** 获取源码。

## 手动安装

完整步骤见 [INSTALL.zh-CN.md](INSTALL.zh-CN.md)。核心步骤：

1. 下载 zip，解压到一个长期保留的位置（例如 `C:\dsh-plugins\dsh-restart-button`）。
2. DSH → 设置 → 插件 → 安装第三方插件 → 在「包名或地址」里填**插件文件夹的绝对路径** → 安装 → 立即启用。
   也可以填 tgz 的绝对路径作为单文件安装。
3. **完全退出 DSH**（包含托盘里的 DSH）并重新打开。

> 两种方式都要保留安装溓：用文件夹安装时 DSH 通过目录链接引用它，移动/删除后按钮会消失（放回原路径可恢复）；用 tgz 安装时 tgz 也要保留，否则以后在 profile 里安装/更新其他插件会因找不到 tgz 而失败。详细对比见 `INSTALL.zh-CN.md`。

## 兼容性

- DSH Desktop **0.2.2-rc.1**（或兼容的 0.2.x），**Windows x64**。
- 只在桌面应用窗口里显示；`dsh web` / 普通浏览器标签不会显示。
- 其他平台会隐藏按钮，避免给出无法兑现的操作。

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

## 开发

- 宿主半：`index.js`（`webServer` 路由 + `connection` 鉴权）
- 客户端半：`client.js`（`sidebar.footer.action` 槽位）
- 重启辅助：`restart-helper.js`（等两个 DSH 进程退出后重新拉起）
- 测试：`node --test tests/`（Node ≥ 22）
- 打包：`pnpm pack`

## 故障排查

| 现象 | 处理 |
| --- | --- |
| 按钮不显示 | 确认是桌面应用窗口、DSH ≥ 0.2.2-rc.1、插件已启用；安装后需要完全退出并重开一次 |
| 点击后没反应 | 查看 `%TEMP%\dsh-restart-button.log`；确认 DSH 是桌面版而非 `dsh web` |
| 提示「重启失败」 | 手动退出并重新打开 DSH；若反复失败，把日志发给插件作者 |
| 安装时提示无法识别路径 | 使用文件夹的**绝对路径**，并确认文件夹里有 `package.json` |
| 安装后过几天失效 | 检查插件文件夹是否被移动/删除（文件夹方式靠目录链接引用它）；放回原路径即可恢复，或卸载后从新位置重装 |

## License

MIT
