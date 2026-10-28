// 跨 Vue/React/KeepAlive 编辑器交接定位请求，不依赖猜测挂载耗时的 setTimeout。
let pending=null
export function requestNoteLocation(link, surface='note') {
  pending={...link,surface}
  window.dispatchEvent(new CustomEvent('friday:note-locate',{detail:pending}))
}
export function consumeNoteLocation(noteId, surface='note') {
  if(pending?.noteId!==noteId || pending.surface!==surface)return null
  const link=pending;pending=null;return link
}
