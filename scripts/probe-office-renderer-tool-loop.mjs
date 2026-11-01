// 四类真实编辑器中运行原版 AgentLoop/transport，经 preload、AI Core 和真实模型续轮。
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'

const filename = fileURLToPath(import.meta.url)
const root = fileURLToPath(new URL('../', import.meta.url))
const rounds = Number(process.env.OFFICE_TOOL_ROUNDS || 25)
if (!process.versions.electron) {
  const { spawn } = await import('node:child_process')
  const env = {...process.env}; delete env.ELECTRON_RUN_AS_NODE
  const child = spawn(createRequire(import.meta.url)('electron'), [filename], {cwd:root,env,windowsHide:true,stdio:'inherit'})
  const deadline = setTimeout(() => child.kill(), 30*60*1000)
  process.exitCode = await new Promise(resolve => {child.once('error',()=>resolve(1));child.once('exit',code=>resolve(code??1))})
  clearTimeout(deadline)
} else {
  const {app,BrowserWindow,ipcMain} = await import('electron')
  const {build} = await import('esbuild')
  const db = await import('../src-electron/db.js')
  const {setDataDir} = await import('../src-electron/config.js')
  const host = await import('../src-electron/office/office-host.js')
  const {registerOfficeAiBridge,setOfficeAiModel} = await import('../src-electron/office/office-ai-bridge.js')
  await import('../src-electron/agent/tools/builtin/aiChat.js')
  const temp = fs.mkdtempSync(path.join(os.tmpdir(),'friday-office-renderer-loop-'))
  app.setPath('userData',path.join(temp,'profile'))
  app.on('window-all-closed',()=>{})
  const report={ok:false,checkedAt:new Date().toISOString(),kindResults:[],scope:'真实 Office renderer / 原版 AgentLoop + 各自 transport / preload IPC / AI Core / 真模型；工具执行读取当前编辑器状态'}
  const pause=ms=>new Promise(resolve=>setTimeout(resolve,ms))
  let win
  app.whenReady().then(async()=>{
    try {
      const config=JSON.parse(fs.readFileSync(process.env.FRIDAY_CONFIG_PATH||path.join(root,'app-data/config.json'),'utf8'))
      const model=config.customModels?.find(item=>item.id===config.selectedModelId)||config.customModels?.[0]
      assert.ok(model?.apiKey&&model?.baseUrl&&model?.modelName,'需要已配置的真实模型')
      report.model=model.modelName
      setDataDir(temp);db.setDataDir(temp);await db.initDb()
      // 隔离宿主仅接线编辑器加载所需的空初始状态，不替换模型/编辑器实现。
      ipcMain.handle('project:resolveChat',()=>null)
      win=new BrowserWindow({show:true,width:1200,height:900,webPreferences:{sandbox:true}})
      assert.equal(await host.initOfficeHost(win),true)
      host.setOfficeContentBounds({x:0,y:0,width:1200,height:860})
      for (const kind of ['docs','sheets','slides','pdf']) {
        const source=path.join(temp,'工具续轮.'+{docs:'docx',sheets:'xlsx',slides:'pptx',pdf:'pdf'}[kind])
        if(kind==='docs')fs.copyFileSync(path.join(root,'vendor/happyoffice/fixtures/generated/kitchen-sink.docx'),source)
        else if(kind==='sheets'){
          const XLSX=(await import('xlsx')).default,book=XLSX.utils.book_new()
          XLSX.utils.book_append_sheet(book,XLSX.utils.aoa_to_sheet([['验收',42]]),'工具续轮');XLSX.writeFile(book,source)
        }else if(kind==='slides'){
          const PptxGenJS=(await import('pptxgenjs')).default,deck=new PptxGenJS()
          deck.addSlide().addText('Office tool loop acceptance',{x:1,y:1,w:6,h:2});await deck.writeFile({fileName:source})
        }else{
          const require=createRequire(path.join(root,'vendor/happyoffice/apps/pdf/package.json'))
          const pdf=await require('pdf-lib').PDFDocument.create();pdf.addPage().drawText('Office tool loop acceptance');fs.writeFileSync(source,await pdf.save())
        }
        const opened=await host.openOfficeFile(source);assert.equal(opened.success,true)
        const wc=host.getOfficeUiTarget().webContents
        for(let i=0;i<300;i++){
          const ready=await wc.executeJavaScript(kind==='docs'?'Boolean(window.__aidocs?.editor?.state.doc.content.size>10)':'window.__genofficeControl?.({cmd:"selection"})?.status==="ok"')
          if(ready)break
          assert.ok(i<299,kind+'未就绪');await pause(100)
        }
        registerOfficeAiBridge();setOfficeAiModel(model)
        const bundle=await build({stdin:{contents:`
          import {AgentLoop} from './vendor/happyoffice/packages/agent-core/src/index.ts'
          import {createElectronTransport} from './vendor/happyoffice/apps/${kind}/src/renderer/ai/transport.ts'
          globalThis.runOfficeAcceptance = () => new Promise((resolve,reject)=>{
            const rounds=${rounds}, calls=[], timings=[], envelopes=[]
            const base=createElectronTransport(()=>({provider:'genspark',providers:{genspark:{apiKey:'friday-managed',model:'Friday'}},maxOutputTokens:8192}))
            const transport={stream(request,callbacks){const start=performance.now();let first=false;envelopes.push({roles:request.messages.map(m=>m.role),toolResults:request.messages.filter(m=>m.role==='tool').length});return base.stream(request,{...callbacks,onDelta(text){if(!first){first=true;timings.push(performance.now()-start)}callbacks.onDelta(text)},onToolCall(call){if(!first){first=true;timings.push(performance.now()-start)}callbacks.onToolCall(call)}})}}
            const skill={id:'office-acceptance',systemPrompt:'Run exactly '+rounds+' sequential read-only tool calls. Call probe_step once per step with increasing integers starting at 1. After each result continue to the next integer. After the last result answer COMPLETE. Never skip or repeat a step.',tools:[{name:'probe_step',description:'Read current editor state for one acceptance step.',inputSchema:{type:'object',properties:{step:{type:'integer',minimum:1,maximum:rounds}},required:['step'],additionalProperties:false}}],executeTool(call){
              if(call.name!=='probe_step'||call.input.step!==calls.length+1)throw Error('工具顺序错误')
              const actual=${kind==='docs'?'({status:"ok",size:window.__aidocs.editor.state.doc.content.size})':'window.__genofficeControl({cmd:"selection"})'}
              if(actual?.status!=='ok')throw Error('真实编辑器读取失败')
              calls.push({step:call.input.step,hasId:Boolean(call.id),editorRead:true})
              return {output:JSON.stringify({ok:true,step:call.input.step,editorRead:true,next:call.input.step<rounds?call.input.step+1:'COMPLETE'}),summary:'读取编辑器状态'}
            }}
            const loop=new AgentLoop({transport,skill,maxTurns:rounds+2,maxHistory:1000,compaction:false,events:{onDone(result){resolve({result,calls,timings,envelopes,messageCount:loop.messages.length})},onError(error){reject(Error(error))}}})
            window.officeAcceptanceLoop=loop
            loop.run('Perform all '+rounds+' read-only steps now, one tool call per round.')
          })
        `,resolveDir:root,loader:'ts'},bundle:true,format:'iife',platform:'browser',write:false,logLevel:'silent',plugins:[{
          name:'验收独立打包仅替换Vite语言资源加载',setup(builder){
            builder.onLoad({filter:/[\\/]i18n[\\/]locale\.[tj]sx?$/},()=>({contents:'export const t = key => key',loader:'js'}))
          }
        }]})
        await wc.executeJavaScript(bundle.outputFiles[0].text)
        const result=await wc.executeJavaScript('runOfficeAcceptance()',true)
        assert.equal(result.calls.length,rounds,kind+'工具轮数');assert.ok(result.calls.every(c=>c.hasId&&c.editorRead))
        assert.equal(result.result.cancelled,false);assert.equal(result.result.turnLimit,false);assert.match(result.result.text,/COMPLETE/)
        assert.equal(result.envelopes.length,rounds+1)
        assert.equal(result.envelopes.at(-1).toolResults,rounds)
        const sorted=[...result.timings].sort((a,b)=>a-b)
        report.kindResults.push({kind,ok:true,rounds:result.calls.length,requests:result.envelopes.length,toolContinuations:result.envelopes.length-1,firstEventP95Ms:Math.round(sorted[Math.ceil(sorted.length*.95)-1]),messageCount:result.messageCount})
        fs.writeFileSync(path.join(root,'artifacts/preview22-office-renderer-tool-loop-report.json'),JSON.stringify(report,null,2))
        console.log(JSON.stringify(report.kindResults.at(-1)))
        assert.equal(await host.closeOfficeFile(opened.viewId),true)
      }
      report.ok=report.kindResults.length===4
    }catch(error){report.error=error.stack||String(error);console.error(report.error)}
    finally{
      fs.writeFileSync(path.join(root,'artifacts/preview22-office-renderer-tool-loop-report.json'),JSON.stringify(report,null,2))
      setOfficeAiModel(null);host.shutdownOfficeHost();db.closeDb();if(win&&!win.isDestroyed())win.destroy();app.exit(report.ok?0:1)
    }
  })
}
