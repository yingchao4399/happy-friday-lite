exports.activate=async function(api){
  api.settings.register([{key:'goal',label:'写作目标 / Writing goal',type:'number',default:500}])
  api.commands.register({id:'word-count',name:'统计当前笔记 / Count current note',editor:true,run:async()=>{const config=await api.settings.load();const note=await api.notes.active();const words=note.text.trim().split(/\s+/).filter(Boolean).length;api.notice(`${words} words · ${note.text.length} characters · goal ${config.goal||500}`)}})
  api.commands.register({id:'insert-time',name:'插入时间戳 / Insert timestamp',editor:true,run:async()=>api.editor.replaceSelection(new Date().toISOString())})
  api.commands.register({id:'goal',name:'设置写作目标 / Set writing goal',run:()=>api.settings.show([{key:'goal',label:'写作目标 / Writing goal',type:'number',default:500}])})
  return ()=>{}
}
