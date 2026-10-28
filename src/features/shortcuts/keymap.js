export function normalizeBinding(value){
  if(typeof value!=='string')return ''
  const parts=value.split('+').map(s=>s.trim()).filter(Boolean),key=parts.pop()
  if(!key)return ''
  const mods=['Mod','Ctrl','Meta','Alt','Shift'].filter(mod=>parts.some(p=>p.toLowerCase()===mod.toLowerCase()))
  if(parts.length!==mods.length || !/^(?:[a-z0-9,./;\[\]`=-]|F(?:[1-9]|1[0-9]|2[0-4])|Tab|Enter|Escape|Arrow(?:Up|Down|Left|Right)|Space)$/i.test(key))return ''
  return [...mods,key.length===1?key.toUpperCase():key].join('+')
}
export function bindingFromEvent(event,{mac=false}={}){
  if(event.isComposing || event.key==='Dead' || event.getModifierState?.('AltGraph') || ['Control','Shift','Alt','Meta'].includes(event.key))return ''
  const parts=[]
  if(mac?event.metaKey:event.ctrlKey)parts.push('Mod')
  if(mac?event.ctrlKey:event.metaKey)parts.push(mac?'Ctrl':'Meta')
  if(event.altKey)parts.push('Alt')
  if(event.shiftKey)parts.push('Shift')
  const punctuation={Comma:',',Period:'.',Slash:'/',Semicolon:';',BracketLeft:'[',BracketRight:']',Backquote:'`',Equal:'=',Minus:'-'}
  const key=event.key===' '?'Space':punctuation[event.code] || event.key
  return normalizeBinding([...parts,key].join('+'))
}
export function scopesOverlap(a=['all'],b=['all']){return a.includes('all')||b.includes('all')||a.some(scope=>b.includes(scope))}
export function isReservedBinding(binding,contexts=['all']){
  const key=normalizeBinding(binding).replace(/^(Ctrl|Meta)\+/,'Mod+')
  if((contexts.includes('all')||contexts.includes('office'))&&key==='Mod+P')return true
  return (contexts.includes('all')||contexts.includes('typewriter'))&&/^Mod\+[ACDHKLQRSUVWXZ]$/.test(key)
}
