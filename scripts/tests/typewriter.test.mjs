// 原作单元验收直接运行迁移后的核心，不复制或重写实现。
import {build} from 'esbuild'
import {fileURLToPath} from 'node:url'
import {readdirSync,readFileSync} from 'node:fs'
import test from 'node:test'
import assert from 'node:assert/strict'
const tests=new URL('./typewriter-upstream/',import.meta.url)
const entry=readdirSync(tests).filter(n=>n.endsWith('.test.ts')).map(n=>`import ${JSON.stringify(fileURLToPath(new URL(n,tests)))}`).join('\n')
const compiled=await build({stdin:{contents:entry,resolveDir:process.cwd()},bundle:true,write:false,format:'esm',platform:'node',logLevel:'error'})
await import('data:text/javascript;base64,'+Buffer.from(compiled.outputFiles[0].text).toString('base64'))
test('Typewriter 中英文 key 完整且没有空文案',()=>{
 const read=lang=>JSON.parse(readFileSync(new URL(`../../src/i18n/locales/${lang}/typewriter.json`,import.meta.url),'utf8'))
 const keys=(v,p='')=>Object.entries(v).flatMap(([k,x])=>typeof x==='object'?keys(x,p+k+'.'):[p+k]).sort()
 const zh=read('zh-CN'),en=read('en-US');assert.deepEqual(keys(zh),keys(en))
 const check=v=>Object.values(v).forEach(x=>typeof x==='object'?check(x):assert.ok(typeof x==='string'&&x.trim()))
 check(zh);check(en)
})
