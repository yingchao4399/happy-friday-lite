import {reactive,shallowReactive} from 'vue'
import {pinyin} from 'pinyin-pro'
import {i18n} from '@/i18n'
import {electronService} from '@/services/electron'
import {normalizeBinding,scopesOverlap,isReservedBinding} from '../shortcuts/keymap'

const read=(key,fallback)=>{try{return JSON.parse(localStorage.getItem(key))??fallback}catch{return fallback}}
export const commands=shallowReactive(new Map())
export const commandState=reactive({open:false,query:'',category:'all',error:'',running:'',recent:read('friday-command-recents',[]),bindings:read('friday-keymap-v1',{}),recording:false})
const searchCache=new Map()
let context=()=>({scope:'all'}),focus=null,selection=null
export function setCommandContext(get){context=get}
export function commandContext(){return context()}
export function commandTitle(command){return command.titleKey?String(i18n.global.t(command.titleKey)):command.title}
export function bindingsFor(command){return (commandState.bindings[command.id]??command.defaultBindings??[]).filter(key=>!isReservedBinding(key,command.contexts))}
export function registerCommand(command){
  if(!command?.id||commands.has(command.id))throw new Error('COMMAND_DUPLICATE: '+command?.id)
  commands.set(command.id,{source:'builtin',contexts:['all'],...command})
  return()=>commands.delete(command.id)
}
export function commandEnabled(command,ctx=context()){
  return (command.contexts.includes('all')||command.contexts.includes(ctx.scope)) && (!command.enabled || command.enabled(ctx))
}
export async function executeCommand(id){
  const command=commands.get(id),ctx=context()
  if(!command||!commandEnabled(command,ctx)||commandState.running)return
  commandState.running=id;commandState.error=''
  try{
    await command.run(ctx)
    commandState.recent=[id,...commandState.recent.filter(value=>value!==id)].slice(0,30)
    localStorage.setItem('friday-command-recents',JSON.stringify(commandState.recent))
  }catch(error){commandState.error=String(i18n.global.t('workspace.failed'));console.error('命令执行失败:',id,error?.message)}
  finally{commandState.running=''}
}
export async function openCommandPalette(){
  if(commandState.open)return
  focus=document.activeElement;selection=focus instanceof HTMLTextAreaElement||focus instanceof HTMLInputElement?[focus.selectionStart,focus.selectionEnd]:null
  commandState.query='';commandState.category='all';commandState.error=''
  if(window.electronAPI)await electronService.request('workspace-overlay',{open:true})
  commandState.open=true;window.dispatchEvent(new Event('friday:overlay-open'))
}
export async function closeCommandPalette(){
  if(!commandState.open)return
  commandState.open=false
  if(window.electronAPI)await electronService.request('workspace-overlay',{open:false})
  if(focus?.isConnected){focus.focus();if(selection)focus.setSelectionRange(...selection)}
  window.dispatchEvent(new Event('friday:overlay-close'))
}
export function searchCommands(query,category='all'){
  const needle=query.trim().toLocaleLowerCase()
  return [...commands.values()].filter(c=>category==='all'||c.category===category).map(command=>{
    const title=commandTitle(command),labels=['zh-CN','en-US'].map(locale=>command.titleKey?.split('.').reduce((value,key)=>value?.[key],i18n.global.getLocaleMessage(locale))).filter(value=>typeof value==='string')
    const words=[title,...labels,command.id,...command.keywords||[]].join(' ').toLocaleLowerCase(),cacheKey=[title,...labels].join('|')
    if(!searchCache.has(cacheKey))searchCache.set(cacheKey,[pinyin(cacheKey,{toneType:'none',type:'array'}).join('').toLocaleLowerCase(),pinyin(cacheKey,{pattern:'first',toneType:'none',type:'array'}).join('').toLocaleLowerCase()])
    const [roman,initials]=searchCache.get(cacheKey)
    let score=needle?words.startsWith(needle)?100:words.includes(needle)?80:roman.includes(needle)||initials.includes(needle)?60:0:30-commandState.recent.indexOf(command.id)
    if(!needle&&!commandState.recent.includes(command.id))score=0
    if(needle&&!score){let i=0;for(const char of words)if(char===needle[i])i++;if(i===needle.length)score=10}
    return {command,title,score,enabled:commandEnabled(command)}
  }).filter(row=>!needle||row.score>0).sort((a,b)=>Number(b.enabled)-Number(a.enabled)||b.score-a.score||a.title.localeCompare(b.title)).slice(0,100)
}
export function bindingConflicts(id,bindings){
  const command=commands.get(id)
  return [...commands.values()].filter(other=>other.id!==id&&scopesOverlap(command?.contexts,other.contexts)&&bindingsFor(other).some(key=>bindings.includes(key)))
}
export async function saveBindings(next){
  const clean={}
  for(const [id,values] of Object.entries(next)){
    if(!Array.isArray(values)||values.length>3||values.some(value=>!normalizeBinding(value)))throw new Error('KEYMAP_INVALID')
    if(values.some(value=>isReservedBinding(value,commands.get(id)?.contexts)))throw new Error('KEYMAP_RESERVED')
    clean[id]=values.map(normalizeBinding)
  }
  if(window.electronAPI)await electronService.request('workspace-keymap-save',{bindings:clean})
  commandState.bindings=clean;localStorage.setItem('friday-keymap-v1',JSON.stringify(clean))
}
