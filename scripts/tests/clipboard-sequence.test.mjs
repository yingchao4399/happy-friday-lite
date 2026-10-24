import test from 'node:test'
import assert from 'node:assert/strict'
import {createClipboardSequence} from '../../src-electron/clipboard-sequence.js'

test('顺序粘贴锁定 ID 顺序、去重，成功推进，失败保留位置，暂停/恢复/跳过/取消可用',async()=>{
  const items=new Map([['a',{id:'a'}],['b',{id:'b'}],['secret',{id:'secret',sensitivity:'secret'}]])
  const calls=[];let deny=true
  const queue=createClipboardSequence({getItem:id=>items.get(id),paste:async(id,target)=>{calls.push([id,target]);if(id==='b'&&deny)throw Object.assign(new Error('denied'),{code:'CLIPBOARD_PASTE_INPUT_DENIED'});return {ok:true}}})
  queue.start(['a','a','b']);assert.equal(queue.state().total,2)
  await queue.next('target');assert.equal(queue.state().position,1)
  await assert.rejects(queue.next('target'),/denied/);assert.equal(queue.state().position,1);assert.equal(queue.state().error,'CLIPBOARD_PASTE_INPUT_DENIED')
  queue.pause(true);await assert.rejects(queue.next('target'),/PAUSED/);assert.equal(calls.length,2)
  queue.pause(false);deny=false;await queue.next('target');assert.equal(queue.state().active,false)
  assert.deepEqual(calls.map(c=>c[0]),['a','b','b'])
  queue.start(['a','b']);items.delete('a');await assert.rejects(queue.next('target'),/STALE/);assert.equal(queue.state().position,0)
  queue.skip();assert.equal(queue.state().position,1);queue.cancel();assert.equal(queue.state().total,0)
  assert.throws(()=>queue.start(['secret']),/SENSITIVE/);assert.equal(queue.state().total,0)
  assert.throws(()=>queue.start(['b','missing']),/STALE/);assert.equal(queue.state().total,0)
})

test('发送期间重复请求拒绝；取消会使在途动作失效，不越过新队列位置',async()=>{
  let release,cancelled
  const queue=createClipboardSequence({getItem:id=>({id}),paste:async(_id,_target,isCancelled)=>{cancelled=isCancelled;await new Promise(r=>release=r);if(isCancelled())throw Object.assign(new Error('cancelled'),{code:'CLIPBOARD_PASTE_CANCELLED'});return {ok:true}}})
  queue.start(['a','b']);const pending=queue.next('target')
  await assert.rejects(queue.next('target'),/BUSY/)
  assert.throws(()=>queue.start(['c']),/BUSY/)
  queue.cancel();assert.equal(cancelled(),true);release();await assert.rejects(pending,/cancelled/)
  assert.equal(queue.state().total,0);assert.equal(queue.state().position,0)
})
