<template>
  <section class="workspace-settings"><router-link to="/settings">← {{ t('settings.title') }}</router-link><h1>{{ t('workspace.shortcuts.title') }}</h1>
    <div class="workspace-actions"><input v-model="query" :placeholder="t('workspace.commands.search')" /><button @click="exportKeys">{{ t('workspace.shortcuts.export') }}</button><button @click="file?.click()">{{ t('workspace.shortcuts.import') }}</button><input ref="file" hidden type="file" accept="application/json" @change="importKeys" /><button @click="resetAll">{{ t('workspace.shortcuts.reset') }}</button></div>
    <p>{{ t('workspace.shortcuts.hint') }} <button @click="systemKeys=true">{{ t('workspace.shortcuts.system') }}</button></p><p>{{ t('workspace.shortcuts.migrated') }}</p><p v-if="notice" role="status">{{ notice }}</p>
    <article v-for="command in filtered" :key="command.id" class="shortcut-row"><div><strong>{{ commandTitle(command) }}</strong><small>{{ t('workspace.categories.'+command.category) }} · {{ command.source }} · {{ command.contexts.join(', ') }}</small></div><kbd v-for="key in bindingsFor(command)" :key="key">{{ key.replaceAll('Mod',mac?'⌘':'Ctrl') }}</kbd><button @click="start(command)">{{ recording===command.id?t('workspace.shortcuts.recording'):t('workspace.shortcuts.change') }}</button><button @click="set(command,[])">{{ t('workspace.shortcuts.clear') }}</button><button @click="reset(command)">{{ t('workspace.shortcuts.default') }}</button></article>
    <div v-if="recording" class="shortcut-recorder" role="dialog" aria-modal="true"><strong>{{ t('workspace.shortcuts.recording') }}</strong><p>{{ draft || '…' }}</p><p v-if="conflicts.length">{{ t('workspace.shortcuts.conflict') }}: {{ conflicts.map(commandTitle).join('、') }}</p><button :disabled="!draft" @click="apply(false)">{{ t('workspace.shortcuts.assign') }}</button><button v-if="conflicts.length" @click="apply(true)">{{ t('workspace.shortcuts.replace') }}</button><button @click="cancel">{{ t('workspace.close') }}</button></div>
  <ClipboardSettings :visible="systemKeys" @close="systemKeys=false" /></section>
</template>
<script setup>
import {ref,computed,onMounted,onBeforeUnmount,onDeactivated} from 'vue'
import {useI18n} from 'vue-i18n'
import {commands,commandState,commandTitle,bindingsFor,bindingConflicts,saveBindings} from '@/features/commands/registry'
import {bindingFromEvent} from '@/features/shortcuts/keymap'
import ClipboardSettings from '@/views/clipboard/ClipboardSettings.vue'
const systemKeys=ref(false)
const {t}=useI18n(),query=ref(''),notice=ref(''),file=ref(),recording=ref(''),draft=ref(''),mac=window.electronAPI?.platform==='darwin'
const filtered=computed(()=>[...commands.values()].filter(c=>(commandTitle(c)+' '+c.id+' '+c.source).toLocaleLowerCase().includes(query.value.toLocaleLowerCase())))
const conflicts=computed(()=>recording.value&&draft.value?bindingConflicts(recording.value,[draft.value]):[])
function start(command){recording.value=command.id;draft.value='';commandState.recording=true}
function cancel(){recording.value='';commandState.recording=false}
function capture(event){if(!recording.value)return;event.preventDefault();event.stopImmediatePropagation();if(event.key==='Escape'){cancel();return}const key=bindingFromEvent(event,{mac});if(key&&/(Mod|Ctrl|Meta|Alt)\+/.test(key))draft.value=key}
async function set(command,keys){try{await saveBindings({...commandState.bindings,[command.id]:keys});notice.value=t('workspace.shortcuts.saved')}catch(error){notice.value=t(error.message==='KEYMAP_RESERVED'?'workspace.shortcuts.reserved':'workspace.failed')}}
async function apply(replace){if(conflicts.value.length&&!replace)return;const next={...commandState.bindings};if(replace)for(const command of conflicts.value)next[command.id]=bindingsFor(command).filter(key=>key!==draft.value);next[recording.value]=[draft.value];try{await saveBindings(next);cancel()}catch(error){notice.value=t(error.message==='KEYMAP_RESERVED'?'workspace.shortcuts.reserved':'workspace.failed')}}
async function reset(command){const next={...commandState.bindings};delete next[command.id];await saveBindings(next)}
async function resetAll(){if(window.confirm(t('workspace.shortcuts.resetConfirm')))await saveBindings({})}
function exportKeys(){const url=URL.createObjectURL(new Blob([JSON.stringify({schemaVersion:1,bindings:commandState.bindings},null,2)],{type:'application/json'}));const a=document.createElement('a');a.href=url;a.download='friday-shortcuts.json';a.click();URL.revokeObjectURL(url)}
async function importKeys(event){try{const value=JSON.parse(await event.target.files[0].text());if(value.schemaVersion!==1)throw new Error();await saveBindings(value.bindings);notice.value=t('workspace.shortcuts.saved')}catch(error){notice.value=t(error.message==='KEYMAP_RESERVED'?'workspace.shortcuts.reserved':'workspace.failed')}finally{event.target.value=''}}
onMounted(()=>window.addEventListener('keydown',capture,true));onBeforeUnmount(()=>{window.removeEventListener('keydown',capture,true);cancel()});onDeactivated(cancel)
</script>
