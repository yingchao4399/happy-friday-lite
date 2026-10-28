import test from 'node:test'
import assert from 'node:assert/strict'
import {parseNoteUri,noteLinkAt,resolveNoteTarget} from '../../src/features/notes/link-target.js'
import {requestNoteLocation,consumeNoteLocation} from '../../src/features/notes/location.js'

test('隐藏的笔记编辑器不能消费打字机定位请求',()=>{
  const originalWindow=globalThis.window,originalEvent=globalThis.CustomEvent
  globalThis.window=new EventTarget()
  globalThis.CustomEvent=class extends Event {constructor(type,options){super(type);this.detail=options.detail}}
  try {
    requestNoteLocation({noteId:'b',heading:'章节'},'typewriter')
    assert.equal(consumeNoteLocation('b'),null)
    assert.deepEqual(consumeNoteLocation('b','typewriter'),{noteId:'b',heading:'章节',surface:'typewriter'})
    assert.equal(consumeNoteLocation('b','typewriter'),null)
  } finally {globalThis.window=originalWindow;globalThis.CustomEvent=originalEvent}
})

test('应用内笔记 URI、标题锚点及纯文本链接点击位置',()=>{
  assert.deepEqual(parseNoteUri('friday://notes/note-17#%E6%A0%87%E9%A2%98'),{noteId:'note-17',heading:'标题'})
  assert.equal(parseNoteUri('https://notes/note-17'),null)
  const wiki='xx [[目标#标题|别名]] yy',md='[目标](friday://notes/note-17#heading)'
  assert.equal(noteLinkAt(wiki,8),'目标#标题|别名')
  assert.equal(noteLinkAt(wiki,0),null)
  assert.equal(noteLinkAt(String.raw`\[\[目标#标题|别名\]\]`,8),'目标#标题|别名')
  assert.equal(noteLinkAt(md,15),'friday://notes/note-17#heading')
})
test('重名和回收站笔记禁止误跳转；稳定 ID 与标题均校验目标',async()=>{
  const notes=[{id:'a',title:'目标'},{id:'b',title:'同名'},{id:'c',title:'同名'},{id:'d',title:'已删除',isDeleted:true}]
  globalThis.window={electronAPI:{invoke:async(command,args)=>command==='get_note'?notes.find(n=>n.id===args.noteId):notes}}
  assert.deepEqual(await resolveNoteTarget('目标#标题|别名'),{noteId:'a',heading:'标题'})
  assert.deepEqual(await resolveNoteTarget('friday://notes/a'),{noteId:'a',heading:''})
  await assert.rejects(resolveNoteTarget('同名'),/NOTE_LINK_AMBIGUOUS/)
  await assert.rejects(resolveNoteTarget('friday://notes/d'),/NOTE_LINK_UNRESOLVED/)
  await assert.rejects(resolveNoteTarget('friday://notes/missing'),/NOTE_LINK_UNRESOLVED/)
  delete globalThis.window
})
