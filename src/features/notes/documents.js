import {electronService} from '@/services/electron'

// 两个编辑入口共享同一 noteId/revision 协议，正文冲突由主进程原子检查。
export const readNote=id=>electronService.request('get_note',{noteId:id})
export const saveNote=document=>electronService.request('update_note',document)
export const subscribeNotes=listener=>electronService.listen('note-changed',({payload})=>listener(payload))
