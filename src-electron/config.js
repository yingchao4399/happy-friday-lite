import fs from 'fs'
import path from 'path'
import { defaultConfig } from './types.js'
import { AppError } from './error.js'

let dataDir = null

export function setDataDir(dir) {
  dataDir = dir
}

export function getDataDir() {
  return dataDir
}

function getConfigPath() {
  if (!dataDir) {
    throw AppError.config('Data directory not initialized')
  }
  return path.join(dataDir, 'config.json')
}

function recoverCorruptConfig(configPath, error) {
  const fallback = defaultConfig()
  try {
    // 保留损坏文件供诊断，写入一份完整默认配置，避免后续每次启动都卡在同一解析错误。
    const backupPath = `${configPath}.corrupt-${Date.now()}`
    fs.renameSync(configPath, backupPath)
    saveConfig(fallback)
    console.warn(`[Config] Invalid config was moved to ${path.basename(backupPath)}; defaults restored (${error.message})`)
  } catch (repairError) {
    console.warn(`[Config] Failed to repair invalid config: ${repairError.message}`)
  }
  return fallback
}

function isPlainObject(value) {
  return value && typeof value === 'object' && !Array.isArray(value)
}

// Config writers are also used by feature-specific IPC handlers and older
// scripts that pass only the changed branch. Merge those patches with the
// existing document so one setting update cannot erase unrelated preferences.
function mergeConfig(base, patch) {
  if (!isPlainObject(base)) return isPlainObject(patch) ? { ...patch } : patch
  if (!isPlainObject(patch)) return patch === undefined ? { ...base } : patch
  const merged = { ...base }
  for (const [key, value] of Object.entries(patch)) {
    if (isPlainObject(value) && isPlainObject(base[key])) {
      merged[key] = mergeConfig(base[key], value)
    } else {
      merged[key] = value
    }
  }
  return merged
}

export function loadConfig() {
  const configPath = getConfigPath()

  if (!fs.existsSync(configPath)) {
    const config = defaultConfig()
    saveConfig(config)
    return config
  }

  try {
    const content = fs.readFileSync(configPath, 'utf-8')
    let parsed
    try {
      parsed = JSON.parse(content)
    } catch (error) {
      if (error instanceof SyntaxError) return recoverCorruptConfig(configPath, error)
      throw error
    }
    // 合法 JSON 但不是对象（例如误写入 null/数组/字符串）也不能让整个
    // 应用启动失败；按字段回退默认值，同时保留可恢复的对象字段。
    const raw = parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {}
    const defaults = defaultConfig()
    // 顶层合并之外，对用户会逐项修改的嵌套配置做字段级合并，避免旧版本缺少一个字段时整组设置回退默认。
    return {
      ...defaults,
      ...raw,
      globalAgentDock: { ...defaults.globalAgentDock, ...(raw.globalAgentDock || {}) },
      sidebarModules: { ...defaults.sidebarModules, ...(raw.sidebarModules || {}) },
      backup: { ...defaults.backup, ...(raw.backup || {}) },
      history: { ...defaults.history, ...(raw.history || {}) },
      python: { ...defaults.python, ...(raw.python || {}) },
      fontSize: [14, 16, 18].includes(Number(raw.fontSize)) ? Number(raw.fontSize) : defaults.fontSize
    }
  } catch (e) {
    throw AppError.config(`Failed to load config: ${e.message}`)
  }
}

export function saveConfig(config) {
  const configPath = getConfigPath()
  try {
    if (!isPlainObject(config)) throw new Error('Configuration must be an object')
    const dir = path.dirname(configPath)
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true })
    }
    let existing = null
    try {
      if (fs.existsSync(configPath)) {
        const parsed = JSON.parse(fs.readFileSync(configPath, 'utf-8'))
        if (isPlainObject(parsed)) existing = parsed
      }
    } catch {
      // loadConfig handles malformed files explicitly; a save should still
      // produce a valid complete document instead of preserving bad JSON.
    }
    const nextConfig = mergeConfig(mergeConfig(defaultConfig(), existing || {}), config || {})
    const temporaryPath = `${configPath}.tmp-${process.pid}`
    fs.writeFileSync(temporaryPath, JSON.stringify(nextConfig, null, 2), 'utf-8')
    // 原子替换，避免应用退出或进程崩溃时留下半截配置导致所有选项恢复默认。
    fs.renameSync(temporaryPath, configPath)
  } catch (e) {
    try { fs.rmSync(`${configPath}.tmp-${process.pid}`, { force: true }) } catch (_e) {}
    throw AppError.config(`Failed to save config: ${e.message}`)
  }
}
