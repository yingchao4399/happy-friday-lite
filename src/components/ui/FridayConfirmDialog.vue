<template>
  <Teleport to="body">
    <Transition name="modal-fade">
      <div v-if="visible" class="dialog-overlay" @mousedown.self="$emit('cancel')">
        <section ref="dialog" class="dialog" role="dialog" aria-modal="true" :aria-label="title" @keydown.esc.stop="$emit('cancel')" @keydown.tab.prevent="cycleFocus">
          <header><h2>{{ title }}</h2><FridayButton icon-only variant="text" :aria-label="cancelLabel" @click="$emit('cancel')"><X :size="20" /></FridayButton></header>
          <p>{{ message }}</p><footer><FridayButton ref="cancel" @click="$emit('cancel')">{{ cancelLabel }}</FridayButton><FridayButton variant="primary" @click="$emit('confirm')">{{ confirmLabel }}</FridayButton></footer>
        </section>
      </div>
    </Transition>
  </Teleport>
</template>
<script setup>
import { nextTick, ref, watch } from 'vue'
import { X } from 'lucide-vue-next'
import FridayButton from './FridayButton.vue'
const props = defineProps({ visible: Boolean, title: String, message: String, cancelLabel: String, confirmLabel: String })
defineEmits(['confirm', 'cancel'])
const dialog = ref(null)
const cancel = ref(null)
let previousFocus = null
watch(() => props.visible, async visible => {
  if (visible) { previousFocus = document.activeElement; await nextTick(); cancel.value?.$el?.focus() }
  else previousFocus?.focus?.()
})
function cycleFocus(event) {
  const buttons = [...(dialog.value?.querySelectorAll('button:not(:disabled)') || [])]
  if (!buttons.length) return
  const index = buttons.indexOf(document.activeElement)
  buttons[(index + (event.shiftKey ? -1 : 1) + buttons.length) % buttons.length]?.focus()
}
</script>
<style scoped>
/* 官方 AutomationView 的 modal-overlay / modal / modal-fade。 */
.dialog-overlay{position:fixed;inset:0;z-index:1000;padding:24px;display:flex;align-items:center;justify-content:center;background:rgba(15,15,16,.48);backdrop-filter:blur(2px)}.dialog{width:min(440px,100%);border:1px solid var(--border-color);border-radius:10px;background:var(--bg-primary);color:var(--text-primary);box-shadow:0 24px 70px rgba(0,0,0,.22)}header{min-height:56px;padding:16px 22px 10px;display:flex;align-items:center;justify-content:space-between;gap:20px}h2{font-size:18px;line-height:1.3;font-weight:650}p{padding:12px 22px;color:var(--text-secondary);font-size:13px;line-height:1.65}footer{padding:14px 22px 22px;display:flex;justify-content:flex-end;gap:8px}.modal-fade-enter-active,.modal-fade-leave-active{transition:opacity .18s ease}.modal-fade-enter-active .dialog,.modal-fade-leave-active .dialog{transition:transform .18s ease,opacity .18s ease}.modal-fade-enter-from,.modal-fade-leave-to,.modal-fade-enter-from .dialog,.modal-fade-leave-to .dialog{opacity:0}.modal-fade-enter-from .dialog,.modal-fade-leave-to .dialog{transform:translateY(8px) scale(.99)}
</style>
