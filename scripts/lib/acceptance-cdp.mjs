// 验收专用 CDP 接线；所有点击均经 Chromium 输入事件派发。
export const pause = ms => new Promise(resolve => setTimeout(resolve, ms))
export async function connectPage(page) {
  const socket = new WebSocket(page.webSocketDebuggerUrl), pending = new Map()
  let sequence = 0
  await new Promise((resolve,reject) => {socket.onopen=resolve;socket.onerror=reject})
  socket.onmessage = event => {
    const message=JSON.parse(event.data),task=pending.get(message.id)
    if(!task)return
    pending.delete(message.id);clearTimeout(task.timeout)
    message.error?task.reject(Error(message.error.message)):task.resolve(message.result)
  }
  const rpc = (method,params={}) => new Promise((resolve,reject)=>{
    const id=++sequence,timeout=setTimeout(()=>{pending.delete(id);reject(Error(method+'超时'))},60000)
    pending.set(id,{resolve,reject,timeout});socket.send(JSON.stringify({id,method,params}))
  })
  const evaluate = async expression => {
    const result=await rpc('Runtime.evaluate',{expression,awaitPromise:true,returnByValue:true,userGesture:true})
    if(result.exceptionDetails)throw Error(result.exceptionDetails.exception?.description||result.exceptionDetails.text)
    return result.result?.value
  }
  const until = async (expression,timeout=45000) => {
    for(const end=Date.now()+timeout;Date.now()<end;){const value=await evaluate(expression);if(value)return value;await pause(50)}
    throw Error('验收超时: '+expression)
  }
  const click = async selector => {
    const point=await evaluate(`(()=>{const el=document.querySelector(${JSON.stringify(selector)});el?.scrollIntoView({block:'nearest'});const r=el?.getBoundingClientRect();return r&&{x:r.x+r.width/2,y:r.y+r.height/2}})()`)
    if(!point)throw Error('元素不存在: '+selector)
    await rpc('Input.dispatchMouseEvent',{type:'mousePressed',button:'left',clickCount:1,...point})
    await rpc('Input.dispatchMouseEvent',{type:'mouseReleased',button:'left',clickCount:1,...point})
  }
  const key = async (key,code,virtualKey,modifiers=0) => {
    for(const type of ['keyDown','keyUp'])await rpc('Input.dispatchKeyEvent',{type,key,code,windowsVirtualKeyCode:virtualKey,modifiers})
  }
  return {socket,rpc,evaluate,until,click,key,close:()=>socket.close()}
}
export async function waitPage(port,predicate,timeout=90000){
  for(const end=Date.now()+timeout;Date.now()<end;){
    try{const pages=await(await fetch(`http://127.0.0.1:${port}/json/list`)).json(),page=pages.find(predicate);if(page)return page}catch{}
    await pause(100)
  }
  throw Error('验收 renderer 未出现')
}
