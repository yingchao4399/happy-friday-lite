const fail = code => Object.assign(new Error(code), { code })

// 队列仅保存条目 ID；发送失败、删除、过期和源文件丢失都不推进位置。
export function createClipboardSequence({ getItem, paste, changed=()=>{} }) {
  let ids=[], position=0,paused=false,busy=false,error=null,generation=0
  const state=()=>({ids:[...ids],position,total:ids.length,remaining:Math.max(0,ids.length-position),active:position<ids.length,paused,busy,error})
  const notify=()=>changed(state())
  const check=id=>{
    const item=getItem(id)
    if(!item||item.deletedAt||(item.expiresAt&&Date.parse(item.expiresAt)<=Date.now()))throw fail('CLIPBOARD_QUEUE_STALE')
    if(item.sensitivity==='secret')throw fail('CLIPBOARD_QUEUE_SENSITIVE')
    return item
  }
  return {
    state,
    start(values) {
      if(busy)throw fail('CLIPBOARD_QUEUE_BUSY')
      if(!Array.isArray(values)||!values.length||values.length>200||values.some(id=>typeof id!=='string'))throw fail('CLIPBOARD_QUEUE_INVALID')
      const next=[...new Set(values)];next.forEach(check)
      generation++;ids=next;position=0;paused=false;error=null;notify();return state()
    },
    async next(target) {
      if(busy)throw fail('CLIPBOARD_QUEUE_BUSY')
      if(paused)throw fail('CLIPBOARD_QUEUE_PAUSED')
      if(position>=ids.length)throw fail('CLIPBOARD_QUEUE_EMPTY')
      const token=generation,id=ids[position]
      busy=true;error=null;notify()
      try {
        check(id)
        const result=await paste(id,target,()=>token!==generation||paused)
        if(token===generation){position++;error=null}
        return result
      }catch(e){if(token===generation)error=e.code||'CLIPBOARD_PASTE_FAILED';throw e}
      finally {busy=false;notify()}
    },
    pause(value) { if(typeof value!=='boolean')throw fail('CLIPBOARD_QUEUE_INVALID');paused=value;notify();return state() },
    skip() {if(busy)throw fail('CLIPBOARD_QUEUE_BUSY');if(position<ids.length)position++;error=null;notify();return state()},
    cancel() {generation++;ids=[];position=0;paused=false;error=null;notify();return state()}
  }
}
