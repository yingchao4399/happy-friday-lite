import fs from 'node:fs'
import path from 'node:path'
import { app } from 'electron'

const settingsPath = () => path.join(app.getPath('userData'), 'app-settings.json')

function readSettings() {
  try {
    const value = JSON.parse(fs.readFileSync(settingsPath(), 'utf8'))
    return value && typeof value === 'object' && !Array.isArray(value) ? value : {}
  } catch {
    return {}
  }
}

export function getDefaultSaveDir() {
  const dir = readSettings().defaultSaveDir
  if (typeof dir !== 'string' || !path.isAbsolute(dir)) return null
  try {
    return fs.statSync(dir).isDirectory() ? dir : null
  } catch {
    return null
  }
}

export function defaultSavePath(suggestion) {
  if (typeof suggestion !== 'string' || !suggestion || path.isAbsolute(suggestion)) return suggestion
  const dir = getDefaultSaveDir()
  return dir ? path.join(dir, path.basename(suggestion)) : suggestion
}

export function setDefaultSaveDir(dir) {
  if (dir !== null && (typeof dir !== 'string' || !path.isAbsolute(dir))) throw new Error('Invalid save directory')
  if (dir) {
    if (!fs.statSync(dir).isDirectory()) throw new Error('Save location is not a directory')
    fs.accessSync(dir, fs.constants.W_OK)
  }
  const next = { ...readSettings() }
  if (dir) next.defaultSaveDir = dir
  else delete next.defaultSaveDir
  const file = settingsPath()
  fs.mkdirSync(path.dirname(file), { recursive: true })
  const temporary = `${file}.tmp-${process.pid}`
  try {
    fs.writeFileSync(temporary, JSON.stringify(next, null, 2), 'utf8')
    fs.renameSync(temporary, file)
  } finally {
    if (fs.existsSync(temporary)) fs.rmSync(temporary, { force: true })
  }
  return dir
}
