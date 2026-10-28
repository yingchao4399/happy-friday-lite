import {reactive} from 'vue'
import {i18n} from '@/i18n'
import {electronService} from '@/services/electron'
import {registerCommand,commandState,commandContext} from '@/features/commands/registry'
import {getActiveEditor} from '@/features/commands/editor-context'
import {flushContent} from '@/features/typewriter/content-plugin'
import {useNoteStore} from '@/store/modules/note'
export const pluginState=reactive({records:[],busy:'',error:'',notice:''})
const disposers=new Map()
export async function refreshPlugins(){const records=await electronService.request('plugins-list');sync(records);return records}
function sync(records){
  pluginState.records=records
  for(const dispose of disposers.values())dispose();disposers.clear()
  for(const record of records){if(!record.running)continue
    if(record.manifest.format==='obsidian'){const id='plugin.'+record.manifest.id+'.markdown';disposers.set(id,registerCommand({id,title:String(i18n.global.t('workspace.plugins.markdown'))+' · '+record.manifest.name,category:'plugins',source:record.manifest.name,contexts:['note','typewriter.note'],run:async ctx=>{await flushContent();await useNoteStore().flushPendingSave();await electronService.request('plugins-markdown',{id:record.manifest.id,noteId:ctx.editor.noteId()})}}))}
    for(const command of record.commands){const id='plugin.'+record.manifest.id+'.'+command.id
      disposers.set(id,registerCommand({id,title:command.name,category:record.manifest.category==='obsidian'?'plugins':record.manifest.category,source:record.manifest.name,contexts:command.editor?['note','typewriter.note']:['all'],defaultBindings:[],run:ctx=>runPlugin(record.manifest.id,command.id,ctx)}))
    }
  }
}
export async function runPlugin(id,command,ctx){
  const notes=useNoteStore();await flushContent();await notes.flushPendingSave()
  const editor=ctx?ctx.editor:getActiveEditor(),snapshot=editor?.getValue(),selection=editor?.getSelection(),noteId=editor?.noteId?.()||null
  const result=await electronService.request('plugins-execute',{id,command,context:{noteId,selection,text:snapshot}})
  if(result?.operations?.length){
    if(!editor||getActiveEditor()!==editor||editor.noteId?.()!==noteId||editor.getValue()!==snapshot||JSON.stringify(editor.getSelection())!==JSON.stringify(selection))throw new Error('NOTE_REVISION_CONFLICT')
    for(const operation of result.operations){if(operation.type!=='replaceSelection'||typeof operation.text!=='string')throw new Error('PLUGIN_EDITOR_OPERATION_UNSUPPORTED');editor.replaceSelection(operation.text)}
    await flushContent();await notes.flushPendingSave()
  }
  return result
}
export async function pluginAction(action,args={}){
  if(pluginState.busy)return
  pluginState.busy=args.id||action;pluginState.error=''
  try{return await electronService.request('plugins-'+action,args)}catch(error){pluginState.error=error.message;throw error}finally{pluginState.busy='';await refreshPlugins()}
}
export function setupPlugins(){
  let timer
  const contextChanged=()=>{clearTimeout(timer);timer=setTimeout(()=>{if(!pluginState.records.some(r=>r.running&&r.manifest.format==='obsidian'))return;const ctx=commandContext(),editor=ctx.editor;void electronService.request('plugins-context',{context:editor?{noteId:editor.noteId(),text:editor.getValue(),selection:editor.getSelection()}:null}).catch(()=>{})},150)}
  for(const event of ['focusin','selectionchange','input'])document.addEventListener(event,contextChanged,true)
  const unlisten=electronService.listen('plugins-changed',({payload})=>sync(payload))
  const unnotice=electronService.listen('plugins-notice',({payload})=>{pluginState.notice=payload.message;setTimeout(()=>{pluginState.notice=''},6000)})
  void refreshPlugins().catch(()=>{})
  return()=>{clearTimeout(timer);for(const event of ['focusin','selectionchange','input'])document.removeEventListener(event,contextChanged,true);unlisten();unnotice();for(const dispose of disposers.values())dispose();disposers.clear()}
}
