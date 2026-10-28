// 真实 xterm Canvas 渲染：旧适配与新适配的颜色像素、透明度、ANSI/真彩色对照。
import {app, BrowserWindow} from 'electron'
import {build} from 'vite'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import assert from 'node:assert/strict'
const root=process.cwd(),temp=fs.mkdtempSync(path.join(os.tmpdir(),'friday-ink-regression-'))
const entry=path.join(root,'terminal-colors-probe.html'),output=path.join(root,'artifacts/typewriter')
app.setPath('userData',path.join(temp,'profile'))
let win
app.whenReady().then(async()=>{
const timer=setTimeout(()=>app.exit(1),60000)
try {
  fs.writeFileSync(entry,`<html><body style="background:#f1e9d6"><div id="term"></div><script type="module">
import {Terminal} from 'xterm';import {CanvasAddon} from 'xterm-addon-canvas';import 'xterm/css/xterm.css';
import {PAPERS} from '/src/features/typewriter/nocturne-core/app/nocturne/papers.ts';
import {terminalTheme} from '/src/features/typewriter/plugins/terminal-theme.js';
window.inspectInk=async(legacy=false,paperId='laid')=>{
const paper=PAPERS[paperId],host=document.getElementById('term');host.replaceChildren();host.style.background=paper.paper;
const theme=legacy?{...paper.ansi,background:'#00000000',foreground:paper.ink}:terminalTheme(paper);
const term=new Terminal({cols:35,rows:5,fontFamily:'Consolas',fontSize:24,allowTransparency:true,allowProposedApi:true,minimumContrastRatio:4.5,theme});term.open(host);const addon=new CanvasAddon();term.loadAddon(addon);
await new Promise(resolve=>term.write('MMMM\\r\\n\\x1b[93mMMMM\\r\\n\\x1b[95mMMMM\\r\\n\\x1b[38;2;255;255;0mMMMM\\x1b[0m',resolve));
await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));
const canvas=host.querySelector('.xterm-text-layer'),ctx=canvas.getContext('2d'),d=term._core._renderService.dimensions.device.cell;
const rows=[];for(let row=0;row<4;row++){const pixels=ctx.getImageData(0,Math.floor(row*d.height),Math.floor(d.width*4),Math.floor(d.height)).data;const counts=new Map();let blank=0;for(let p=0;p<pixels.length;p+=4){if(pixels[p+3]===0){blank++;continue;}if(pixels[p+3]<150)continue;const key=[pixels[p],pixels[p+1],pixels[p+2]].join(',');counts.set(key,(counts.get(key)||0)+1)}const top=[...counts].sort((a,b)=>b[1]-a[1])[0];if(!top)throw new Error('No glyph pixels '+JSON.stringify({row,d,canvas:[canvas.width,canvas.height],text:term.buffer.active.getLine(row)?.translateToString()}));rows.push({color:top[0].split(',').map(Number),blank})}
const result={legacy,paperId,theme,ansi:term._core._themeService.colors.ansi.slice(0,16).map(c=>c.css),rows};addon.dispose();term.dispose();return result;
};</script></body></html>`)
  await build({root,configFile:false,logLevel:'error',base:'./',build:{outDir:path.join(temp,'site'),rollupOptions:{input:entry}}})
  win=new BrowserWindow({show:false,width:900,height:600,webPreferences:{backgroundThrottling:false}})
  await win.loadFile(path.join(temp,'site','terminal-colors-probe.html'))
  win.showInactive()
  await new Promise(resolve=>setTimeout(resolve,400))
  const run=code=>win.webContents.executeJavaScript(code,true)
  const luminance=rgb=>rgb.map(c=>{c/=255;return c<=.03928?c/12.92:((c+.055)/1.055)**2.4}).reduce((s,c,i)=>s+c*[.2126,.7152,.0722][i],0)
  const ratio=(a,b)=>{const aa=luminance(a),bb=luminance(b);return(Math.max(aa,bb)+.05)/(Math.min(aa,bb)+.05)}
  const paper=[241,233,214],legacy=await run('inspectInk(true)'),fixed=await run('inspectInk(false)'),night=await run("inspectInk(false,'night')")
  assert.ok(ratio(legacy.rows[1].color,paper)<2,'旧版应复现浅纸亮黄色')
  assert.deepEqual(fixed.rows[0].color,[42,32,25],'普通文字必须保持选中墨色')
  for(const row of fixed.rows){assert.ok(ratio(row.color,paper)>=4.45,JSON.stringify(row));assert.ok(row.blank>10,'字符背景必须保持透明，不能盖住纸纹')}
  for(const row of night.rows)assert.ok(ratio(row.color,[29,26,32])>=4.45)
  fs.mkdirSync(output,{recursive:true});fs.writeFileSync(path.join(output,'terminal-colors-report.json'),JSON.stringify({ok:true,legacy,fixed,night},null,2))
  console.log(JSON.stringify({ok:true,legacy:legacy.rows,fixed:fixed.rows,night:night.rows}))
} catch(error) { console.error(error);process.exitCode=1 }
finally {clearTimeout(timer);win?.destroy();fs.rmSync(entry,{force:true});app.quit()}
})
