import {watch} from 'vue'
import {allMenuConfigs} from '@/config/menu'
import {electronService} from '@/services/electron'
import {flushContent} from '@/features/typewriter/content-plugin'
import {bindingFromEvent} from '@/features/shortcuts/keymap'
import {getActiveEditor} from './editor-context'
import {registerCommand,commands,commandState,bindingsFor,commandEnabled,setCommandContext,commandContext,executeCommand,openCommandPalette,closeCommandPalette} from './registry'

export function setupCommands({router,notes,typewriter}){
  const disposers=[],mac=window.electronAPI?.platform==='darwin'
  const add=command=>disposers.push(registerCommand(command))
  setCommandContext(()=>{
    const route=router.currentRoute.value,active=getActiveEditor()
    const editor=route.path.startsWith('/typewriter')?(active?.kind==='typewriter'?active:null):route.path.startsWith('/note')?(active?.kind==='note'?active:null):null
    const scope=route.path.startsWith('/typewriter')?(editor?'typewriter.note':'typewriter'):route.path.startsWith('/note')?'note':route.path.startsWith('/office')?'office':'all'
    return {route,scope,noteId:editor?.noteId?.()||route.params.id||notes.currentNoteId,editor}
  })
  add({id:'app.commands',titleKey:'workspace.commands.title',category:'navigation',defaultBindings:['Mod+Shift+P'],run:openCommandPalette})
  add({id:'app.settings',titleKey:'settings.title',category:'settings',defaultBindings:['Mod+,'],run:()=>router.push('/settings')})
  for(const item of allMenuConfigs)add({id:'navigate.'+item.key,titleKey:item.i18nKey,category:'navigation',keywords:[item.key],run:()=>router.push(item.path)})
  for(const section of ['shortcuts','plugins','plugin-market'])add({id:'settings.'+section,titleKey:'workspace.'+(section==='plugin-market'?'market':section)+'.title',category:'settings',run:()=>router.push('/settings/'+section)})
  add({id:'notes.new',titleKey:'workspace.commands.newNote',category:'notes',run:async()=>{const note=await notes.createNote(null);await router.push('/note/'+encodeURIComponent(note.id))}})
  const openOfficeResult=async result=>{if(result?.success&&result.viewId)await router.push('/office/'+result.viewId.replace('-','/'));else if(result?.error)throw new Error(result.error)}
  for(const type of ['docs','sheets','slides'])add({id:'office.new.'+type,titleKey:'workspace.office.new.'+type,category:'office',run:async()=>openOfficeResult(await electronService.request('office-new',{type}))})
  add({id:'office.open',titleKey:'workspace.office.open',category:'office',run:async()=>openOfficeResult(await electronService.request('office-open-dialog'))})
  const supported={save:['docs','sheets','slides'],'save-as':['docs','sheets','slides'],undo:['docs','sheets','slides'],redo:['docs','sheets','slides'],find:['docs'],print:['docs','sheets','slides'],'export-pdf':['sheets','slides'],'export-csv':['sheets'],'export-images':['slides']}
  for(const [id,types]of Object.entries(supported))add({id:'office.'+id,titleKey:'workspace.office.'+id,category:'office',contexts:['office'],enabled:ctx=>types.includes(ctx.route.params.editor)&&Boolean(ctx.route.params.instId),run:ctx=>electronService.executeOfficeCommand(`${ctx.route.params.editor}-${ctx.route.params.instId}`,id)})
  add({id:'notes.save',titleKey:'workspace.commands.save',category:'notes',contexts:['note','typewriter.note'],defaultBindings:['Mod+S'],run:async()=>{await flushContent();await notes.flushPendingSave()}})
  for(const mode of ['incoming','outgoing','unresolved'])add({id:'notes.links.'+mode,titleKey:'workspace.links.'+mode,category:'notes',contexts:['note','typewriter.note'],run:()=>window.dispatchEvent(new CustomEvent('friday:show-links',{detail:mode}))})
  for(const [id,key] of [['studio','Mod+Shift+,'],['print','Mod+Alt+P'],['archive','Mod+Shift+O'],['focus-mode','Mod+Shift+Enter'],['lighting','Mod+Shift+L'],['sound','Mod+Alt+M']])add({id:'typewriter.'+id,titleKey:'workspace.typewriter.'+id,category:'typewriter',contexts:['typewriter','typewriter.note'],defaultBindings:[key],run:()=>window.dispatchEvent(new CustomEvent('nocturne:command',{detail:id}))})
  add({id:'typewriter.terminal',titleKey:'typewriter.launchTerminal',category:'terminal',contexts:['typewriter','typewriter.note'],run:()=>window.dispatchEvent(new CustomEvent('friday:typewriter-action',{detail:'terminal'}))})
  const onKey=event=>{
    if(commandState.recording || event.defaultPrevented || event.isComposing)return
    if(commandState.open)return
    const binding=bindingFromEvent(event,{mac});if(!binding || !/(Mod|Ctrl|Meta|Alt)\+/.test(binding))return
    const command=[...commands.values()].find(command=>bindingsFor(command).includes(binding)&&commandEnabled(command))
    if(command){event.preventDefault();event.stopImmediatePropagation();void executeCommand(command.id)}
  }
  const sync=()=>{if(window.electronAPI)void electronService.request('workspace-keymap-sync',{commands:[...commands.values()].map(c=>({id:c.id,bindings:bindingsFor(c),contexts:c.contexts}))}).catch(()=>{})}
  const unwatch=watch(()=>[commands.size,JSON.stringify(commandState.bindings)],sync,{immediate:true})
  window.addEventListener('keydown',onKey,true)
  const onOpen=()=>void openCommandPalette(),onError=()=>{commandState.error='NOTE_SAVE_FAILED'}
  window.addEventListener('friday:open-commands',onOpen);window.addEventListener('friday:note-save-error',onError)
  const unlisten=electronService.listen('workspace-shortcut',({payload})=>{if(payload?.id)void executeCommand(payload.id)})
  if(window.electronAPI)void electronService.request('workspace-keymap-get').then(value=>{if(value?.bindings){commandState.bindings=value.bindings;localStorage.setItem('friday-keymap-v1',JSON.stringify(value.bindings))}}).catch(()=>{})
  return()=>{unwatch();window.removeEventListener('keydown',onKey,true);window.removeEventListener('friday:open-commands',onOpen);window.removeEventListener('friday:note-save-error',onError);unlisten?.();for(const dispose of disposers)dispose();void closeCommandPalette()}
}
