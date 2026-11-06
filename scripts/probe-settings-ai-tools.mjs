import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createRequire } from 'node:module'

const root = fileURLToPath(new URL('../', import.meta.url))
const file = fileURLToPath(import.meta.url)
const artifact = name => path.join(root, 'artifacts', name)

// 独立验证真实 Vue 设置页；只替换 IPC 数据，避免读写用户设置或调用收费 API。
if (!process.versions.electron) {
  const [{ createServer }, { default: vue }, { spawn }] = await Promise.all([import('vite'), import('@vitejs/plugin-vue'), import('node:child_process')])
  const fixture = {
    search: { enabled: true, provider: 'genspark', providers: { genspark: {}, tavily: {} } },
    media: { enabled: true, imageProvider: 'genspark', analysisProvider: 'genspark', videoAnalysisProvider: 'genspark', providers: { genspark: {}, openai: {} } },
    fileSearch: { rerank: false, endpoint: 'openrouter', keysConfigured: {}, customBaseUrl: '', customModel: '', cloudflareAccountId: '', cloudflareModel: '@cf/cloudflare/clef' },
    catalog: {
      search: [{ id: 'genspark', label: 'Genspark' }, { id: 'tavily', label: 'Tavily' }],
      media: [
        { id: 'genspark', label: 'Genspark', imageProtocol: 'genspark', analysisProtocol: 'genspark', videoAnalysis: true },
        { id: 'openai', label: 'OpenAI', imageProtocol: 'openai', analysisProtocol: 'openai', videoAnalysis: true, defaultBaseUrl: 'https://api.openai.com/v1', defaultImageModel: 'gpt-image-1', defaultAnalysisModel: 'gpt-4.1', imageModels: ['gpt-image-1'], analysisModels: ['gpt-4.1'] },
      ],
      decisionEndpoints: [{ id: 'openrouter', label: 'Jev (OpenRouter)' }, { id: 'custom', label: 'Custom' }, { id: 'cloudflare', label: 'Cloudflare' }],
    },
  }
  const mock = `
    let settings = ${JSON.stringify(fixture)};
    window.__settingsProbeCalls = [];
    const invoke = async (channel, payload) => {
      if (channel === 'get-config') return { fontSize: 16, sidebarModules: {}, customModels: [] };
      if (channel === 'rag-get-kb-summary') return { success: true, data: [] };
      if (channel === 'python-status') return { available: false, reason: 'not_configured' };
      if (channel === 'data-dir-get') return { path: 'C:/Friday-test-data', isCustom: false };
      return {};
    };
    export const electronService = {
      invoke, listen: () => () => {},
      getOfficeAiServices: async () => structuredClone(settings),
      saveOfficeAiServices: async patch => {
        window.__settingsProbeCalls.push({ kind: 'save', hasMockKey: Object.values(patch.media.providers).some(p => p.apiKey === 'mock-key-for-ui-validation') });
        for (const kind of ['search','media']) {
          settings[kind] = { ...settings[kind], ...patch[kind], providers: { ...settings[kind].providers } };
          for (const [id, provider] of Object.entries(patch[kind].providers)) settings[kind].providers[id] = { ...provider, apiKey: undefined, apiKeyConfigured: !!provider.apiKey };
        }
        settings.fileSearch = { ...patch.fileSearch, keys: undefined, keysConfigured: {} };
        return structuredClone(settings);
      },
      testOfficeAiServices: async input => { window.__settingsProbeCalls.push({kind:'test', aggregate:input.kind === 'all'}); return {ok:true}; },
    };
  `
  const entry = `
    import { createApp, h } from 'vue';
    import { createPinia } from 'pinia';
    import { createRouter, createWebHashHistory, RouterView } from 'vue-router';
    import { i18n } from '/src/i18n/index.js';
    import Model from '/src/views/settings/SettingsModel.vue';
    import Tools from '/src/views/settings/SettingsAiTools.vue';
    import General from '/src/views/settings/SettingsGeneral.vue';
    import '/src/assets/styles/main.css';
    localStorage.setItem('happy-friday-custom-models', JSON.stringify([{id:'probe', provider:'deepseek', providerLabel:'DeepSeek', modelName:'deepseek-flash'}]));
    const router = createRouter({history:createWebHashHistory(),routes:[{path:'/settings/model',component:Model},{path:'/settings/ai-tools',component:Tools},{path:'/settings',component:General}]});
    const app = createApp({render:()=>h(RouterView)});
    app.config.errorHandler = error => { (window.__settingsProbeErrors ||= []).push(error.message) };
    app.use(createPinia()).use(i18n).use(router).mount('#app');
    window.__settingsProbeRouter = router;
    window.__settingsProbeReady = true;
  `
  const server = await createServer({
    configFile: false,
    root,
    plugins: [vue(), {
      name: 'friday-settings-probe',
      resolveId(id) { if (id === 'virtual:friday-settings-probe-ipc') return '\0friday-settings-probe-ipc'; if (id === 'virtual:friday-settings-probe-entry') return '\0friday-settings-probe-entry' },
      load(id) { if (id === '\0friday-settings-probe-ipc') return mock; if (id === '\0friday-settings-probe-entry') return entry },
      configureServer(server) {
        server.middlewares.use((req, res, next) => {
          if (req.url === '/__settings-probe.html') {
            res.setHeader('Content-Type', 'text/html; charset=utf-8')
            res.end('<!doctype html><html><head><meta charset="utf-8"><style>body{margin:0;background:#f5f5f5!important}#app{position:absolute;left:78px;top:56px;right:6px;bottom:6px;overflow:auto;background:var(--bg-primary);border-radius:12px;}</style></head><body><div id="app"></div><script type="module" src="/@id/virtual:friday-settings-probe-entry"></script></body></html>')
          } else next()
        })
      },
    }],
    resolve: { alias: [{ find: '@/services/electron', replacement: 'virtual:friday-settings-probe-ipc' }, { find: '@/store', replacement: path.join(root, 'src/store/modules/app.js') }, { find: '@', replacement: path.join(root, 'src') }] },
    server: { host: '127.0.0.1', port: 0, hmr: false, watch: null },
    optimizeDeps: { noDiscovery: true, include: ['vue', 'vue-router', 'vue-i18n', 'pinia', 'lucide-vue-next'] },
    clearScreen: false,
  })
  await server.listen()
  const env = { ...process.env }
  delete env.ELECTRON_RUN_AS_NODE
  const url = `http://127.0.0.1:${server.httpServer.address().port}/__settings-probe.html#/settings/model`
  console.log('设置验证服务:', url)
  const child = spawn(createRequire(import.meta.url)('electron'), [file, '--settings-probe-url', url], { cwd: root, env, windowsHide: true, stdio: 'inherit' })
  const timer = setTimeout(() => child.kill(), 180000)
  process.exitCode = await new Promise(resolve => { child.once('error', error => { console.error(error); resolve(1) }); child.once('exit', code => resolve(code ?? 1)) })
  clearTimeout(timer)
  await server.close()
} else {
  const { app, BrowserWindow } = await import('electron')
  app.disableHardwareAcceleration()
  app.setPath('userData', fs.mkdtempSync(path.join(os.tmpdir(), 'friday-settings-probe-')))
  const report = { ok: false, checkedAt: new Date().toISOString(), electron: process.versions.electron, steps: [], limitations: ['真实 Vue 组件在隔离 Electron 窗口中渲染；IPC 使用无密钥测试数据。未验证真实主窗口外壳、安装版或远程 API。'] }
  const persist = () => fs.writeFileSync(artifact('settings-ai-tools-ui-report.json'), JSON.stringify(report, null, 2))
  report.stage = 'electron-loaded'
  persist()
  void (async () => {
    let win
    try {
      await app.whenReady()
      report.stage = 'electron-ready'
      persist()
      win = new BrowserWindow({ show: false, width: 1502, height: 999, useContentSize: true, webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false } })
      const wc = win.webContents
      wc.on('console-message', event => { if (!event.message.includes('Electron Security Warning')) console.log('设置验证渲染消息:', event.message) })
      await win.loadURL(process.argv[process.argv.indexOf('--settings-probe-url') + 1])
      report.stage = 'page-loaded'
      persist()
      const waitFor = async expression => {
        for (let attempt = 0; attempt < 200; attempt++) {
          if (await wc.executeJavaScript(expression)) return
          await new Promise(resolve => setTimeout(resolve, 50))
        }
        throw new Error('设置页面等待超时: ' + expression)
      }
      const navigate = async (route, selector) => { await wc.executeJavaScript(`window.__settingsProbeRouter.push(${JSON.stringify(route)})`); await waitFor(`!!document.querySelector(${JSON.stringify(selector)})`); await new Promise(resolve => setTimeout(resolve, 80)) }
      await waitFor('window.__settingsProbeReady && !!document.querySelector(".model-settings-page .back-btn")')
      const measure = () => wc.executeJavaScript(`(() => {
        const button = document.querySelector('.back-btn'), page = button.parentElement;
        const rect = button.getBoundingClientRect(), parent = page.getBoundingClientRect(), style = getComputedStyle(button), svg = button.querySelector('svg');
        const props = ['position','top','left','paddingTop','paddingRight','paddingBottom','paddingLeft','width','height','borderTopWidth','borderRadius','backgroundColor','color','display','alignItems','justifyContent','transitionProperty','transitionDuration','cursor'];
        return {offset:{x:rect.x-parent.x,y:rect.y-parent.y},rect:{x:rect.x,y:rect.y,width:rect.width,height:rect.height},style:Object.fromEntries(props.map(key=>[key,style[key]])),svg:{width:svg.getAttribute('width'),height:svg.getAttribute('height'),stroke:svg.getAttribute('stroke-width'),points:svg.querySelector('polyline').getAttribute('points')}};
      })()`)
      const model = await measure()
      fs.writeFileSync(artifact('settings-model-back-ui.png'), (await wc.capturePage()).toPNG())
      await navigate('/settings/ai-tools', '.file-open-settings-page .back-btn')
      await waitFor('!!document.querySelector("#tool-search-provider")')
      const tools = await measure()
      assert.deepEqual(tools, model)
      assert.deepEqual(tools.offset, { x: 16, y: 12 })
      assert.equal(tools.style.transitionProperty, 'all')
      report.steps.push({ name: '模型页与新设置页返回按钮位置、计算样式、箭头完全一致', model, tools })
      const sections = await wc.executeJavaScript('[...document.querySelectorAll(".group-title")].map(e=>e.textContent.trim())')
      const labels = JSON.parse(fs.readFileSync(path.join(root, 'src/i18n/locales/zh-CN/office.json'), 'utf8')).services
      for (const key of ['search', 'localSearch', 'imageGeneration', 'imageAnalysis', 'videoAnalysis']) assert.ok(sections.includes(labels[key]), '缺少二级内容: ' + labels[key])
      report.steps.push({ name: '二级内容保留 GenOffice 五项设置', sections })
      fs.writeFileSync(artifact('settings-ai-tools-ui.png'), (await wc.capturePage()).toPNG())
      await wc.executeJavaScript('document.querySelector(".toggle-switch input").click()')
      await waitFor('!!document.querySelector("#tool-rerank-endpoint")')
      await wc.executeJavaScript('document.querySelector("#tool-rerank-endpoint").value="custom";document.querySelector("#tool-rerank-endpoint").dispatchEvent(new Event("change",{bubbles:true}))')
      await waitFor('!!document.querySelector("#tool-rerank-url") && !!document.querySelector("#tool-rerank-model")')
      await wc.executeJavaScript('document.querySelector("#tool-rerank-endpoint").value="cloudflare";document.querySelector("#tool-rerank-endpoint").dispatchEvent(new Event("change",{bubbles:true}))')
      await waitFor('!!document.querySelector("#tool-rerank-account") && !!document.querySelector("#tool-rerank-cf-model")')
      report.steps.push({ name: 'Jev 开关、端点、自定义与 Cloudflare 条件字段可操作' })
      await wc.executeJavaScript('for(const id of ["image","analysis","video"]){const e=document.querySelector(`#tool-${id}-provider`);e.value="openai";e.dispatchEvent(new Event("change",{bubbles:true}))}')
      await waitFor('!!document.querySelector("#tool-image-key") && !!document.querySelector("#tool-analysis-key") && !!document.querySelector("#tool-video-key")')
      await wc.executeJavaScript('const e=document.querySelector("#tool-image-key");e.value="mock-key-for-ui-validation";e.dispatchEvent(new Event("input",{bubbles:true}))')
      await waitFor('document.querySelector("#tool-analysis-key").value === "mock-key-for-ui-validation" && document.querySelector("#tool-video-key").value === "mock-key-for-ui-validation"')
      await wc.executeJavaScript('document.querySelector("form").dispatchEvent(new Event("submit",{bubbles:true,cancelable:true}))')
      await waitFor('window.__settingsProbeCalls.some(c=>c.kind === "save" && c.hasMockKey)')
      await wc.executeJavaScript('document.querySelector(".actions button").click()')
      await waitFor('window.__settingsProbeCalls.some(c=>c.kind === "test" && c.aggregate)')
      report.steps.push({ name: '同提供商三项媒体字段共享输入；保存与测试调用配置接口（仅模拟 IPC）' })
      await wc.executeJavaScript('document.querySelector(".back-btn").click()')
      await waitFor('location.hash === "#/settings" && !!document.querySelector(".settings-group .clickable")')
      const order = await wc.executeJavaScript(`(() => { const group=[...document.querySelectorAll('.settings-group')].find(e=>e.querySelector('.group-title')?.textContent.trim()==='AI工具');return [...group.querySelectorAll('.item-label')].map(e=>e.textContent.trim()) })()`)
      const entry = order.indexOf('生图、媒体与搜索')
      assert.equal(order[entry - 1], '模型设置')
      assert.equal(order[entry + 1], '开启笔记内容补全')
      await wc.executeJavaScript(`(() => {const row=[...document.querySelectorAll('.setting-item.clickable')].find(e=>e.textContent.includes('生图、媒体与搜索'));row.scrollIntoView({block:'center'});})()`)
      fs.writeFileSync(artifact('settings-ai-tools-entry-ui.png'), (await wc.capturePage()).toPNG())
      await wc.executeJavaScript(`(() => {const row=[...document.querySelectorAll('.setting-item.clickable')].find(e=>e.textContent.includes('生图、媒体与搜索'));row.click();})()`)
      await waitFor('location.hash === "#/settings/ai-tools" && !!document.querySelector(".back-btn")')
      report.steps.push({ name: '返回设置首页；入口顺序和点击路由正确', order })
      win.setContentSize(1150, 800)
      await new Promise(resolve => setTimeout(resolve, 100))
      const narrowTools = await measure()
      await navigate('/settings/model', '.model-settings-page .back-btn')
      const narrowModel = await measure()
      assert.deepEqual(narrowTools, narrowModel)
      report.steps.push({ name: '1150×800 窗口下返回按钮仍保持相同位置与样式', model: narrowModel, tools: narrowTools })
      const errors = await wc.executeJavaScript('window.__settingsProbeErrors || []')
      assert.deepEqual(errors, [])
      report.ok = true
    } catch (error) { report.error = { message: error.message, stack: error.stack }; if (win && !win.isDestroyed()) { report.page = await win.webContents.executeJavaScript('({text:document.body.innerText,errors:window.__settingsProbeErrors,ready:window.__settingsProbeReady})').catch(()=>null); fs.writeFileSync(artifact('settings-ai-tools-ui-failed.png'), (await win.webContents.capturePage()).toPNG()) }; process.exitCode = 1 }
    finally { persist(); if (win && !win.isDestroyed()) win.destroy(); app.exit(process.exitCode || 0) }
  })()
}
