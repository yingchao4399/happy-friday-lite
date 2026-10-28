import { defineStore } from 'pinia'
import { defaultSettings, patchSettings, sanitizeSettings } from '@/features/typewriter/nocturne-core/app/nocturne/settings.ts'

const STORAGE_KEY = 'happy-friday-typewriter-settings'
const RECENTS_KEY = 'happy-friday-typewriter-recents'

function readJson(key, fallback) {
  try {
    const value = JSON.parse(localStorage.getItem(key) || 'null')
    return value ?? fallback
  } catch {
    return fallback
  }
}

function writeJson(key, value) {
  try { localStorage.setItem(key, JSON.stringify(key===STORAGE_KEY?{schemaVersion:1,settings:value}:value)) } catch {}
}
function readSettings(){const value=readJson(STORAGE_KEY,defaultSettings());return sanitizeSettings(value?.schemaVersion===1?value.settings:value)}

export const useTypewriterStore = defineStore('typewriter', {
  state: () => ({
    settings: readSettings(),
    recents: readJson(RECENTS_KEY, []),
    activeSource: null,
    activeSessionId: '',
    terminalState: 'idle',
    terminalError: '',
    draft: {
      id: 'blank',
      type: 'blank',
      title: '',
      path: '',
      content: '',
      dirty: false
    }
  }),
  actions: {
    patchSettings(patch) {
      this.settings = patchSettings(this.settings, patch)
      writeJson(STORAGE_KEY, this.settings)
    },
    resetSettings() {
      this.settings = defaultSettings()
      writeJson(STORAGE_KEY, this.settings)
    },
    setDraft(patch = {}) {
      this.draft = { ...this.draft, ...patch }
    },
    setSource(source) {
      this.activeSource = source
      if (source?.path) {
        const next = [{ ...source, lastOpenedAt: new Date().toISOString() }, ...this.recents.filter(item => item.path !== source.path)]
        this.recents = next.slice(0, 12)
        writeJson(RECENTS_KEY, this.recents)
      }
    },
    removeRecent(path) {
      this.recents = this.recents.filter(item => item.path !== path)
      writeJson(RECENTS_KEY, this.recents)
    },
    setTerminalState(state, error = '') {
      this.terminalState = state
      this.terminalError = error
    },
    setTerminalSession(id) {
      this.activeSessionId = id || ''
    }
  }
})
