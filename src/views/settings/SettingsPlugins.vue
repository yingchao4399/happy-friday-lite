<template>
<section class="plugin-settings"><router-link to="/settings">← {{ t('settings.title') }}</router-link><h1>{{ t(market?'workspace.market.title':'workspace.plugins.title') }}</h1>
<nav><router-link to="/settings/plugins">{{ t('workspace.plugins.title') }}</router-link><router-link to="/settings/plugin-market">{{ t('workspace.market.title') }}</router-link><button @click="act('import')" :disabled="!!state.busy">{{ t('workspace.plugins.import') }}</button><button v-if="market" @click="catalog(true)" :disabled="loading">{{ t('workspace.plugins.refresh') }}</button></nav>
<p v-if="error||state.error" role="alert">{{ t('workspace.failed') }} · {{ error||state.error }}</p><p v-if="loading" role="status">{{ t('workspace.plugins.loading') }}</p>
<div v-if="selected" class="plugin-detail"><button @click="selected=null">← {{ t('workspace.plugins.back') }}</button><h2>{{ selected.name }}</h2><p>{{ selected.description }}</p><dl><dt>ID</dt><dd>{{ selected.id }}</dd><dt>{{ t('workspace.plugins.author') }}</dt><dd>{{ selected.author }}</dd><dt>{{ t('workspace.plugins.version') }}</dt><dd>{{ installed(selected.id)?.manifest.version || selected.version || t('workspace.plugins.latest') }}</dd><dt>{{ t('workspace.plugins.repo') }}</dt><dd>{{ selected.repo || installed(selected.id)?.source.repo || '—' }}</dd><dt>{{ t('workspace.plugins.permissions') }}</dt><dd>{{ installed(selected.id)?.manifest.permissions?.join(', ') || t('workspace.plugins.defaultPermissions') }}</dd></dl><p>{{ t('workspace.plugins.compatibilityHint') }}</p><p v-if="selected.format==='obsidian'">{{ t('workspace.plugins.markdownHint') }}</p><p v-if="installed(selected.id)?.lastError" role="alert">{{ installed(selected.id).lastError }}</p><button v-if="!installed(selected.id)" @click="download(selected)">{{ t('workspace.plugins.install') }}</button></div>
<template v-else>
<div class="plugin-filters"><input v-model="query" type="search" :placeholder="t('workspace.plugins.search')" /><select v-model="category" :aria-label="t('workspace.plugins.category')"><option value="all">{{ t('workspace.commands.all') }}</option><option v-for="key in ['agent','notes','office','obsidian','other']" :key="key" :value="key">{{ t('workspace.plugins.categories.'+key) }}</option></select></div>
<p v-if="market" class="plugin-market-note">{{ t('workspace.plugins.marketHint') }} <small v-if="fetchedAt">{{ fetchedAt }}</small></p>
<article v-for="item in page" :key="item.id" class="plugin-card" :data-plugin-id="item.id"><header><button class="plugin-name" @click="selected=item">{{ item.name }}</button><span>{{ installed(item.id)?.manifest.version || item.version || '' }}</span><span class="plugin-status">{{ t('workspace.plugins.states.'+(installed(item.id)?.compatibility||'unverified')) }}</span></header><p>{{ item.description }}</p><small>{{ item.author }} · {{ item.repo||item.id }}</small><p v-if="installed(item.id)?.lastError" role="alert">{{ installed(item.id).lastError }}</p><div class="plugin-actions" :aria-busy="state.busy===item.id">
<template v-if="installed(item.id)"><button :disabled="!!state.busy" @click="toggle(item)">{{ t('workspace.plugins.'+(installed(item.id).running?'disable':'enable')) }}</button><button :disabled="!installed(item.id).running||!!state.busy" @click="act('settings',{id:item.id})">{{ t('workspace.plugins.settings') }}</button><button v-if="installed(item.id).source.repo" :disabled="!!state.busy" @click="download({...item,repo:installed(item.id).source.repo})">{{ t('workspace.plugins.update') }}</button><button v-if="installed(item.id).previous" :disabled="!!state.busy" @click="act('rollback',{id:item.id})">{{ t('workspace.plugins.rollback') }}</button><button :disabled="!!state.busy" @click="remove(item)">{{ t('workspace.plugins.uninstall') }}</button></template>
<button v-else :disabled="!!state.busy" @click="download(item)">{{ t('workspace.plugins.install') }}</button>
</div></article><p v-if="!filtered.length&&!loading">{{ t('workspace.plugins.empty') }}</p><button v-if="limit<filtered.length" @click="limit+=60">{{ t('workspace.plugins.more') }} ({{ filtered.length }})</button>
</template></section>
</template>
<script setup>
import {computed,ref,watch} from 'vue'
import {useRoute} from 'vue-router'
import {useI18n} from 'vue-i18n'
import {electronService} from '@/services/electron'
import {pluginState as state,pluginAction,refreshPlugins} from '@/features/plugins/client'
const route=useRoute(),{t}=useI18n(),query=ref(''),category=ref('all'),selected=ref(null),entries=ref([]),limit=ref(60),error=ref(''),loading=ref(false),fetchedAt=ref('')
const market=computed(()=>route.path.includes('plugin-market'))
const example={id:'friday-writing-tools',name:'Friday Writing Tools',version:'1.0.0',description:t('workspace.plugins.example'),author:'Happy Friday Lite',category:'notes',format:'friday'}
const sample={id:'obsidian-sample-plugin',name:'Obsidian Sample Plugin (1.0.0)',author:'Licat / Obsidian',category:'obsidian',format:'obsidian',repo:'obsidianmd/obsidian-sample-plugin',description:t('workspace.plugins.officialSample')}
const installed=id=>state.records.find(r=>r.manifest.id===id)
const filtered=computed(()=>[...(market.value?[example,sample,...entries.value.filter(e=>e.id!=='obsidian-sample-plugin')]:state.records.map(r=>({...r.manifest,repo:r.source.repo})))].filter(e=>(category.value==='all'||e.category===category.value)&&(e.name+' '+e.id+' '+(e.description||'')+' '+(e.author||'')).toLowerCase().includes(query.value.toLowerCase())))
const page=computed(()=>filtered.value.slice(0,limit.value))
watch([query,category,market],()=>{limit.value=60;selected.value=null})
async function catalog(refresh=false){loading.value=true;error.value='';try{const data=await electronService.request('plugins-catalog',{refresh});entries.value=data.entries;fetchedAt.value=data.fetchedAt}catch(e){error.value=e.message}finally{loading.value=false}}
watch(market,value=>{void refreshPlugins();if(value)void catalog()},{immediate:true})
async function act(action,args){try{await pluginAction(action,args)}catch{}}
async function toggle(item){const record=installed(item.id);if(!record.running&&!window.confirm(t('workspace.plugins.enableConfirm',{name:item.name,permissions:record.manifest.permissions.join(', ')})))return;await act(record.running?'disable':'enable',{id:item.id})}
async function download(item){if(item.id==='friday-writing-tools')await act('example');else if(item.id==='obsidian-sample-plugin')await act('sample');else if(window.confirm(t('workspace.plugins.downloadConfirm',{name:item.name})))await act('download',{id:item.id,repo:item.repo})}
async function remove(item){if(window.confirm(t('workspace.plugins.removeConfirm',{name:item.name})))await act('uninstall',{id:item.id})}
</script>
