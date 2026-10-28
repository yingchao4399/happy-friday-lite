import {load} from 'cheerio'
import TurndownService from 'turndown'
import {marked} from 'marked'
import crypto from 'node:crypto'
export function projectNote(note,previousNodes=[]){
  const $=load(note.content||'',null,false),protectedNodes=[]
  const visit=parent=>{for(const el of $(parent).children().toArray()){
    const attrs=Object.keys(el.attribs||{})
    if(['table','audio','video','iframe','object','img'].includes(el.name)||attrs.some(a=>a.startsWith('data-')||a==='style')){
      const html=$.html(el),previous=previousNodes.find(n=>n.html===html&&!protectedNodes.some(p=>p.token===n.token));const token=previous?.token||'FRIDAYPROTECTED'+crypto.randomUUID().replaceAll('-','')+'END';protectedNodes.push({token,html});$(el).replaceWith('<p>'+token+'</p>')
    }else visit(el)
  }}
  visit($.root())
  return {id:note.id,title:note.title,revision:note.revision||0,text:new TurndownService({headingStyle:'atx',codeBlockStyle:'fenced'}).turndown($.html()),protectedNodes}
}
export function restoreProjection(text,projection){
  if(typeof text!=='string'||text.length>8*1024*1024)throw new Error('NOTE_TEXT_INVALID')
  for(const item of projection.protectedNodes){if(text.split(item.token).length!==2)throw new Error('NOTE_PROTECTED_CONTENT_CHANGED')}
  let html=marked.parse(text)
  const $=load(html,null,false);$('script,iframe,object,embed,base,meta,link,style').remove();$('*').each((_i,el)=>{for(const [key,value]of Object.entries(el.attribs||{}))if(/^on/i.test(key)||(['href','src','xlink:href'].includes(key)&&/^\s*(?:javascript|vbscript):/i.test(value)))$(el).removeAttr(key)})
  html=$.html()
  for(const item of projection.protectedNodes){const block='<p>'+item.token+'</p>';if(!html.includes(block))throw new Error('NOTE_PROTECTED_CONTENT_CHANGED');html=html.replace(block,()=>item.html)}
  return {content:html,contentText:load(html,null,false).root().text()}
}
