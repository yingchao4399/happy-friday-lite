import path from 'node:path'
import { getDataDir } from '../config.js'

export const KB_TYPES = ['personal', 'local']

export function inferKbType(filePath) {
  const relativePath = path.relative(path.join(getDataDir(), 'knowledge'), filePath)
  if (relativePath.startsWith('personal')) return 'personal'
  if (relativePath.startsWith('local')) return 'local'
  return null
}

export function getKbRootPath(kbType) { return path.join(getDataDir(), 'knowledge', kbType) }
