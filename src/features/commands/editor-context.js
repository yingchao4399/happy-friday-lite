let active=null
export function activateEditor(editor){active=editor;return()=>{if(active===editor)active=null}}
export function getActiveEditor(){return active}
