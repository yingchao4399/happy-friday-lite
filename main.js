import { app, BrowserWindow, ipcMain, Menu } from 'electron'
import { fileURLToPath } from 'url'
import path from 'path'
import fs from 'fs'
import { setDataDir as setConfigDataDir } from './src-electron/config.js'
import { setDataDir as setDbDataDir, initDb, closeDb } from './src-electron/db.js'
import { registerCommands } from './src-electron/commands.js'
import { checkAutoBackup, createUpgradeSnapshot, setRestoreLifecycle } from './src-electron/backup.js'
import { checkAutoCleanHistory } from './src-electron/historyClean.js'
import { initPythonEnv } from './src-electron/python-env.js'
import { startKnowledgeWatcher } from './src-electron/fileWatcher.js'
import { initLogger, setLoggingEnabled } from './src-electron/logger.js'
import { startShareServer, stopShareServer } from './src-electron/shareServer.js'
import { startAutomationScheduler, stopAutomationScheduler } from './src-electron/automation.js'
import { startReminderScheduler, stopReminderScheduler } from './src-electron/scheduleReminder.js'
import { stopLazyHarness, closeLazyAgentConnections } from './src-electron/lazy-agent-commands.js'
import { initOfficeSession, shutdownOfficeHost } from './src-electron/office/office-session.js'
import { registerOfficeIpc } from './src-electron/office/office-ipc.js'
import { isHeadlessExportRun, runHeadlessExportEntry } from './src-electron/office/office-headless.js'
import { startObsidianScheduler, stopObsidianScheduler } from './src-electron/obsidian/scheduler.js'
import { resolveDataDir, applyUserDataRedirect, migrateDataIfNeeded } from './src-electron/data-dir.js'
import { initSession, registerSessionIpc } from './src-electron/session.js'
import { registerClipboardCommands, startClipboardCapture, stopClipboardCapture } from './src-electron/clipboard.js'
import { installIpcCapabilityGateway } from './src-electron/agent/ipcGateway.js'
import { installEditContextMenu } from './src-electron/edit-context-menu.js'
import { captureInternalClipboard } from './src-electron/clipboard.js'
import { showStartupError } from './src-electron/startup-error.js'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

const isDev = !app.isPackaged

// Windows 系统通知需与 appId 一致（electron-builder build.appId），否则通知不显示
app.setAppUserModelId('com.happyfriday.lite')

// 后台编辑器允许 Chromium 正常限流，前台重新激活时自然恢复。
// 全局禁止限流会让所有隐藏 Office 页面持续运行计时器和布局，占满 CPU。
app.on('web-contents-created', (_event, contents) => {
  installEditContextMenu(contents, { captureClipboard: () => captureInternalClipboard() })
})

// macOS：禁用窗口遮挡检测，避免被遮挡窗口进入 AppNap 低功耗状态
if (process.platform === 'darwin') {
  app.commandLine.appendSwitch('disable-features', 'CalculateNativeWinOcclusion')
}

if (isDev) {
  app.commandLine.appendSwitch('disable-gpu-sandbox')
  // 注意：不能追加 no-sandbox / disable-setuid-sandbox。
  // office 编辑器视图（resources/office/*/main）以 webPreferences.sandbox:true 创建，
  // 全局禁用沙箱会导致沙箱化 zygote 未建立，此类 renderer 启动时在
  // platform_shared_memory_region_posix.cc 处 FATAL（/dev/shm 共享内存分配失败，ESRCH）。
  // Linux 上 Chromium 会自动改用 userns 沙箱，无需禁用沙箱即可正常启动。
  app.setPath('userData', path.join(__dirname, 'app-data', 'electron-user-data'))
}

// 解析用户自定义数据目录（指针文件机制，须在 requestSingleInstanceLock 之前执行，
// 使单实例锁与 Chromium profile 一并跟随自定义目录）
const resolvedDataDir = resolveDataDir()
applyUserDataRedirect(resolvedDataDir.dataDir, resolvedDataDir.isCustom)

// The GUI and its DSH sidecar share one data directory. Multiple AppImage
// instances would therefore contend for DSH's credentials writer lock.
const headlessExportRun = isHeadlessExportRun()
const hasSingleInstanceLock = headlessExportRun || app.requestSingleInstanceLock()
if (!hasSingleInstanceLock) app.quit()

// 尽早初始化文件日志器，接管 console.* 与未捕获异常，
// 将运行日志落盘到数据目录，便于安装后排查异常。
// 必须在 app.whenReady 之前同步执行，以捕获后续所有模块的输出。
if (hasSingleInstanceLock) {
  initLogger(resolvedDataDir.dataDir)
}

let mainWindow = null
let kbWatcherHandle = null
let shutdownStarted = false
let localMcpStarted = false
setRestoreLifecycle({
  async beforeRestore() {
    kbWatcherHandle?.close()
    kbWatcherHandle = null
    const { clearStoreCache } = await import('./src-electron/rag/vectorstore.js')
    clearStoreCache()
    await new Promise(resolve => setImmediate(resolve))
  },
  afterRestore() {
    if (mainWindow && !mainWindow.isDestroyed()) kbWatcherHandle = startKnowledgeWatcher(mainWindow, resolvedDataDir.dataDir)
  }
})
installIpcCapabilityGateway(ipcMain, () => mainWindow)

if (!headlessExportRun) {
  // 系统打开文件请求：macOS open-file 事件 / Windows、Linux second-instance argv。
  // 统一推送给渲染进程（open-file-request），由其路由到内置 Office 编辑器或查看器。
  const OPEN_FILE_EXTS = new Set([
    'md', 'markdown', 'doc', 'docx', 'xls', 'xlsx', 'csv', 'ppt', 'pptx'
  ])
  const pendingOpenFilePaths = []
  let pendingFlushTimer = null

  function isSupportedDocPath(p) {
    if (!p || !fs.existsSync(p) || fs.statSync(p).isDirectory()) return false
    const ext = path.extname(p).slice(1).toLowerCase()
    return OPEN_FILE_EXTS.has(ext)
  }

  function emitOpenFileRequest(filePath) {
    // 渲染层仍在加载时先入队，避免 send 丢失；由渲染层启动时拉取或稍后补发
    if (mainWindow && !mainWindow.isDestroyed() && !mainWindow.webContents.isLoading()) {
      mainWindow.webContents.send('open-file-request', { filePath })
      return
    }
    // 窗口尚未就绪：排队等待，稍后补发（渲染层可能仍在启动中，延迟发送）
    pendingOpenFilePaths.push(filePath)
    if (pendingFlushTimer) return
    pendingFlushTimer = setInterval(() => {
      if (pendingOpenFilePaths.length === 0 || !mainWindow || mainWindow.isDestroyed()) return
      const paths = pendingOpenFilePaths.splice(0)
      paths.forEach(p => mainWindow.webContents.send('open-file-request', { filePath: p }))
      clearInterval(pendingFlushTimer)
      pendingFlushTimer = null
    }, 3000)
  }

  // 渲染进程启动时主动拉取排队中的打开文件请求（先跳转再展示界面，避免首页闪现）
  ipcMain.handle('open-file-get-pending', () => {
    if (pendingFlushTimer) {
      clearInterval(pendingFlushTimer)
      pendingFlushTimer = null
    }
    return pendingOpenFilePaths.splice(0)
  })

  app.on('open-file', (event, filePath) => {
    event.preventDefault()
    if (isSupportedDocPath(filePath)) emitOpenFileRequest(filePath)
  })

  app.on('second-instance', (_event, argv) => {
    argv.filter(isSupportedDocPath).forEach(emitOpenFileRequest)
    if (!mainWindow || mainWindow.isDestroyed()) return
    if (mainWindow.isMinimized()) mainWindow.restore()
    mainWindow.show()
    mainWindow.focus()
  })
}

async function ensureDataDir() {
  // 自定义数据目录且尚未迁移：在 initDb 之前复制旧目录数据（此时数据库未被占用）。
  // 迁移失败时指针已被清除，回退到默认数据目录。
  try {
    migrateDataIfNeeded(resolvedDataDir)
  } catch (e) {
    console.error('[Main] Data migration failed, staying on default data dir:', e.message)
    const fallback = resolveDataDir()
    resolvedDataDir.dataDir = fallback.dataDir
    resolvedDataDir.isCustom = false
  }

  const dataDir = resolvedDataDir.dataDir

  try {
    if (!fs.existsSync(dataDir)) {
      fs.mkdirSync(dataDir, { recursive: true })
    }
  } catch (e) {
    console.error('Failed to create data directory:', e)
  }

  setConfigDataDir(dataDir)
  setDbDataDir(dataDir)
  initSession(dataDir)
  registerSessionIpc()
  if (app.isPackaged) {
    const snapshot = await createUpgradeSnapshot(dataDir, app.getVersion())
    if (snapshot) console.log(`[Main] Upgrade snapshot: ${snapshot}`)
  }
  await initDb()

  return dataDir
}

function createWindow() {
  const isMac = process.platform === 'darwin'
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    minWidth: 800,
    minHeight: 600,
    icon: path.join(__dirname, 'build', 'icons', 'window-64.png'),
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
      backgroundThrottling: true,
      preload: path.join(__dirname, 'preload.cjs')
    },
    ...(isMac ? { titleBarStyle: 'hiddenInset', trafficLightPosition: { x: 12, y: 12 } } : { frame: false }),
    show: false
  })

  mainWindow.once('ready-to-show', () => {
    console.log('[Main] 主窗口 ready-to-show')
    mainWindow.show()
  })
  mainWindow.webContents.on('did-finish-load', () => console.log('[Main] 主窗口页面加载完成'))
  mainWindow.webContents.on('did-fail-load', (_event, code, description, _url, isMainFrame) => {
    if (isMainFrame) console.error('[Main] 主窗口页面加载失败:', code, description)
  })
  mainWindow.webContents.on('render-process-gone', (_event, details) => console.error('[Main] 主窗口渲染进程退出:', details.reason, details.exitCode))
  // 隐藏浮窗也属于 BrowserWindow；主窗口真正关闭时仍应完成 Windows 退出流程。
  mainWindow.once('closed', () => { mainWindow = null; if (process.platform !== 'darwin') app.quit() })
  mainWindow.on('unresponsive', () => console.error('[Main] 主窗口无响应，请检查日志并重启应用'))

  Menu.setApplicationMenu(null)

  mainWindow.webContents.on('before-input-event', (event, input) => {
    if (input.type !== 'keyDown') return
    const isMacToggle = input.meta && input.alt && input.code === 'KeyI'
    const isWinToggle = input.code === 'F12'
    if (isMacToggle || isWinToggle) {
      mainWindow.webContents.toggleDevTools()
      event.preventDefault()
    }
  })

  if (isDev) {
    mainWindow.loadURL('http://localhost:5173').catch(error => console.error('[Main] 开发页面加载失败:', error.message))
    if (process.env.FRIDAY_DEVTOOLS === '1') mainWindow.webContents.openDevTools()
  } else {
    mainWindow.loadFile(path.join(__dirname, 'dist/index.html')).catch(error => console.error('[Main] 安装页面加载失败:', error.message))
  }
}

app.whenReady().then(async () => {
  if (!hasSingleInstanceLock) return
  // happyfriday-office CLI 的 headless 导出请求：跳过全部常规初始化，
  // 隐藏窗口渲染一次导出后退出（office-headless.js 内部负责 app.exit）
  if (headlessExportRun) {
    try {
      await runHeadlessExportEntry()
    } catch (error) {
      console.error('[Office] headless export failed:', error)
      app.exit(3)
    }
    return
  }

  // 1. 先创建窗口，让 splash 立即显示（窗口加载 index.html 与主进程初始化并行）
  createWindow()

  // 不再全程阻止系统节能；后台页面采用 Chromium 自带的限流策略。

  // 2. 初始化数据目录与按页读写的 SQLite，期间 splash 持续显示
  //    渲染进程加载 JS bundle + Vue mount 通常比此处更慢，IPC 注册会先于首次 invoke 完成
  let dataDir
  try { dataDir = await ensureDataDir() }
  catch (error) {
    console.error('[Main] 数据初始化失败:', error)
    await showStartupError(error, resolvedDataDir.dataDir, mainWindow)
    app.quit()
    return
  }
  // 读取持久化配置后应用日志开关，兼容升级前已存在的配置文件。
  try {
    const configPath = path.join(dataDir, 'config.json')
    const config = JSON.parse(fs.readFileSync(configPath, 'utf-8'))
    setLoggingEnabled(config.runtimeLogsEnabled !== false)
  } catch (e) {
    console.warn('[Main] Failed to apply runtime log setting:', e.message)
  }

  console.log('[Main] Registering IPC commands...')
  try {
    registerCommands(mainWindow)
    registerClipboardCommands(mainWindow)
    startClipboardCapture(mainWindow)
    console.log('[Main] ✅ IPC commands registered successfully')
  } catch (error) {
    console.error('[Main] ❌ Failed to register IPC commands:', error)
  }

  startAutomationScheduler(mainWindow)
  startObsidianScheduler(mainWindow)

  // 日程到期提醒调度器（读取数据库中 reminder 开启的日程，发系统通知）
  startReminderScheduler(mainWindow)

  // Office 工作区（happyoffice 编辑器以 WebContentsView 挂载到主窗口）
  try {
    const ok = await initOfficeSession(mainWindow)
    if (ok) registerOfficeIpc()
    // 冒烟测试钩子：OFFICE_SMOKE=<file> 启动时自动打开并输出结果
    if (ok && process.env.OFFICE_SMOKE) {
      import('./src-electron/office/office-host.js').then(({ openOfficeFile, probeOfficeView }) =>
        openOfficeFile(process.env.OFFICE_SMOKE).then(r => {
          console.log('[Office][smoke] open result:', JSON.stringify(r))
          if (r && r.success) {
            return new Promise(res => setTimeout(res, 6000))
              .then(() => probeOfficeView(r.viewId))
              .then(p => console.log('[Office][smoke] probe:', JSON.stringify(p)))
          }
          return undefined
        }).catch(e => console.error('[Office][smoke] open failed:', e))
      )
    }
  } catch (error) {
    console.error('[Main] ❌ Failed to initialize Office host:', error)
  }

  // 3. 启动知识库目录监听（用于外部文件变更时自动刷新前端视图）
  try {
    kbWatcherHandle = startKnowledgeWatcher(mainWindow, dataDir)
  } catch (e) {
    console.error('[Main] ❌ Failed to start knowledge watcher:', e)
  }

  // 注册"动态监听当前浏览目录"IPC（Linux 不支持 recursive 监听，需前端切换目录时通知后端）
  ipcMain.handle('kb-watch-current-dir', (_event, args) => {
    if (kbWatcherHandle && args && args.dirPath) {
      try {
        kbWatcherHandle.watchCurrentDir(args.dirPath)
      } catch (e) {
        console.warn('[Main] watchCurrentDir error:', e?.message || e)
      }
    }
    return { success: true }
  })

  // 4. 以下均为非阻塞初始化，不等待完成
  // Python 运行时（macOS 优先检测系统 Python，其他平台使用打包 Python）
  initPythonEnv().catch(e => console.error('[Main] ❌ Python env init failed:', e))

  // RAG 模块（注册任务处理器、启动队列、可选启动时自动更新）——非阻塞，避免拖慢主流程
  import('./src-electron/rag/triggers.js')
    .then(({ initRag }) => initRag((channel, data) => {
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send(channel, data)
      }
    }))
    .then(() => console.log('[Main] ✅ RAG module initialized'))
    .catch(error => console.error('[Main] ❌ Failed to initialize RAG:', error))

  // 启动后检查自动备份（异步，不阻塞窗口）
  checkAutoBackup().catch(e => console.error('[Main] Auto backup check failed:', e))

  // 启动后检查对话历史自动清理（异步，至多每天一次，不阻塞窗口）
  checkAutoCleanHistory().catch(e => console.error('[Main] Auto history clean check failed:', e))

  // 启动内网分享服务（只读 HTTP，供局域网浏览器查看对话）
  startShareServer().catch(e => console.error('[Main] Share server failed to start:', e))

  // 若用户曾开启本机 MCP 服务，则自动拉起（异步，不阻塞窗口）
  import('./src-electron/config.js')
    .then(async ({ loadConfig }) => {
      if (loadConfig().mcp?.localEnabled) {
        const { autoStartLocalIfEnabled } = await import('./src-electron/agent/mcp.js')
        await autoStartLocalIfEnabled()
        localMcpStarted = true
      }
    })
    .then(() => console.log('[Main] ✅ MCP module initialized'))
    .catch(error => console.error('[Main] ❌ Failed to initialize MCP:', error))

  app.on('activate', function () {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow()
    }
  })
})

app.on('window-all-closed', function () {
  if (kbWatcherHandle) {
    kbWatcherHandle.close()
    kbWatcherHandle = null
  }
  stopShareServer()
  stopAutomationScheduler()
  stopObsidianScheduler()
  stopReminderScheduler()
  stopClipboardCapture()
  closeDb()
  if (process.platform !== 'darwin') {
    app.quit()
  }
})

// 应用退出前关闭 Agent MCP 连接（stdio 子进程等），避免残留进程
app.on('before-quit', (event) => {
  if (shutdownStarted) return
  event.preventDefault()
  Promise.allSettled([
    localMcpStarted ? import('./src-electron/agent/mcp.js')
      .then(({ closeAgentMcpConnections }) => closeAgentMcpConnections()) : closeLazyAgentConnections(),
    stopLazyHarness(),
    Promise.resolve(shutdownOfficeHost()),
    Promise.resolve(stopObsidianScheduler())
  ]).finally(() => {
    shutdownStarted = true
    app.quit()
  })
})

ipcMain.on('window-minimize', () => {
  if (mainWindow) mainWindow.minimize()
})

ipcMain.on('window-maximize', () => {
  if (mainWindow) {
    if (mainWindow.isMaximized()) {
      mainWindow.unmaximize()
    } else {
      mainWindow.maximize()
    }
  }
})

ipcMain.on('window-close', () => {
  if (mainWindow) mainWindow.close()
})
