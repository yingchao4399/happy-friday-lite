async function currentWindow(ctx) {
  const { BrowserWindow } = await import('electron')
  const window = ctx?.mainWindow || BrowserWindow.getAllWindows().find(item => !item.isDestroyed())
  if (!window || window.isDestroyed()) throw new Error('Friday 窗口未运行')
  return window
}

function observePage(surface) {
  const state = window.__fridayUiState || { nextId: 1, ids: new WeakMap(), elements: new Map() }
  window.__fridayUiState = state
  for (const [id, element] of state.elements) if (!element.isConnected) state.elements.delete(id)
  const selectors = 'button,input,textarea,select,a,[role="button"],[role="tab"],[role="checkbox"],[contenteditable="true"]'
  const controls = []
  for (const element of document.querySelectorAll(selectors)) {
    const box = element.getBoundingClientRect()
    if (box.width < 2 || box.height < 2 || getComputedStyle(element).visibility === 'hidden') continue
    if (!state.ids.has(element)) {
      const id = `ui-${surface}-${state.nextId++}`
      state.ids.set(element, id)
      state.elements.set(id, element)
    }
    const tag = element.tagName.toLowerCase()
    const role = element.getAttribute('role') || (tag === 'input' ? element.type || 'textbox' : tag)
    const name = (element.getAttribute('aria-label') || element.getAttribute('title') || element.getAttribute('placeholder') || element.innerText || '').trim().replace(/\s+/g, ' ').slice(0, 120)
    const sensitive = element.type === 'password' || /token|key|secret/i.test(name)
    controls.push({
      id: state.ids.get(element), tag, role, name, contentEditable: element.isContentEditable,
      actionId: element.dataset.actionId || null,
      enabled: !element.disabled && element.getAttribute('aria-disabled') !== 'true',
      value: sensitive ? '[hidden]' : ['input', 'textarea', 'select'].includes(tag) ? String(element.value || '').slice(0, 200) : undefined,
      checked: ['checkbox', 'radio'].includes(element.type) ? !!element.checked : undefined,
      bounds: { x: Math.round(box.x), y: Math.round(box.y), width: Math.round(box.width), height: Math.round(box.height) }
    })
    if (controls.length >= 300) break
  }
  return { surface, url: location.href, route: location.hash, title: document.title, controls, truncated: controls.length >= 300 }
}

async function performOnPage(args) {
  const state = window.__fridayUiState
  const matches = args.actionId ? [...document.querySelectorAll('[data-action-id]')].filter(item => item.dataset.actionId === args.actionId && item.getBoundingClientRect().width > 1) : []
  if (args.actionId && matches.length > 1 && !args.id) throw new Error('此按钮有多个实例，请观察后使用具体控件 ID')
  const element = args.id ? state?.elements.get(args.id) : matches[0]
  if (!element || !element.isConnected) throw new Error('控件已变化，请重新观察界面')
  const box = element.getBoundingClientRect()
  if (box.width < 2 || box.height < 2 || getComputedStyle(element).visibility === 'hidden' || element.disabled || element.getAttribute('aria-disabled') === 'true') throw new Error('控件不可操作')
  element.focus()
  const before = { route: location.hash, text: document.body.innerText.slice(-8000), value: element.value, checked: element.checked, scroll: element.scrollTop }
  if (args.action === 'click') element.click()
  else if (args.action === 'fill') {
    if (element.isContentEditable) element.textContent = args.value
    else if ('value' in element) {
      const prototype = element.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype
      const setter = Object.getOwnPropertyDescriptor(prototype, 'value')?.set
      if (setter) setter.call(element, args.value)
      else element.value = args.value
    } else throw new Error('目标不是输入控件')
    element.dispatchEvent(new Event('input', { bubbles: true }))
    element.dispatchEvent(new Event('change', { bubbles: true }))
  } else if (args.action === 'select') {
    if (element.tagName !== 'SELECT') throw new Error('目标不是选择框')
    element.value = args.value
    element.dispatchEvent(new Event('change', { bubbles: true }))
  } else if (args.action === 'scroll') element.scrollTop += Number(args.value) || 300
  else if (args.action === 'press') {
    const key = String(args.value || 'Enter')
    element.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true }))
    element.dispatchEvent(new KeyboardEvent('keyup', { key, bubbles: true }))
  } else throw new Error('不支持的界面操作')
  await new Promise(resolve => setTimeout(resolve, 250))
  let verified = before.route !== location.hash || before.text !== document.body.innerText.slice(-8000) || before.value !== element.value || before.checked !== element.checked || before.scroll !== element.scrollTop
  const checks = []
  if (args.expect?.text) checks.push(document.body.innerText.includes(args.expect.text))
  if (args.expect?.route) checks.push(location.hash.includes(args.expect.route))
  if (args.expect?.selector) checks.push(!!document.querySelector(args.expect.selector))
  if (checks.length) verified = checks.every(Boolean)
  return { action: args.action, id: args.id || null, actionId: element.dataset.actionId || null, verified, route: location.hash, reason: verified ? null : '未观察到预期界面变化，请检查目标对象是否实际保存' }
}

export async function observeUi(ctx) {
  const window = await currentWindow(ctx)
  const { getOfficeUiTarget } = await import('../office/office-host.js')
  const target = getOfficeUiTarget()?.webContents || window.webContents
  return target.executeJavaScript(`(${observePage.toString()})(${target.id})`, true)
}

export async function performUi(args, ctx) {
  const window = await currentWindow(ctx)
  const { getOfficeUiTarget } = await import('../office/office-host.js')
  const target = getOfficeUiTarget()?.webContents || window.webContents
  if (args.id && !args.id.startsWith(`ui-${target.id}-`)) throw new Error('目标界面已切换，请重新观察控件')
  const result = await target.executeJavaScript(`(${performOnPage.toString()})(${JSON.stringify(args)})`, true)
  return result
}
