import {createObsidian} from './obsidian-shim.js'
let compatibility=null
let manifest,plugin,context=null,operations=[],unload,settingsTab
const registered=new Map(),cleanup=[],call=(method,args={})=>window.pluginBridge.call(method,args)
const tr=(zh,en)=>navigator.language.toLowerCase().startsWith('zh')?zh:en
const root=()=>document.getElementById('plugin-content')
export function notice(text){const el=document.createElement('div');el.className='notice';el.textContent=String(text);document.getElementById('notices').append(el);setTimeout(()=>el.remove(),6000);void call('notice',{message:String(text)})}
function register(command){
  if(!command?.id||typeof command.id!=='string'||registered.has(command.id))throw new Error('PLUGIN_COMMAND_INVALID')
  registered.set(command.id,command);return ()=>registered.delete(command.id)
}
function settingForm(fields){
  root().replaceChildren();void call('settings.load').then(config=>{
    for(const field of fields){const label=document.createElement('label');label.className='setting-item';label.textContent=field.label;const input=document.createElement('input');input.type=field.type==='number'?'number':'text';input.value=config[field.key]??field.default??'';input.onchange=async()=>{config[field.key]=input.type==='number'?Number(input.value):input.value;await call('settings.save',{value:config})};label.append(input);root().append(label)}
  });void call('window.show')
}
function nativeApi(){return {
  commands:{register},notice,
  settings:{load:()=>call('settings.load'),save:value=>call('settings.save',{value}),show:settingForm,register:fields=>{settingsTab=()=>settingForm(fields)}},
  notes:{active:()=>call('notes.read',{id:context?.noteId}),list:()=>call('notes.list'),read:id=>call('notes.read',{id}),write:(id,text,revision)=>call('notes.write',{id,text,revision}),create:(title,text)=>call('notes.create',{title,text})},
  editor:{replaceSelection:text=>{if(!context?.noteId)throw new Error('EDITOR_REQUIRED');operations.push({type:'replaceSelection',text:String(text)})}},
  office:{list:()=>call('office.list'),selection:()=>call('office.selection'),save:viewId=>call('office.save',{viewId}),create:(type,name)=>call('office.create',{type,name})},
  agent:{registerTool:async definition=>{const {run,...metadata}=definition;if(typeof run!=='function')throw new Error('PLUGIN_TOOL_INVALID');registered.set('tool:'+definition.name,{id:'tool:'+definition.name,run:(_ctx,args)=>run(args)});await call('agent.register',{...metadata,callback:'tool:'+definition.name})}},
  register:fn=>cleanup.push(fn),registerInterval:id=>{cleanup.push(()=>clearInterval(id));return id},
  registerDomEvent:(el,event,fn)=>{el.addEventListener(event,fn);cleanup.push(()=>el.removeEventListener(event,fn))}
}}
function evaluateModule(files,name='main.js',cache={}){
  if(cache[name])return cache[name].exports
  if(!Object.hasOwn(files,name))throw new Error('PLUGIN_MODULE_MISSING: '+name)
  const module={exports:{}};cache[name]=module
  const require=id=>{if(compatibility&&id==='obsidian')return compatibility.exports;if(compatibility?.requireModules[id])return compatibility.requireModules[id];if(!id.startsWith('.'))throw new Error('PLUGIN_REQUIRE_UNSUPPORTED: '+id);const parts=name.split('/');parts.pop();for(const part of id.split('/')){if(part==='..'){if(!parts.length)throw new Error('PLUGIN_PATH_INVALID');parts.pop()}else if(part!=='.')parts.push(part)}let target=parts.join('/');if(!files[target])target+='.js';return target.endsWith('.json')?JSON.parse(files[target]):evaluateModule(files,target,cache)}
  new Function('module','exports','require',files[name]+'\n//# sourceURL=plugin-'+manifest.id+'/'+name)(module,module.exports,require)
  return module.exports
}
window.__fridayPluginBoot=async value=>{
  manifest=value.manifest
  document.title=manifest.name;document.getElementById('host-header').textContent=manifest.name
  if(value.files['styles.css']){const style=document.createElement('style');style.textContent=value.files['styles.css'];document.head.append(style)}
  if(manifest.format==='obsidian'){compatibility=createObsidian({call,register,notice,operations:()=>operations,setSettings:fn=>{settingsTab=fn}});await compatibility.initialize()}
  const exported=evaluateModule(value.files)
  if(compatibility){const Class=exported.default||exported;if(typeof Class!=='function')throw new Error('OBSIDIAN_PLUGIN_CLASS_MISSING');plugin=new Class(compatibility.app,manifest);await plugin.load();unload=async()=>{await plugin.unload();await compatibility.dispose()}}
  else{if(typeof exported.activate!=='function')throw new Error('PLUGIN_ACTIVATE_MISSING');unload=await exported.activate(nativeApi())}
  return {commands:[...registered.values()].filter(c=>!c.id?.startsWith('tool:')).map(({id,name,editor,hotkeys})=>({id,name,editor:Boolean(editor),hotkeys})),compatibility:manifest.id==='friday-writing-tools'?'verified':'partial'}
}
window.__fridayPluginExecute=async ({id,context:next,args})=>{
  context=next;operations=[];compatibility?.setContext(next)
  const command=registered.get(id);if(!command)throw new Error('PLUGIN_COMMAND_MISSING')
  if(command.editor&&!context?.noteId)throw new Error('EDITOR_REQUIRED')
  const result=await command.run(context,args)
  return {operations,result}
}
window.__fridayPluginSettings=async()=>{if(settingsTab)await settingsTab();else settingForm([]);return true}
window.__fridayPluginUnload=async()=>{if(typeof unload==='function')await unload();for(const dispose of cleanup.reverse())try{dispose()}catch{}registered.clear();root().replaceChildren();return true}

window.__fridayMarkdownOpen=async({noteId})=>{if(!compatibility)throw new Error('MARKDOWN_MODE_REQUIRES_OBSIDIAN');return compatibility.openMarkdown(noteId)}
window.pluginBridge.onContext(value=>{context=value;compatibility?.setContext(value)})
