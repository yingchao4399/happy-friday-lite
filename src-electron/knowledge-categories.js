import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import { deleteResourceToTrash } from './trash.js'

const DEFAULT_IDS = new Set(['personal', 'local', 'agent'])

function root(dataDir) {
  return path.join(dataDir, 'knowledge')
}

function metadataPath(dataDir) {
  return path.join(root(dataDir), '.categories.json')
}

function readMetadata(dataDir) {
  try {
    const value = JSON.parse(fs.readFileSync(metadataPath(dataDir), 'utf8'))
    return Array.isArray(value) ? value.filter(item => /^[a-z0-9-]+$/.test(item.id) && !DEFAULT_IDS.has(item.id)) : []
  } catch (error) {
    if (error.code === 'ENOENT') return []
    throw error
  }
}

function writeMetadata(dataDir, categories) {
  fs.mkdirSync(root(dataDir), { recursive: true })
  const target = metadataPath(dataDir)
  const temporary = `${target}.${process.pid}.tmp`
  fs.writeFileSync(temporary, JSON.stringify(categories, null, 2), 'utf8')
  fs.renameSync(temporary, target)
}

export function validateKnowledgeName(value) {
  const name = String(value ?? '').trim()
  if (!name || name.length > 80 || name === '.' || name === '..' || /[<>:"/\\|?*\x00-\x1f]/.test(name) || /[. ]$/.test(name)) {
    throw new Error('名称需为 1-80 个字符，不能包含系统保留字符或以句点结尾')
  }
  return name
}

function uniqueName(parent, name, oldName = '') {
  const duplicate = fs.readdirSync(parent, { withFileTypes: true })
    .some(item => item.name.toLocaleLowerCase() === name.toLocaleLowerCase() && item.name.toLocaleLowerCase() !== oldName.toLocaleLowerCase())
  if (duplicate) throw new Error('同一分类中已存在同名知识库')
}

export function listKnowledgeCategories(dataDir) {
  return readMetadata(dataDir).filter(item => fs.existsSync(path.join(root(dataDir), item.id)))
}

export function createKnowledgeCategory(dataDir, value) {
  const name = validateKnowledgeName(value)
  const items = readMetadata(dataDir)
  if (items.some(item => fs.existsSync(path.join(root(dataDir), item.id)) && item.name.toLocaleLowerCase() === name.toLocaleLowerCase())) throw new Error('分类名称已存在')
  const item = { id: `category-${crypto.randomUUID()}`, name }
  fs.mkdirSync(path.join(root(dataDir), item.id), { recursive: true })
  try { writeMetadata(dataDir, [...items, item]) } catch (error) {
    fs.rmdirSync(path.join(root(dataDir), item.id))
    throw error
  }
  return item
}

export function renameKnowledgeCategory(dataDir, id, value) {
  const name = validateKnowledgeName(value)
  const items = readMetadata(dataDir)
  const item = items.find(entry => entry.id === id)
  if (!item) throw new Error('分类不存在或不可编辑')
  if (items.some(entry => entry.id !== id && entry.name.toLocaleLowerCase() === name.toLocaleLowerCase())) throw new Error('分类名称已存在')
  item.name = name
  writeMetadata(dataDir, items)
  return item
}

export function moveKnowledgeCategory(dataDir, id, direction) {
  const items = readMetadata(dataDir)
  const visible = items.filter(item => fs.existsSync(path.join(root(dataDir), item.id)))
  const index = visible.findIndex(item => item.id === id)
  const target = index + direction
  if (index < 0 || target < 0 || target >= visible.length) throw new Error('无法移动到该位置')
  ;[visible[index], visible[target]] = [visible[target], visible[index]]
  writeMetadata(dataDir, [...visible, ...items.filter(item => !fs.existsSync(path.join(root(dataDir), item.id)))])
  return visible
}

export function deleteKnowledgeCategory(dataDir, id) {
  const items = readMetadata(dataDir)
  const item = items.find(entry => entry.id === id)
  if (!item) throw new Error('分类不存在或不可删除')
  const source = path.join(root(dataDir), id)
  return deleteResourceToTrash(source, { title: item.name })
}

export function moveKnowledgeBase(dataDir, sourceCategoryId, targetCategoryId, value) {
  const name = validateKnowledgeName(value)
  if (sourceCategoryId === targetCategoryId) throw new Error('请选择其他分类')
  const valid = new Set([...DEFAULT_IDS, ...listKnowledgeCategories(dataDir).map(item => item.id)])
  if (!valid.has(sourceCategoryId) || !valid.has(targetCategoryId) || targetCategoryId === 'agent') throw new Error('目标分类不可用')
  const source = path.join(root(dataDir), sourceCategoryId, name)
  const targetParent = path.join(root(dataDir), targetCategoryId)
  if (!fs.existsSync(source)) throw new Error('知识库目录不存在')
  uniqueName(targetParent, name)
  const target = path.join(targetParent, name)
  fs.renameSync(source, target)
  return { source, target }
}

