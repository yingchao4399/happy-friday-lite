import { defineStore } from 'pinia'

export const useAppStore = defineStore('app', {
  state: () => ({
    sidebarVisible: true,
    moduleOrder: [],
    language: 'zh-CN',
    theme: 'light',
    loading: false,
    noteFimCompletion: true,
    scheduleDefaultView: 'month',
    // 文档默认打开方式：internal = 应用内置编辑器/查看器，system = 系统默认应用
    docOpenModes: {
      markdown: 'internal',
      word: 'internal',
      excel: 'internal',
      ppt: 'internal'
    },
    sidebarModules: {
      typewriter: true,
      trash: true,
      clipboard: true,
      recitation: true,
      note: true,
      drawing: true,
      knowledge: true,
      office: true,
      schedule: true,
      automation: true,
      harness: true,
      history: true
    },
  }),
  actions: {
    setModuleOrder(order = []) {
      this.moduleOrder = [...new Set(Array.isArray(order) ? order.filter(id => typeof id === 'string') : [])]
    },
    toggleSidebar() {
      this.sidebarVisible = !this.sidebarVisible
    },
    setSidebarVisible(visible) {
      this.sidebarVisible = visible
    },
    setLanguage(lang) {
      this.language = lang
    },
    setTheme(theme) {
      this.theme = theme
    },
    setNoteFimCompletion(value) {
      this.noteFimCompletion = value
    },
    setScheduleDefaultView(value) {
      this.scheduleDefaultView = value
    },
    setDocOpenModes(modes = {}) {
      this.docOpenModes = {
        ...this.docOpenModes,
        ...Object.fromEntries(
          Object.entries(modes).filter(([, v]) => v === 'internal' || v === 'system')
        )
      }
    },
    setSidebarModules(modules = {}) {
      this.sidebarModules = {
        typewriter: modules.typewriter !== false,
        trash: modules.trash !== false,
        clipboard: modules.clipboard !== false,
        recitation: modules.recitation !== false,
        note: modules.note !== false,
        drawing: modules.drawing !== false,
        knowledge: modules.knowledge !== false,
        office: modules.office !== false,
        schedule: modules.schedule !== false,
        automation: modules.automation !== false,
        harness: modules.harness !== false,
        history: modules.history !== false
      }
    },
  }
})
