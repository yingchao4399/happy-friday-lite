import test from 'node:test'
import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import {normalizeBinding,bindingFromEvent,scopesOverlap,isReservedBinding} from '../../src/features/shortcuts/keymap.js'
test('快捷键规范化、IME、AltGraph 与平台映射',()=>{
  assert.equal(normalizeBinding('shift+mod+p'),'Mod+Shift+P')
  assert.equal(normalizeBinding('Mod+Bogus+P'),'')
  assert.equal(bindingFromEvent({key:'p',ctrlKey:true,shiftKey:true}),'Mod+Shift+P')
  assert.equal(bindingFromEvent({key:'p',metaKey:true,shiftKey:true},{mac:true}),'Mod+Shift+P')
  assert.equal(bindingFromEvent({key:'<',code:'Comma',ctrlKey:true,shiftKey:true}),'Mod+Shift+,')
  assert.equal(bindingFromEvent({key:'p',ctrlKey:true,isComposing:true}),'')
  assert.equal(bindingFromEvent({key:'q',ctrlKey:true,altKey:true,getModifierState:()=>true}),'')
  assert.equal(scopesOverlap(['note'],['office']),false)
  assert.equal(scopesOverlap(['all'],['office']),true)
  assert.equal(isReservedBinding('Mod+C',['all']),true)
  assert.equal(isReservedBinding('Mod+P',['office']),true)
  assert.equal(isReservedBinding('Mod+S',['typewriter']),true)
  assert.equal(isReservedBinding('Mod+S',['note','typewriter.note']),false)
  assert.equal(isReservedBinding('Mod+Alt+P',['all']),false)
})
test('命令中英文词条完整且主进程共享键表包含在安装包',()=>{
  const read=lang=>JSON.parse(readFileSync(new URL(`../../src/i18n/locales/${lang}/workspace.json`,import.meta.url),'utf8'))
  const keys=(v,p='')=>Object.entries(v).flatMap(([k,x])=>typeof x==='object'?keys(x,p+k+'.'):[p+k]).sort()
  assert.deepEqual(keys(read('zh-CN')),keys(read('en-US')))
  const config=JSON.parse(readFileSync(new URL('../../package.json',import.meta.url),'utf8'))
  assert.ok(config.build.files.includes('src/features/shortcuts/keymap.js'))
})
