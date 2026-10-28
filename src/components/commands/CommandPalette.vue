<template>
  <Teleport to="body"><div v-if="state.open" class="command-backdrop" @mousedown.self="close" @keydown="keys">
    <section class="command-palette" role="dialog" aria-modal="true" :aria-label="t('workspace.commands.title')">
      <header><input ref="search" v-model="state.query" :placeholder="t('workspace.commands.search')" :aria-label="t('workspace.commands.search')" role="combobox" :aria-expanded="true" aria-controls="friday-command-results" :aria-activedescendant="rows[index]?'command-'+rows[index].command.id:undefined" /><button type="button" @click="close" :aria-label="t('workspace.close')">×</button></header>
      <div class="command-categories"><button type="button" @click="state.category='all'" :class="{active:state.category==='all'}">{{ t('workspace.commands.all') }}</button><button v-for="category in categories" :key="category" type="button" :class="{active:state.category===category}" @click="state.category=category">{{ t('workspace.categories.'+category) }}</button></div>
      <div id="friday-command-results" class="command-results" role="listbox">
        <button v-for="(row,i) in rows" :id="'command-'+row.command.id" :key="row.command.id" type="button" role="option" :aria-selected="i===index" :aria-disabled="!row.enabled" :class="{selected:i===index,disabled:!row.enabled}" @mousemove="index=i" @click="run(row)"><span><small>{{ t('workspace.categories.'+row.command.category) }} · {{ row.command.source }}</small>{{ row.title }}<small v-if="!row.enabled">{{ t('workspace.commands.unavailable') }}</small></span><kbd v-for="key in bindingsFor(row.command)" :key="key">{{ key.replaceAll('Mod',mac?'⌘':'Ctrl') }}</kbd></button>
        <p v-if="!rows.length">{{ t('workspace.commands.empty') }}</p>
      </div>
      <footer>↑↓ {{ t('workspace.commands.navigate') }}　↵ {{ t('workspace.commands.execute') }}　Esc {{ t('workspace.close') }}</footer>
    </section>
  </div></Teleport>
</template>
<script setup>
import {computed,ref,watch,nextTick} from 'vue'
import {useI18n} from 'vue-i18n'
import {commands,commandState as state,searchCommands,bindingsFor,executeCommand,closeCommandPalette} from '@/features/commands/registry'
const {t}=useI18n(),search=ref(),index=ref(0),mac=window.electronAPI?.platform==='darwin'
const categories=computed(()=>[...new Set([...commands.values()].map(c=>c.category))])
const rows=computed(()=>searchCommands(state.query,state.category))
watch(()=>state.open,async value=>{if(value){await nextTick();search.value?.focus()}})
watch([()=>state.query,()=>state.category],()=>index.value=0)
const close=()=>void closeCommandPalette()
async function run(row){if(!row?.enabled)return;await closeCommandPalette();await executeCommand(row.command.id)}
function keys(e){if(e.isComposing)return;if(e.key==='Escape'){e.preventDefault();close()}else if(['ArrowDown','ArrowUp'].includes(e.key)){e.preventDefault();index.value=(index.value+(e.key==='ArrowDown'?1:-1)+rows.value.length)%Math.max(1,rows.value.length);nextTick(()=>document.getElementById('command-'+rows.value[index.value]?.command.id)?.scrollIntoView({block:'nearest'}))}else if(e.key==='Enter'){e.preventDefault();void run(rows.value[index.value])}else if(e.key==='Tab'){e.preventDefault();search.value?.focus()}}
</script>
<style>
.command-backdrop{position:fixed;inset:0;z-index:20000;background:#0004;display:flex;align-items:flex-start;justify-content:center;padding:8vh 20px}.command-palette{width:min(850px,94vw);background:var(--bg-primary,#fff);color:var(--text-primary,#222);border:1px solid var(--border-color,#ddd);border-radius:15px;box-shadow:0 18px 60px #0004;overflow:hidden}.command-palette header{display:flex;padding:15px;border-bottom:1px solid var(--border-color,#ddd)}.command-palette header input{flex:1;min-width:0;padding:6px;border:0;outline:none;background:transparent;color:inherit;font:inherit;font-size:18px}.command-palette button{cursor:pointer;font:inherit;color:inherit}.command-palette header button{border:0;background:transparent;font-size:24px}.command-categories{display:flex;flex-wrap:wrap;gap:4px;padding:10px}.command-categories button{border:0;border-radius:5px;padding:5px 9px;background:transparent}.command-categories .active{background:var(--bg-hover,#edf1f7)}.command-results{max-height:57vh;overflow:auto;padding:6px 12px}.command-results>button{display:flex;align-items:center;gap:8px;width:100%;text-align:left;padding:10px 12px;border:0;border-radius:6px;background:transparent}.command-results>button>span{flex:1;display:flex;flex-direction:column;gap:3px}.command-results small{font-size:11px;opacity:.6}.command-results .selected{background:var(--bg-hover,#eee)}.command-results .disabled{opacity:.45}.command-results kbd{padding:3px 6px;border-radius:5px;background:var(--bg-secondary,#eee);font-size:12px}.command-palette footer{text-align:center;border-top:1px solid var(--border-color,#ddd);padding:10px;font-size:12px;opacity:.7}
</style>
