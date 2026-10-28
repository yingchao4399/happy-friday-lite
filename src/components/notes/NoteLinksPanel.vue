<template>
  <aside class="note-links-panel" :aria-label="t('workspace.links.title')">
    <header><strong>{{ t('workspace.links.title') }}</strong><button type="button" @click="$emit('close')" :aria-label="t('workspace.close')">×</button></header>
    <nav><button v-for="kind in kinds" :key="kind" type="button" :class="{active:mode===kind}" @click="mode=kind">{{ t('workspace.links.'+kind) }} ({{ data[kind].length }})</button></nav>
    <details class="links-help" open><summary>{{ t('workspace.links.help') }}</summary><p>{{ t('workspace.links.guide') }}</p><p>{{ t('workspace.links.typingHint') }}</p><p>{{ t('workspace.links.anchorHint') }}</p></details>
    <p v-if="error" role="alert">{{ error }}</p>
    <p v-if="!data[mode].length" class="empty">{{ t('workspace.links.empty') }}</p>
    <article v-for="link in data[mode]" :key="link.id">
      <button type="button" :disabled="mode==='unresolved'" @click="open(link)"><strong>{{ link.title || link.rawTarget }}</strong><small v-if="link.heading">#{{ link.heading }}</small><span>{{ link.snippet }}</span></button>
      <button v-if="mode==='unresolved'" type="button" @click="create(link)">{{ t('workspace.links.create') }}</button>
    </article>
    <button v-if="hasMore" type="button" @click="load(true)">{{ t('workspace.plugins.more') }}</button>
  </aside>
</template>
<script setup>
import {ref,watch,onMounted,onUnmounted} from 'vue'
import {useI18n} from 'vue-i18n'
import {electronService} from '@/services/electron'
const props=defineProps({noteId:String,initialMode:{type:String,default:'outgoing'}})
const emit=defineEmits(['open','close'])
const {t}=useI18n()
const kinds=['outgoing','incoming','unresolved','related']
const mode=ref(props.initialMode),data=ref(Object.fromEntries(kinds.map(k=>[k,[]]))),error=ref(''),hasMore=ref(false)
watch(()=>props.initialMode,value=>{if(['outgoing','incoming','unresolved'].includes(value))mode.value=value})
let unlisten, generation=0,offset=0
async function load(more=false){if(more!==true)offset=0;const seq=++generation;try{const value=await electronService.request('note-links-index',{noteId:props.noteId,offset,limit:100});if(seq===generation){for(const kind of kinds)data.value[kind]=offset?[...data.value[kind],...(value[kind]||[])]:value[kind]||[];hasMore.value=Object.values(value.hasMore||{}).some(Boolean);offset+=100;error.value=''}}catch{if(seq===generation)error.value=t('workspace.failed')}}
function open(link){if(mode.value==='unresolved')return;emit('open',{noteId:mode.value==='incoming'?link.sourceNoteId:link.targetNoteId,heading:mode.value==='incoming'?'':link.heading,snippet:mode.value==='incoming'?link.snippet:''})}
async function create(link){try{const note=await electronService.request('create_note',{title:link.rawTarget});await load();emit('open',{noteId:note.id})}catch{error.value=t('workspace.failed')}}
watch(()=>props.noteId,load,{immediate:true})
onMounted(()=>{unlisten=electronService.listen('note-changed',load)})
onUnmounted(()=>{generation++;unlisten?.()})
</script>
<style scoped>
.links-help{margin:12px 0;padding:10px;border-radius:8px;background:var(--bg-secondary);font-size:12px;line-height:1.6}.links-help summary{cursor:pointer;font-weight:500}.links-help p{margin-top:8px;color:var(--text-secondary)}
.note-links-panel{flex:0 0 280px;width:280px;max-width:40vw;border-left:1px solid var(--border-color,#ddd);background:var(--bg-primary,#fff);color:var(--text-primary,#222);overflow:auto;padding:14px;box-sizing:border-box;font-size:13px}.note-links-panel header{display:flex;justify-content:space-between;align-items:center;margin-bottom:12px}.note-links-panel button{font:inherit;color:inherit;cursor:pointer;background:transparent;border:0;text-align:left}.note-links-panel nav{display:flex;flex-wrap:wrap;gap:5px}.note-links-panel nav button{padding:5px;border-radius:5px}.note-links-panel nav .active{background:var(--bg-hover,#eef2f7);font-weight:600}.note-links-panel article{border-bottom:1px solid var(--border-color,#ddd);padding:12px 0}.note-links-panel article button{display:block;width:100%}.note-links-panel article span{display:block;white-space:pre-wrap;margin-top:5px;opacity:.7;overflow-wrap:anywhere}.note-links-panel small{margin-left:5px}.empty{opacity:.6;padding:12px 0}
</style>
