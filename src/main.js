import { createApp } from 'vue'
import { pinia } from './store'
import { router } from './router'
import { i18n } from './i18n'
import { renderScan } from './utils/render-scan'
import './assets/styles/main.css'
import App from './App.vue'
import GlobalAgentDock from './components/ai-core/GlobalAgentDock.vue'

// The desktop app does not use Tab-based focus navigation.
window.addEventListener('keydown', (event) => {
  if (event.key !== 'Tab') return
  // 新增页面和排序操作保留键盘路径；Ctrl+Tab 由原有标签栏处理。
  if (event.ctrlKey || event.target?.closest?.('.friday-page, .clipboard-page, .clipboard-pinned, .clipboard-quick, .module-settings-page, [role=dialog], [role=tablist]')) return
  // Note editor handles Tab for indentation and list nesting.
  const target = event.target instanceof Element ? event.target : null
  if (target?.closest('[contenteditable="true"]')) return
  event.preventDefault()
  if (document.activeElement instanceof HTMLElement) {
    document.activeElement.blur()
  }
}, true)

async function mountApp() {
  // 所有 body-level 浮层的共同挂载点；组件仍可通过 Teleport 管理焦点和层级。
  if (!document.getElementById('friday-overlay-root')) {
    const overlay = document.createElement('div')
    overlay.id = 'friday-overlay-root'
    overlay.setAttribute('data-overlay-root', 'true')
    document.body.appendChild(overlay)
  }
const pinnedWindow = window.location.hash.startsWith('#/clipboard-pin/')
const quickWindow = window.location.hash.startsWith('#/clipboard-quick')
const officeDockWindow = window.location.hash.includes('__officeDock=1')
if (officeDockWindow) {
  document.documentElement.style.background = 'transparent'
  document.documentElement.style.width = '100%'
  document.documentElement.style.height = '100%'
  document.body.style.background = 'transparent'
  document.body.style.width = '100%'
  document.body.style.height = '100%'
  document.body.style.overflow = 'hidden'
  document.getElementById('app').style.background = 'transparent'
  document.getElementById('app').style.width = '100%'
  document.getElementById('app').style.height = '100%'
}
const root = officeDockWindow
  ? GlobalAgentDock
  : quickWindow
    ? (await import('./views/clipboard/ClipboardQuick.vue')).default
    : pinnedWindow
      ? (await import('./views/clipboard/ClipboardPinned.vue')).default
      : App
const app = createApp(root, officeDockWindow ? { officeOverlay: true } : undefined)

app.use(pinia)
if (!pinnedWindow && !quickWindow) app.use(router)
app.use(i18n)

if (import.meta.env.DEV) {
  renderScan(app)
}

app.mount('#app')
}
mountApp()
