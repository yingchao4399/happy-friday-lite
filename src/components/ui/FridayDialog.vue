<template>
  <Teleport to="body"><Transition name="modal-fade">
    <div v-if="visible" class="dialog-overlay" @mousedown.self="$emit('close')">
      <section ref="dialog" class="dialog" :class="{ wide }" role="dialog" aria-modal="true" :aria-label="title" tabindex="-1" @keydown.esc.stop="$emit('close')" @keydown.tab="cycleFocus">
        <header><h2>{{ title }}</h2><FridayButton icon-only variant="text" :aria-label="closeLabel" @click="$emit('close')"><X :size="20" /></FridayButton></header>
        <div class="dialog-body"><slot /></div><footer v-if="$slots.footer"><slot name="footer" /></footer>
      </section>
    </div>
  </Transition></Teleport>
</template>
<script setup>
import { nextTick, onUnmounted, ref, watch } from 'vue'
import { X } from 'lucide-vue-next'
import FridayButton from './FridayButton.vue'
const props = defineProps({ visible: Boolean, title: String, closeLabel: String, wide: Boolean })
defineEmits(['close'])
const dialog = ref(null)
let previousFocus
watch(() => props.visible, async visible => {
  if (visible) {
    previousFocus = document.activeElement
    await nextTick()
    dialog.value?.querySelector('button')?.focus()
  } else if (previousFocus?.isConnected) previousFocus.focus()
})
function cycleFocus(event) {
  const nodes = [...(dialog.value?.querySelectorAll('button:not(:disabled), input:not(:disabled), textarea:not(:disabled), select:not(:disabled), a[href], [contenteditable="true"], [tabindex="0"]') || [])].filter(node => node.getClientRects().length)
  if (!nodes.length) { event.preventDefault(); dialog.value?.focus(); return }
  const index = nodes.indexOf(document.activeElement)
  if (event.shiftKey && index <= 0) { event.preventDefault(); nodes.at(-1).focus() }
  else if (!event.shiftKey && (index < 0 || index === nodes.length - 1)) { event.preventDefault(); nodes[0].focus() }
}
onUnmounted(() => { if (props.visible && previousFocus?.isConnected) previousFocus.focus() })
</script>
<style scoped>
/* 延续官方 Automation 弹窗的主题、圆角与淡入上移动效。 */
.dialog-overlay{position:fixed;inset:0;z-index:1000;padding:24px;display:flex;align-items:center;justify-content:center;background:rgba(15,15,16,.48);backdrop-filter:blur(2px)}.dialog{display:flex;flex-direction:column;width:min(640px,100%);max-height:calc(100dvh - 48px);border:1px solid var(--border-color);border-radius:10px;background:var(--bg-primary);color:var(--text-primary);box-shadow:0 24px 70px rgba(0,0,0,.22);outline:none}.wide{width:min(1100px,100%)}header{padding:16px 22px;display:flex;align-items:center;justify-content:space-between;gap:16px;flex-shrink:0;border-bottom:1px solid var(--border-color)}h2{margin:0;font-size:18px;line-height:1.3;font-weight:650}.dialog-body{padding:20px 22px;overflow:auto;min-height:0}footer{padding:14px 22px 20px;display:flex;flex-wrap:wrap;justify-content:flex-end;align-items:center;gap:8px;flex-shrink:0}.modal-fade-enter-active,.modal-fade-leave-active{transition:opacity .18s ease}.modal-fade-enter-active .dialog,.modal-fade-leave-active .dialog{transition:transform .18s ease}.modal-fade-enter-from,.modal-fade-leave-to{opacity:0}.modal-fade-enter-from .dialog,.modal-fade-leave-to .dialog{transform:translateY(8px) scale(.99)}@media(max-width:640px){.dialog-overlay{padding:12px}.dialog{max-height:calc(100dvh - 24px)}header,.dialog-body,footer{padding-left:16px;padding-right:16px}}@media(prefers-reduced-motion:reduce){.modal-fade-enter-active,.modal-fade-leave-active,.modal-fade-enter-active .dialog,.modal-fade-leave-active .dialog{transition:none}}
</style>
