<template><div ref="host" class="typewriter-original-host" /></template>
<script setup>
import { onMounted, onActivated, onDeactivated, onBeforeUnmount, ref, watch } from 'vue'
import React from 'react'
import { createRoot } from 'react-dom/client'
import { useI18n } from 'vue-i18n'
import { NocturneShell } from '@/features/typewriter/nocturne-core/lib/nocturne/components/shell.tsx'
import { connectSettings, setSettings } from '@/features/typewriter/nocturne-core/lib/nocturne/store.ts'
import { TerminalSurface } from '@/features/typewriter/plugins/TerminalSurface.tsx'
import { NoteSurface } from '@/features/typewriter/plugins/NoteSurface.tsx'
import { focusContent } from '@/features/typewriter/content-plugin'
import 'xterm/css/xterm.css'
import '@fontsource/courier-prime/400.css'
import '@fontsource/courier-prime/700.css'
import '@fontsource/ibm-plex-mono/400.css'
import '@fontsource/eb-garamond/400.css'
import '@fontsource/eb-garamond/400-italic.css'
import '@fontsource/cormorant-garamond/400.css'
import '@/features/typewriter/nocturne-core/nocturne.css'
import '@/features/typewriter/nocturne-core/nerd-symbols.css'
import '@/features/typewriter/plugins/plugins.css'
const props = defineProps({ settings: {type: Object, required: true}, source: {type: Object, default: null} })
const emit = defineEmits(['settings', 'change'])
const { locale } = useI18n()
const host = ref(null)
let root, disconnect
function render() {
  if (!root) return
  const content = props.source
    ? React.createElement(NoteSurface, {key: props.source.viewId || props.source.id, document: props.source, onChange: text => emit('change', text)})
    : React.createElement(TerminalSurface)
  root.render(React.createElement(NocturneShell, {header: null}, content))
}
function command(name) { window.dispatchEvent(new CustomEvent('nocturne:command', {detail: name})) }
defineExpose({ command })
watch(() => props.settings, next => setSettings(next), {deep: true})
watch([() => props.source, locale], render)
function shortcuts(event) {
  const modifier = event.ctrlKey || event.metaKey
  if (!modifier) return
  const key = event.key.toLowerCase()
  const name = event.shiftKey ? ({enter:'focus-mode',l:'lighting',p:'print',o:'archive',',':'studio'}[key]) : event.altKey && key === 'm' ? 'sound' : null
  if (name) { event.preventDefault(); command(name) }
}
function mount() {
  if (root) return
  window.addEventListener('keydown', shortcuts)
  disconnect = connectSettings(props.settings, settings => emit('settings', settings))
  window.focusActiveTerm = focusContent
  root = createRoot(host.value)
  render()
}
function unmount() {
  window.removeEventListener('keydown', shortcuts)
  root?.unmount(); root = null; disconnect?.(); delete window.focusActiveTerm
}
onMounted(mount)
onActivated(mount)
onDeactivated(unmount)
onBeforeUnmount(unmount)
</script>
<style>
.typewriter-original-host{position:relative;width:100%;height:100%;min-height:0;isolation:isolate}
.typewriter-original-host .tn-stage{top:0}
</style>
