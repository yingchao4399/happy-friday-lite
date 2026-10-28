import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import {extractNoteLinks} from '../../src-electron/notes/link-index.js'
import * as db from '../../src-electron/db.js'

test('正文引用排除代码并保留别名和标题',()=>{
  const links=extractNoteLinks('[[目标#小节|别名]]\n`[[伪链接]]`\n```md\n[[代码]]\n```\n[正文](friday://notes/abc)')
  assert.equal(links.length,2);assert.equal(links[0].heading,'小节');assert.equal(links[0].alias,'别名');assert.equal(links[1].targetNoteId,'abc')
  assert.equal(extractNoteLinks('<p>[[真实]]</p><pre>[[代码]]</pre>').length,1)
})

test('链接方向、删除、重命名、未解析恢复与版本冲突',async()=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'friday-links-'));db.setDataDir(dir);await db.initDb()
  try{
    const a=db.createNote(null,null,'A'),b=db.createNote(null,null,'B')
    let saved=db.updateNote(a.id,'A','<p>[[B]] [[尚不存在]]</p>','',undefined,undefined,0)
    assert.equal(saved.revision,1)
    assert.equal(db.getNoteLinks(a.id).outgoing[0].targetNoteId,b.id)
    assert.equal(db.getNoteLinks(b.id).incoming[0].sourceNoteId,a.id)
    assert.equal(db.getNoteLinks(b.id).outgoing.length,0)
    assert.throws(()=>db.updateNote(a.id,'A','覆盖','',undefined,undefined,0),/NOTE_REVISION_CONFLICT/)
    assert.match(db.getNote(a.id).content,/尚不存在/)
    db.updateNote(b.id,'新标题','','',undefined,undefined,0)
    assert.equal(db.getNoteLinks(a.id).outgoing[0].title,'新标题')
    const target=db.createNote(null,null,'尚不存在')
    assert.ok(db.getNoteLinks(a.id).outgoing.some(link=>link.targetNoteId===target.id))
    db.updateNote(a.id,'A','<p>已删除引用</p>','',undefined,undefined,1)
    assert.equal(db.getNoteLinks(b.id).incoming.length,0)
    const related=db.createNote(null,null,'旧关联')
    db.linkResources(`friday://notes/${a.id}`,`friday://notes/${related.id}`,'note-bidirectional','旧关系','test')
    db.linkResources(`friday://notes/${related.id}`,`friday://notes/${a.id}`,'note-bidirectional','旧关系','test')
    assert.equal(db.getNoteLinks(a.id).related.length,1)
    db.updateNote(a.id,'A','<p>[[新标题]] [[不存在1]] [[新标题]] [[不存在2]]</p>','',undefined,undefined,2)
    const first=db.getNoteLinks(a.id,{limit:1}),second=db.getNoteLinks(a.id,{limit:1,offset:1})
    assert.equal(first.outgoing.length,1);assert.equal(first.unresolved.length,1)
    assert.equal(second.outgoing.length,1);assert.equal(second.unresolved.length,1)
    assert.notEqual(first.outgoing[0].id,second.outgoing[0].id)
    assert.notEqual(first.unresolved[0].id,second.unresolved[0].id)
  }finally{db.closeDb();fs.rmSync(dir,{recursive:true,force:true})}
})
