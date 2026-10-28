import * as CMState from '@codemirror/state'
import * as CMView from '@codemirror/view'
import * as CMCommands from '@codemirror/commands'
import * as CMLanguage from '@codemirror/language'
import * as CMSearch from '@codemirror/search'
import * as CMAutocomplete from '@codemirror/autocomplete'
import {markdown} from '@codemirror/lang-markdown'

/** 有意保持受控的 Obsidian API 子集。未知 require/API 报错，不提供 Node 后门。 */
export function createObsidian(env){
  const {call,register,notice}=env,files=new Map(),reads=new Map(),extensions=[],tabs=[]
  let active=null,cm=null,cmRevision=0,cmFile=null,saveQueue=Promise.resolve(),saveTimer=null,opening=false
  const tr=(zh,en)=>navigator.language.startsWith('zh')?zh:en
  const unsupported=name=>{throw new Error('OBSIDIAN_API_UNSUPPORTED: '+name)}
  class Events{
    constructor(){this.events=new Map()}
    on(name,callback,ctx){const ref={name,callback,ctx,owner:this};const list=this.events.get(name)||[];list.push(ref);this.events.set(name,list);return ref}
    off(name,callback){this.events.set(name,(this.events.get(name)||[]).filter(ref=>ref.callback!==callback))}
    offref(ref){ref.owner.off(ref.name,ref.callback)}
    trigger(name,...args){for(const ref of this.events.get(name)||[])ref.callback.apply(ref.ctx,args)}
    tryTrigger(...args){this.trigger(...args)}
  }
  class Component{
    constructor(){this.disposers=[];this.children=[]}
    register(fn){this.disposers.push(fn);return fn}
    registerEvent(ref){this.register(()=>ref.owner.offref(ref));return ref}
    registerDomEvent(el,event,callback,options){el.addEventListener(event,callback,options);this.register(()=>el.removeEventListener(event,callback,options))}
    registerInterval(id){this.register(()=>clearInterval(id));return id}
    addChild(child){this.children.push(child);child.load?.();return child}
    removeChild(child){child.unload?.();this.children=this.children.filter(c=>c!==child)}
    async load(){await this.onload?.()}
    async unload(){await this.onunload?.();for(const child of this.children)await child.unload?.();for(const dispose of this.disposers.reverse())try{dispose()}catch{};this.disposers=[]}
  }
  class TAbstractFile{constructor(note){this.noteId=note.id;this.path='notes/'+note.id+'.md';this.name=note.title+'.md';this.parent=null;this.vault=vault}}
  class TFile extends TAbstractFile{constructor(note){super(note);this.basename=note.title;this.extension='md';this.stat={ctime:Date.parse(note.createdAt)||Date.now(),mtime:Date.parse(note.updatedAt)||Date.now(),size:0}}}
  class TFolder{constructor(path='notes'){this.path=path;this.name=path;this.children=[];this.parent=null}}
  function fileByPath(path){return [...files.values()].find(f=>f.path===path)||null}
  class Vault extends Events{
    getName(){return 'Happy Friday Notes'}
    getRoot(){const folder=new TFolder('');folder.children=[new TFolder()];folder.children[0].children=[...files.values()];return folder}
    getFiles(){return [...files.values()]}
    getMarkdownFiles(){return this.getFiles()}
    getAllLoadedFiles(){return [this.getRoot(),...this.getFiles()]}
    getAbstractFileByPath(path){return path==='notes'?this.getRoot().children[0]:fileByPath(path)}
    getFileByPath(path){return fileByPath(path)}
    async read(file){if(!files.has(file?.noteId))throw new Error('VAULT_FILE_MISSING');const value=await call('notes.read',{id:file.noteId});reads.set(file.noteId,value);return value.text}
    cachedRead(file){return this.read(file)}
    async modify(file,text){const before=reads.get(file?.noteId);if(!before)throw new Error('VAULT_READ_REQUIRED');const value=await call('notes.write',{id:file.noteId,text,revision:before.revision});reads.set(file.noteId,value);this.trigger('modify',file);metadata.trigger('changed',file);return value}
    async process(file,fn){const text=await this.read(file);await this.modify(file,fn(text))}
    async create(path,text){if(typeof path!=='string'||!path.endsWith('.md')||path.includes('..')||path.startsWith('/')||path.includes('\\'))throw new Error('VAULT_PATH_INVALID');if(fileByPath(path))throw new Error('VAULT_FILE_EXISTS');const value=await call('notes.create',{title:path.split('/').pop().slice(0,-3),text});const file=new TFile(value);files.set(value.id,file);this.trigger('create',file);return file}
    async rename(){unsupported('Vault.rename')}
    async delete(){unsupported('Vault.delete')}
    async trash(){unsupported('Vault.trash')}
    createFolder(){unsupported('Vault.createFolder')}
    getResourcePath(){unsupported('Vault.getResourcePath')}
  }
  const vault=new Vault()
  vault.adapter=new Proxy({exists:async path=>Boolean(fileByPath(path)),read:async path=>vault.read(fileByPath(path)),write:async(path,text)=>vault.modify(fileByPath(path),text),list:async()=>({files:vault.getFiles().map(f=>f.path),folders:['notes']})},{get:(target,key)=>key in target?target[key]:(..._args)=>unsupported('DataAdapter.'+String(key))})
  class MetadataCache extends Events{
    getFirstLinkpathDest(linkpath,sourcePath){const target=linkpath.split('#')[0].replace(/\.md$/,'');const direct=fileByPath(target+'.md')||fileByPath(target);if(direct)return direct;const candidates=[...files.values()].filter(f=>f.basename===target);return candidates.length===1?candidates[0]:null}
    getFileCache(file){const value=reads.get(file?.noteId);if(!value)return null;const headings=[],links=[];let code=false,offset=0;value.text.split('\n').forEach((line,n)=>{if(/^\s*```|^\s*~~~/.test(line))code=!code;if(!code){const heading=line.match(/^(#{1,6})\s+(.+)$/);if(heading)headings.push({heading:heading[2],level:heading[1].length,position:{start:{line:n,col:0,offset},end:{line:n,col:line.length,offset:offset+line.length}}});for(const m of line.matchAll(/\[\[([^\]]+)\]\]/g))links.push({link:m[1],original:m[0],position:{start:{line:n,col:m.index,offset:offset+m.index},end:{line:n,col:m.index+m[0].length,offset:offset+m.index+m[0].length}}})}offset+=line.length+1});return {headings,links}}
    getCache(path){return this.getFileCache(fileByPath(path))}
    fileToLinktext(file){return file.basename}
  }
  const metadata=new MetadataCache()
  const posToOffset=(text,pos)=>{const lines=text.split('\n');return lines.slice(0,Math.max(0,pos.line)).reduce((n,l)=>n+l.length+1,0)+Math.max(0,Math.min(pos.ch||0,lines[pos.line]?.length||0))}
  const offsetToPos=(text,offset)=>{const lines=text.slice(0,offset).split('\n');return {line:lines.length-1,ch:lines.at(-1).length}}
  class Editor{
    getValue(){return cm?cm.state.doc.toString():active?.text||''}
    getSelection(){return cm?cm.state.sliceDoc(cm.state.selection.main.from,cm.state.selection.main.to):this.getValue().slice(active?.selection?.from||0,active?.selection?.to||0)}
    getCursor(which='head'){const selection=cm?cm.state.selection.main:active?.selection||{from:0,to:0};return offsetToPos(this.getValue(),which==='from'||which==='anchor'?selection.from:selection.to)}
    listSelections(){return [{anchor:this.getCursor('from'),head:this.getCursor('to')}]}
    somethingSelected(){return this.getSelection().length>0}
    lineCount(){return this.getValue().split('\n').length}
    firstLine(){return 0}
    lastLine(){return this.lineCount()-1}
    getLine(line){return this.getValue().split('\n')[line]||''}
    getRange(from,to){return this.getValue().slice(posToOffset(this.getValue(),from),posToOffset(this.getValue(),to))}
    posToOffset(pos){return posToOffset(this.getValue(),pos)}
    offsetToPos(offset){return offsetToPos(this.getValue(),offset)}
    replaceSelection(text){
      if(cm){const s=cm.state.selection.main;cm.dispatch({changes:{from:s.from,to:s.to,insert:String(text)},selection:{anchor:s.from+String(text).length}});return}
      if(!active?.noteId)throw new Error('EDITOR_REQUIRED');env.operations().push({type:'replaceSelection',text:String(text)})
      const from=active.selection?.from||0,to=active.selection?.to||from;active={...active,text:this.getValue().slice(0,from)+text+this.getValue().slice(to),selection:{from:from+text.length,to:from+text.length}}
    }
    replaceRange(text,from,to=from){
      const a=this.posToOffset(from),b=this.posToOffset(to)
      if(cm){cm.dispatch({changes:{from:a,to:b,insert:String(text)}});return}
      if(a===(active?.selection?.from||0)&&b===(active?.selection?.to||0))return this.replaceSelection(text)
      unsupported('Editor.replaceRange outside current selection; open Markdown mode')
    }
    setValue(text){if(!cm)unsupported('Editor.setValue requires Markdown mode');cm.dispatch({changes:{from:0,to:cm.state.doc.length,insert:text}})}
    setSelection(anchor,head=anchor){if(!cm)unsupported('Editor.setSelection requires Markdown mode');cm.dispatch({selection:{anchor:this.posToOffset(anchor),head:this.posToOffset(head)}})}
    setCursor(pos){this.setSelection(pos)}
    focus(){cm?.focus()}
    refresh(){cm?.requestMeasure()}
    getDoc(){return this}
    undo(){if(cm)CMCommands.undo(cm);else unsupported('Editor.undo')}
    redo(){if(cm)CMCommands.redo(cm);else unsupported('Editor.redo')}
    transaction(tx){if(!cm)unsupported('Editor.transaction requires Markdown mode');cm.dispatch({changes:(tx.changes||[]).map(c=>({from:this.posToOffset(c.from),to:this.posToOffset(c.to||c.from),insert:c.text}))})}
  }
  class MarkdownView extends Component{constructor(){super();this.editor=new Editor();this.containerEl=document.getElementById('plugin-content')}
    get file(){return files.get(cmFile?.id||active?.noteId)||null}
    getMode(){return 'source'}
    getViewType(){return 'markdown'}
    getDisplayText(){return this.file?.basename||'Markdown'}
    async save(){if(cm)await saveMarkdown()}
  }
  const view=new MarkdownView()
  class WorkspaceLeaf{get view(){return view}async openFile(file){await openMarkdown(file.noteId)}getViewState(){return {type:'markdown',state:{file:view.file?.path}}}}
  class Workspace extends Events{
    getActiveViewOfType(Type){return active?.noteId||cm?view instanceof Type?view:null:null}
    getActiveFile(){return view.file}
    getLeaf(){return new WorkspaceLeaf()}
    getLeavesOfType(type){return type==='markdown'&&(active?.noteId||cm)?[this.getLeaf()]:[]}
    iterateAllLeaves(fn){for(const leaf of this.getLeavesOfType('markdown'))fn(leaf)}
    onLayoutReady(fn){queueMicrotask(fn)}
    async openLinkText(link,source){const file=metadata.getFirstLinkpathDest(link,source);if(!file)throw new Error('VAULT_LINK_UNRESOLVED');await openMarkdown(file.noteId)}
    get activeLeaf(){return active?.noteId||cm?this.getLeaf():null}
    get layoutReady(){return true}
    requestSaveLayout(){}
    registerView(){unsupported('Workspace.registerView')}
  }
  const workspace=new Workspace(),app={vault,metadataCache:metadata,workspace,lastEvent:null}
  class Notice{constructor(message,timeout=5000){this.message=String(message);notice(this.message)}setMessage(message){this.message=String(message);notice(this.message);return this}hide(){}}
  class Modal{
    constructor(app){this.app=app;this.containerEl=document.createElement('div');this.containerEl.className='modal-container';this.modalEl=this.containerEl.createDiv('modal');this.titleEl=this.modalEl.createEl('h2');const close=this.modalEl.createEl('button',{text:'×',cls:'modal-close-button'});close.onclick=()=>this.close();this.contentEl=this.modalEl.createDiv('modal-content');this.scope={register:()=>unsupported('Scope.register')};this.containerEl.addEventListener('click',event=>{if(event.target===this.containerEl)this.close()});this.escape=event=>{if(event.key==='Escape')this.close()}}
    open(){document.body.append(this.containerEl);document.addEventListener('keydown',this.escape);this.onOpen?.();void call('window.show');return this}
    close(){this.onClose?.();this.containerEl.remove();document.removeEventListener('keydown',this.escape);if(!cm)void call('window.hide')}
    setTitle(text){this.titleEl.setText(text);return this}
  }
  class PluginSettingTab{constructor(app,plugin){this.app=app;this.plugin=plugin;this.containerEl=document.getElementById('plugin-content')}display(){}hide(){this.containerEl.empty()}}
  class Control{constructor(input){this.inputEl=input;this.selectEl=input;this.buttonEl=input;this.sliderEl=input}setValue(value){if(this.inputEl.type==='checkbox')this.inputEl.checked=Boolean(value);else this.inputEl.value=value;return this}getValue(){return this.inputEl.type==='checkbox'?this.inputEl.checked:this.inputEl.value}setPlaceholder(value){this.inputEl.placeholder=value;return this}setDisabled(value){this.inputEl.disabled=value;return this}setButtonText(text){this.inputEl.setText(text);return this}setTooltip(text){this.inputEl.title=text;return this}setCta(){this.inputEl.classList.add('mod-cta');return this}setWarning(){return this}onChange(fn){this.inputEl.addEventListener(this.inputEl.tagName==='SELECT'||this.inputEl.type==='checkbox'?'change':'input',()=>fn(this.getValue()));return this}onClick(fn){this.inputEl.addEventListener('click',fn);return this}addOption(value,text){this.inputEl.add(new Option(text,value));return this}addOptions(options){Object.entries(options).forEach(([v,t])=>this.addOption(v,t));return this}setLimits(min,max,step){Object.assign(this.inputEl,{min,max,step});return this}setDynamicTooltip(){return this}}
  class Setting{
    constructor(container){this.settingEl=container.createDiv('setting-item');this.infoEl=this.settingEl.createDiv('setting-item-info');this.nameEl=this.infoEl.createDiv('setting-item-name');this.descEl=this.infoEl.createDiv('setting-item-description');this.controlEl=this.settingEl.createDiv('setting-item-control')}
    setName(text){this.nameEl.setText(text);return this}setDesc(text){this.descEl.setText(text);return this}setHeading(){this.settingEl.classList.add('setting-heading');return this}setDisabled(value){this.controlEl.querySelectorAll('input,button,select').forEach(el=>el.disabled=value);return this}
    addText(fn){fn(new Control(this.controlEl.createEl('input',{type:'text'})));return this}addTextArea(fn){fn(new Control(this.controlEl.createEl('textarea')));return this}addToggle(fn){fn(new Control(this.controlEl.createEl('input',{type:'checkbox'})));return this}addDropdown(fn){fn(new Control(this.controlEl.createEl('select')));return this}addButton(fn){fn(new Control(this.controlEl.createEl('button')));return this}addSlider(fn){fn(new Control(this.controlEl.createEl('input',{type:'range'})));return this}
  }
  class Plugin extends Component{
    constructor(app,manifest){super();this.app=app;this.manifest=manifest}
    loadData(){return call('settings.load')}
    saveData(value){return call('settings.save',{value})}
    addCommand(command){const dispose=register({id:command.id,name:command.name,editor:Boolean(command.editorCallback||command.editorCheckCallback),run:async context=>{
      setContext(context)
      if(command.checkCallback){if(!command.checkCallback(true))throw new Error('COMMAND_CONTEXT_UNAVAILABLE');await command.checkCallback(false)}
      else if(command.editorCheckCallback){if(!command.editorCheckCallback(true,view.editor,view))throw new Error('COMMAND_CONTEXT_UNAVAILABLE');await command.editorCheckCallback(false,view.editor,view)}
      else if(command.editorCallback)await command.editorCallback(view.editor,view)
      else await command.callback?.()
    }});this.register(dispose);return command}
    addSettingTab(tab){tabs.push(tab);env.setSettings(async()=>{if(cm){clearTimeout(saveTimer);await saveMarkdown();cm.destroy();cm=null}tab.display();void call('window.show')})}
    addRibbonIcon(icon,title,callback){let ribbon=document.querySelector('.plugin-ribbon');if(!ribbon)ribbon=document.body.createDiv('plugin-ribbon');const button=ribbon.createEl('button',{text:title,title});button.dataset.icon=icon;button.onclick=callback;this.register(()=>button.remove());return button}
    addStatusBarItem(){const el=document.body.createDiv('status-bar');this.register(()=>el.remove());return el}
    registerEditorExtension(extension){extensions.push(extension);this.register(()=>{const i=extensions.indexOf(extension);if(i>=0)extensions.splice(i,1)})}
    registerMarkdownPostProcessor(){unsupported('Plugin.registerMarkdownPostProcessor')}
    registerMarkdownCodeBlockProcessor(){unsupported('Plugin.registerMarkdownCodeBlockProcessor')}
    registerView(){unsupported('Plugin.registerView')}
    registerProtocolHandler(){unsupported('Plugin.registerProtocolHandler')}
  }
  function setContext(value){active=value;if(value?.noteId&&!files.has(value.noteId))files.set(value.noteId,new TFile({id:value.noteId,title:value.title||value.noteId}));workspace.trigger('active-leaf-change',workspace.activeLeaf);workspace.trigger('file-open',view.file)}
  async function initialize(){for(const note of await call('notes.list'))files.set(note.id,new TFile(note))}
  async function saveMarkdown(){
    if(!cm||!cmFile)return;const text=cm.state.doc.toString(),file=cmFile,id=file.id
    const task=saveQueue.catch(()=>{}).then(async()=>{if(text===file.saved)return;try{const result=await call('notes.write',{id,text,revision:cmRevision});cmRevision=result.revision;file.saved=text;reads.set(id,result);if(cm?.state.doc.toString()===text){await call('notes.draft.clear',{id});document.getElementById('markdown-save-status').textContent=tr('已保存','Saved')}else await call('notes.draft.save',{id,text:cm.state.doc.toString(),revision:cmRevision})}catch(error){document.getElementById('markdown-save-status').textContent=tr('保存冲突或保护内容被修改；输入仍在，请复制草稿后重新载入。','Save conflict or protected content changed; draft is retained. Copy it before reloading.');throw error}})
    saveQueue=task;return task
  }
  async function openMarkdown(noteId){
    if(opening)throw new Error('EDITOR_BUSY');opening=true;clearTimeout(saveTimer)
    try{
      if(cm){await saveMarkdown();cm.destroy();cm=null}
      const note=await call('notes.read',{id:noteId});const draft=await call('notes.draft.read',{id:noteId});cmRevision=draft?.revision??note.revision;cmFile={id:noteId,saved:note.text};reads.set(noteId,note);setContext({noteId,text:note.text,selection:{from:0,to:0}})
      const root=document.getElementById('plugin-content');root.empty();const bar=root.createDiv();bar.createEl('strong',{text:note.title});const save=bar.createEl('button',{text:tr('保存','Save')});bar.createEl('span',{attr:{id:'markdown-save-status'},text:tr('已保存','Saved')});save.onclick=()=>void saveMarkdown().catch(error=>notice(error.message))
      cm=new CMView.EditorView({parent:root,state:CMState.EditorState.create({doc:draft?.text??note.text,extensions:[CMCommands.history(),CMView.keymap.of([...CMCommands.defaultKeymap,...CMCommands.historyKeymap]),markdown(),CMView.lineNumbers(),CMView.EditorView.lineWrapping,CMView.EditorView.updateListener.of(update=>{if(update.docChanged){void call('notes.draft.save',{id:cmFile.id,text:update.state.doc.toString(),revision:cmRevision}).catch(error=>notice(error.message));document.getElementById('markdown-save-status').textContent=tr('未保存','Unsaved');clearTimeout(saveTimer);saveTimer=setTimeout(()=>void saveMarkdown().catch(()=>{}),600)}}),extensions]})})
      window.__fridayCM=cm;await call('window.show');cm.focus();return true
    }finally{opening=false}
  }
  const normalizePath=value=>String(value).replace(/\\/g,'/').replace(/\/{2,}/g,'/').replace(/^\.\//,'').replace(/\/$/,'')
  const requireModules={'@codemirror/state':CMState,'@codemirror/view':CMView,'@codemirror/commands':CMCommands,'@codemirror/language':CMLanguage,'@codemirror/search':CMSearch,'@codemirror/autocomplete':CMAutocomplete}
  const exports={Plugin,Component,Events,Modal,Notice,PluginSettingTab,Setting,Editor,MarkdownView,TAbstractFile,TFile,TFolder,Vault,Workspace,WorkspaceLeaf,MetadataCache,App:class{},Platform:{isDesktop:true,isMobile:false,isWin:navigator.platform.startsWith('Win'),isMacOS:navigator.platform.startsWith('Mac')},normalizePath,requestUrl:()=>unsupported('requestUrl'),request:()=>unsupported('request'),setIcon:(el,icon)=>{el.dataset.icon=icon},addIcon:()=>{},getIcon:()=>null,debounce:(fn,ms=0)=>{let timer;const f=(...args)=>{clearTimeout(timer);timer=setTimeout(()=>fn(...args),ms)};f.cancel=()=>clearTimeout(timer);return f},parseLinktext:link=>{const [path,subpath]=link.split('#');return {path,subpath:subpath?'#'+subpath:''}},sanitizeHTMLToDom:html=>{const template=document.createElement('template');template.innerHTML=html;template.content.querySelectorAll('script,iframe,object,style').forEach(e=>e.remove());template.content.querySelectorAll('*').forEach(e=>{for(const a of [...e.attributes])if(/^on/i.test(a.name)||/^(javascript|vbscript):/i.test(a.value))e.removeAttribute(a.name)});return template.content}}
  // 兼容官方 1.0.0 原包的 ES5 _super.apply，以及现代 class extends。
  for(const key of ['Plugin','Component','Events','Modal','Notice','PluginSettingTab','Setting','Editor','MarkdownView','TAbstractFile','TFile','TFolder','Vault','Workspace','WorkspaceLeaf','MetadataCache']){const Base=exports[key];function Callable(...args){return Reflect.construct(Base,args,new.target||this?.constructor||Base)}Callable.prototype=Base.prototype;Object.setPrototypeOf(Callable,Base);exports[key]=Callable}
  installDomHelpers()
  window.activeDocument=document;window.activeWindow=window
  const guardedExports=new Proxy(exports,{get:(target,key)=>{if(key==='__esModule')return false;if(typeof key==='symbol'||key in target)return target[key];return unsupported('obsidian.'+key)}})
  return {app,exports:guardedExports,requireModules,initialize,setContext,openMarkdown,saveMarkdown,hasEditor:()=>Boolean(cm),dispose:async()=>{clearTimeout(saveTimer);if(cm){await saveMarkdown();cm.destroy();cm=null}for(const tab of tabs)tab.hide?.()},context:()=>active}
}
function installDomHelpers(){
  const methods={
    setText(text){this.textContent=text;return this},empty(){this.replaceChildren();return this},addClass(...names){this.classList.add(...names.flat());return this},removeClass(...names){this.classList.remove(...names.flat());return this},toggleClass(name,value){this.classList.toggle(name,value);return this},hasClass(name){return this.classList.contains(name)},setAttr(name,value){this.setAttribute(name,value);return this},setAttrs(attrs){Object.entries(attrs).forEach(([k,v])=>this.setAttribute(k,v));return this},getAttr(name){return this.getAttribute(name)},show(){this.hidden=false;this.style.display='';return this},hide(){this.hidden=true;return this},createEl(tag,options={},callback){if(typeof options==='string')options={cls:options};const el=document.createElement(tag);if(options.cls)el.className=Array.isArray(options.cls)?options.cls.join(' '):options.cls;if(options.text!==undefined)el.textContent=options.text;for(const key of ['type','title','value','href'])if(options[key]!==undefined)el[key]=options[key];for(const [key,value]of Object.entries(options.attr||{}))el.setAttribute(key,value);if(options.prepend)this.prepend(el);else this.append(el);callback?.(el);return el},createDiv(options,callback){return this.createEl('div',options,callback)},createSpan(options,callback){return this.createEl('span',options,callback)},find(selector){return this.querySelector(selector)},findAll(selector){return [...this.querySelectorAll(selector)]}
  }
  for(const [name,fn]of Object.entries(methods))if(!HTMLElement.prototype[name])Object.defineProperty(HTMLElement.prototype,name,{value:fn,configurable:true})
  window.createEl=(tag,options,callback)=>document.createElement('div').createEl(tag,options,callback);window.createDiv=(options,callback)=>window.createEl('div',options,callback);window.createSpan=(options,callback)=>window.createEl('span',options,callback)
}
