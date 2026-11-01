// 真实 Chromium + Vue 共享历史/新建按钮，配合隔离 SQLite 验证交互合同。
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createRequire } from 'node:module'

const filename = fileURLToPath(import.meta.url)
const root = fileURLToPath(new URL('../', import.meta.url))
if (!process.versions.electron) {
  const { spawn } = await import('node:child_process')
  const env = { ...process.env }; delete env.ELECTRON_RUN_AS_NODE
  const child = spawn(createRequire(import.meta.url)('electron'), [filename], { cwd: root, env, windowsHide: true, stdio: 'inherit' })
  const timeout = setTimeout(() => child.kill(), 150_000)
  process.exitCode = await new Promise(resolve => { child.on('error', () => resolve(1)); child.on('exit', code => resolve(code ?? 1)) })
  clearTimeout(timeout)
} else {
  const { app, BrowserWindow, ipcMain } = await import('electron')
  const { build } = await import('vite')
  const vue = (await import('@vitejs/plugin-vue')).default
  const db = await import('../src-electron/db.js')
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'friday-conversation-ui-'))
  app.setPath('userData', path.join(temp, 'profile'))
  app.on('window-all-closed', () => {})
  const entry = path.join(root, 'preview22-conversation-ui-probe.html')
  const pause = ms => new Promise(resolve => setTimeout(resolve, ms))
  const scopes = [['friday', null], ['dock', 'global'], ['note-agent', 'note:a'], ['knowledge', 'kb:a'], ['knowledge-agent', 'folder:a'], ['schedule-agent', null], ['office-docs', 'file:a']]
  const sessions = []
  const report = { ok: false, checkedAt: new Date().toISOString(), checks: [], scopes: scopes.length }
  let win, failCreate = false
  const run = expression => win.webContents.executeJavaScript(expression, true)
  async function until(expression) {
    for (let attempt = 0; attempt < 160; attempt++) { if (await run(expression)) return; await pause(25) }
    throw new Error('UI 验收超时: ' + expression)
  }
  async function click(selector) { await run(`document.querySelector(${JSON.stringify(selector)}).click();true`) }
  app.whenReady().then(async () => {
    try {
      db.setDataDir(path.join(temp, 'data')); await db.initDb()
      for (const [scope, scopeKey] of scopes) {
        const ids = []
        for (let index = 0; index < 20; index++) {
          const session = db.createSession(`验收 ${index}`, 'chat', scope, scopeKey, { agentId: 'friday', modelId: 'test-model' })
          db.saveMessage(session.id, 'user', `验收消息 ${index}`)
          db.saveMessage(session.id, 'assistant', `验收回答 ${index}`)
          ids.push(session.id)
        }
        sessions.push(ids)
      }
      ipcMain.handle('get_sessions', (_event, args) => db.getSessions(args.scope, args.scopeKey, args.view))
      for (const channel of ['get_session', 'get_session_messages']) ipcMain.handle(channel, async (_event, args) => {
        const index = sessions.flat().indexOf(args.sessionId) % 20
        await pause(index === 0 ? 100 : index === 1 ? 60 : 5)
        return channel === 'get_session' ? db.getSession(args.sessionId, args.scope, args.scopeKey) : db.getMessages(args.sessionId, args.scope, args.scopeKey)
      })
      ipcMain.handle('create_session', (_event, args) => {
        if (failCreate) return null
        return db.createSession(args.title, args.mode, args.scope, args.scopeKey, args)
      })
      fs.writeFileSync(entry, `<!doctype html><html><body><div id="app"></div><script type="module">
        import {createApp,h,ref} from 'vue'
        import {createI18n} from 'vue-i18n'
        import History from '/src/components/chat/ScopedHistoryButton.vue'
        import NewConversation from '/src/components/chat/NewConversationButton.vue'
        import friday from '/src/i18n/locales/zh-CN/friday.json'
        const scopes=${JSON.stringify(scopes)}
        const Root={setup(){const scopeIndex=ref(0);window.selections=[];window.switchScope=index=>scopeIndex.value=index;
          const select=payload=>{window.selections.push({id:payload.session.id,messages:payload.messages.length,agentId:payload.session.agentId});window.latest=payload.session.id}
          return()=>h('main',{style:'margin:100px;--text-primary:#222;--text-secondary:#555;--bg-primary:#fff;--bg-hover:#eee;--border-color:#ccc'},[
            h(History,{scope:scopes[scopeIndex.value][0],scopeKey:scopes[scopeIndex.value][1]||'',onSelect:select,onCreate:select}),
            h(NewConversation,{scope:scopes[scopeIndex.value][0],scopeKey:scopes[scopeIndex.value][1]||'',agentId:'researcher',onCreate:select})])}}
        createApp(Root).use(createI18n({legacy:false,locale:'zh-CN',messages:{'zh-CN':{friday}}})).mount('#app')
      </script></body></html>`)
      await build({ configFile: false, root, base: './', publicDir: false, logLevel: 'error', plugins: [vue()], resolve: { alias: { '@': path.join(root, 'src') } }, build: { outDir: path.join(temp, 'dist'), rollupOptions: { input: entry }, emptyOutDir: true } })
      win = new BrowserWindow({ show: true, width: 1100, height: 780, webPreferences: { preload: path.join(root, 'preload.cjs'), sandbox: true, contextIsolation: true } })
      await win.loadFile(path.join(temp, 'dist', path.basename(entry)))
      await until('Boolean(document.querySelector(".scoped-history-toggle"))')
      await click('.scoped-history-toggle')
      await until('document.querySelectorAll(".scoped-history-session").length===20')
      assert.equal(await run('document.activeElement.type'), 'search')
      assert.equal(await run('document.querySelector(".scoped-history-panel").parentElement.id'), 'friday-overlay-root')
      await run(`document.querySelector('.scoped-history-panel').querySelectorAll('button:not(:disabled)').item(0).focus();true`)
      win.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'Tab', modifiers: ['shift'] })
      win.webContents.sendInputEvent({ type: 'keyUp', keyCode: 'Tab', modifiers: ['shift'] })
      await pause(50)
      assert.equal(await run(`document.activeElement===Array.from(document.querySelectorAll('.scoped-history-panel button:not(:disabled),.scoped-history-panel input')).at(-1)`), true)
      win.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'Escape' })
      win.webContents.sendInputEvent({ type: 'keyUp', keyCode: 'Escape' })
      await until('!document.querySelector(".scoped-history-panel")')
      assert.equal(await run('document.activeElement.classList.contains("scoped-history-toggle")'), true)
      report.checks.push('历史打开聚焦搜索、Tab 焦点闭环、Esc 关闭并归还按钮焦点、挂载统一根节点')
      for (let iteration = 0; iteration < 100; iteration++) {
        await click('.scoped-history-toggle')
        await until('document.querySelectorAll(".scoped-history-session").length===20')
        const selected = sessions[0].slice(0, 3)
        await run(`window.selections=[];for(const id of ${JSON.stringify(selected)}){const item=Array.from(document.querySelectorAll('.scoped-history-session')).find(element=>element.querySelector('.scoped-history-title').textContent.trim()==='验收 '+${JSON.stringify(sessions[0])}.indexOf(id));item.click()}true`)
        await until(`window.latest===${JSON.stringify(selected[2])}&&!document.querySelector('.scoped-history-panel')`)
        await pause(110)
        assert.deepEqual(await run('window.selections.map(item=>item.id)'), [selected[2]])
      }
      report.checks.push('100 次 A/B/C 连点、C 先返回且旧 A/B 不覆盖，消息和 agent 完整恢复')
      for (let index = 0; index < scopes.length; index++) {
        await run(`window.switchScope(${index});true`); await pause(30)
        const before = await run('window.latest')
        await click('.new-conversation-button')
        const count = db.getSessions(...scopes[index]).length
        await until(`window.latest!==${JSON.stringify(before)}&&window.selections.at(-1)?.agentId==='researcher'`)
        await pause(30)
        const selectedId = await run('window.latest')
        assert.equal(db.getSessions(...scopes[index]).length, 21)
        assert.equal(db.getSession(selectedId, ...scopes[index]).agentId, 'researcher')
        assert.equal(db.getMessages(selectedId, ...scopes[index]).length, 0)
        assert.ok(count >= 20)
      }
      report.checks.push('七类范围的新建按钮先持久化、保留 agent、再切换 UI，范围隔离')
      failCreate = true
      const previous = await run('window.latest')
      await click('.new-conversation-button')
      await until('Boolean(document.querySelector(".new-conversation-button [role=alert]"))')
      assert.equal(await run('window.latest'), previous)
      report.checks.push('创建失败时显示重试提示并保留原会话')
      fs.writeFileSync(path.join(root, 'artifacts', 'preview22-conversation-ui.png'), await win.webContents.capturePage().then(image => image.toPNG()))
      report.ok = true
    } catch (error) { report.error = error.stack }
    finally {
      fs.mkdirSync(path.join(root, 'artifacts'), { recursive: true })
      fs.writeFileSync(path.join(root, 'artifacts', 'preview22-conversation-ui-report.json'), JSON.stringify(report, null, 2))
      console.log(JSON.stringify(report))
      if (fs.existsSync(entry)) fs.unlinkSync(entry)
      db.closeDb()
      if (win && !win.isDestroyed()) win.destroy()
      app.exit(report.ok ? 0 : 1)
    }
  })
}
