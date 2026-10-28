import {Extension} from '@tiptap/core'
import {Plugin} from '@tiptap/pm/state'
import {Decoration, DecorationSet} from '@tiptap/pm/view'
import {createWikiPopup} from './wiki-suggest'

export const WikiSuggestions=Extension.create({
  name:'fridayWikiSuggestions',
  addProseMirrorPlugins(){
    let popup
    const refresh=view=>{
      const {$from,empty}=view.state.selection
      if(!empty || !view.hasFocus()){popup.close();return}
      const before=$from.parent.textBetween(0,$from.parentOffset,'\n')
      const match=/\[\[([^\]\n]{0,80})$/.exec(before)
      if(!match){popup.close();return}
      const start=$from.pos-match[0].length, end=$from.pos
      popup.update(match[1],view.coordsAtPos(end),note=>{
        const mark=view.state.schema.marks.link?.create({href:'friday://notes/'+encodeURIComponent(note.id)})
        const node=view.state.schema.text(note.title,mark?[mark]:[])
        view.dispatch(view.state.tr.replaceWith(start,end,node));view.focus()
      })
    }
    return [new Plugin({props:{
      handleKeyDown:(_view,event)=>popup?.keys(event)||false,
      decorations(state){
        const decorations=[]
        state.doc.descendants((node,pos,parent)=>{
          if(!node.isText || parent?.type.name==='codeBlock' || node.marks.some(mark=>['code','link'].includes(mark.type.name)))return
          for(const match of node.text.matchAll(/\[\[([^\]\n]+)\]\]/g))decorations.push(Decoration.inline(pos+match.index,pos+match.index+match[0].length,{class:'text-link friday-wiki-link','data-note-link':match[1],role:'link',tabindex:'0'}))
        })
        return DecorationSet.create(state.doc,decorations)
      }
    },view(view){
      popup=createWikiPopup()
      return {update:()=>refresh(view),destroy:()=>popup.destroy()}
    }})]
  }
})
