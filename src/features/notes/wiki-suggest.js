import {electronService} from '@/services/electron'

export function createWikiPopup() {
  let notes=[], menu=null, index=0, choices=[], accept=null
  void electronService.request('get_notes').then(value=>{notes=value || []}).catch(()=>{})
  const close=()=>{menu?.remove();menu=null;choices=[]}
  const choose=()=>{const note=choices[index];if(note&&accept)accept(note);close()}
  const keys=event=>{
    if(!menu || event.isComposing)return false
    if(event.key==='Escape'){event.preventDefault();event.stopPropagation();close();return true}
    if(['ArrowDown','ArrowUp'].includes(event.key)){
      event.preventDefault();event.stopPropagation();index=(index+(event.key==='ArrowDown'?1:-1)+choices.length)%choices.length
      ;[...menu.children].forEach((el,i)=>el.classList.toggle('selected',i===index));return true
    }
    if(['Enter','Tab'].includes(event.key)){event.preventDefault();event.stopPropagation();choose();return true}
    return false
  }
  const update=(query,rect,callback)=>{
    const next=notes.filter(n=>String(n.title).toLocaleLowerCase().includes(query.toLocaleLowerCase())).slice(0,8)
    close();if(!next.length)return
    choices=next;accept=callback;index=0;menu=document.createElement('div');menu.className='friday-wiki-suggest';menu.setAttribute('role','listbox')
    Object.assign(menu.style,{position:'fixed',left:Math.min(rect.left,window.innerWidth-300)+'px',top:Math.min(rect.bottom+5,window.innerHeight-280)+'px',zIndex:12000})
    next.forEach((note,i)=>{const button=document.createElement('button');button.type='button';button.textContent=note.title;button.classList.toggle('selected',i===0);button.onmousedown=e=>{e.preventDefault();index=i;choose()};menu.appendChild(button)})
    document.body.appendChild(menu)
  }
  return {update,keys,close,destroy:close}
}
