import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import {
  createKnowledgeCategory,
  listKnowledgeCategories,
  renameKnowledgeCategory,
  moveKnowledgeCategory,
  moveKnowledgeBase,
  validateKnowledgeName
} from '../../src-electron/knowledge-categories.js'

test('knowledge categories persist with stable IDs and reject duplicate or invalid names', () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'friday-kb-category-'))
  try {
    const first = createKnowledgeCategory(dataDir, '项目资料')
    const second = createKnowledgeCategory(dataDir, '学习')
    assert.match(first.id, /^category-/)
    assert.deepEqual(listKnowledgeCategories(dataDir).map(item => item.name), ['项目资料', '学习'])
    assert.throws(() => createKnowledgeCategory(dataDir, '项目资料'), /已存在/)
    assert.throws(() => validateKnowledgeName('../坏名称'), /名称需为/)
    renameKnowledgeCategory(dataDir, first.id, '工作')
    assert.deepEqual(moveKnowledgeCategory(dataDir, second.id, -1).map(item => item.name), ['学习', '工作'])
    assert.deepEqual(listKnowledgeCategories(dataDir).map(item => item.name), ['学习', '工作'])
  } finally { fs.rmSync(dataDir, { recursive: true, force: true }) }
})

test('moving a knowledge base keeps its files and refuses a conflicting target', () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'friday-kb-move-'))
  try {
    const a = createKnowledgeCategory(dataDir, '分类甲')
    const b = createKnowledgeCategory(dataDir, '分类乙')
    const source = path.join(dataDir, 'knowledge', a.id, '文档')
    fs.mkdirSync(source)
    fs.writeFileSync(path.join(source, 'note.txt'), 'content')
    moveKnowledgeBase(dataDir, a.id, b.id, '文档')
    assert.equal(fs.readFileSync(path.join(dataDir, 'knowledge', b.id, '文档', 'note.txt'), 'utf8'), 'content')
    fs.mkdirSync(path.join(dataDir, 'knowledge', a.id, '文档'))
    assert.throws(() => moveKnowledgeBase(dataDir, a.id, b.id, '文档'), /同名/)
  } finally { fs.rmSync(dataDir, { recursive: true, force: true }) }
})
