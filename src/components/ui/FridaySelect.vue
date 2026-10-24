<template>
  <div ref="root" class="friday-select" @keydown.esc.stop="close(true)" @keydown.down.prevent="move(1)" @keydown.up.prevent="move(-1)">
    <button ref="trigger" type="button" class="dropdown-trigger" :disabled="disabled" :aria-label="label" aria-haspopup="listbox" :aria-expanded="open" @click="open = !open">
      <span>{{ selectedLabel }}</span><ChevronDown :size="16" :stroke-width="2" :class="{ expanded: open }" />
    </button>
    <Transition name="dropdown-menu">
      <div v-if="open" class="dropdown-menu more-menu" role="listbox" :aria-label="label">
        <button v-for="option in options" :key="option.value" type="button" role="option" :aria-selected="modelValue === option.value" :class="['menu-item', { active: modelValue === option.value }]" @click="choose(option.value)">
          <span>{{ option.label }}</span><Check v-if="modelValue === option.value" :size="13" :stroke-width="2.3" />
        </button>
      </div>
    </Transition>
  </div>
</template>

<script setup>
import { computed, nextTick, onMounted, onUnmounted, ref } from 'vue'
import { Check, ChevronDown } from 'lucide-vue-next'
const props = defineProps({ modelValue: [String, Number], options: { type: Array, default: () => [] }, label: String, disabled: Boolean })
const emit = defineEmits(['update:modelValue'])
const root = ref(null)
const trigger = ref(null)
const open = ref(false)
const selectedLabel = computed(() => props.options.find(option => option.value === props.modelValue)?.label || props.label)
function close(focus = false) { open.value = false; if (focus) trigger.value?.focus() }
function choose(value) { emit('update:modelValue', value); close(true) }
async function move(offset) {
  if (props.disabled) return
  if (!open.value) { open.value = true; await nextTick() }
  const buttons = [...(root.value?.querySelectorAll('[role=option]') || [])]
  if (!buttons.length) return
  const current = buttons.indexOf(document.activeElement)
  const index = current < 0 ? (offset > 0 ? 0 : buttons.length - 1) : (current + offset + buttons.length) % buttons.length
  buttons[index]?.focus()
}
function outside(event) { if (!root.value?.contains(event.target)) close() }
onMounted(() => document.addEventListener('pointerdown', outside))
onUnmounted(() => document.removeEventListener('pointerdown', outside))
</script>

<style scoped>
/* 取自官方 AutomationView.vue 的 form-select 和 dropdown-menu。 */
.friday-select { position:relative; height:40px; min-width:160px; border:1px solid var(--border-color); border-radius:8px; background:var(--bg-primary); transition:border-color .15s ease,box-shadow .15s ease; }
.friday-select:focus-within { border-color:var(--text-tertiary); box-shadow:0 0 0 3px var(--bg-hover); }
.dropdown-trigger { width:100%; height:100%; padding:0 11px 0 12px; border:0; display:flex; align-items:center; justify-content:space-between; gap:8px; background:transparent; color:var(--text-primary); font:inherit; font-size:13px; cursor:pointer; }
.dropdown-trigger:disabled { opacity:.45; cursor:default; }
.dropdown-trigger svg { flex-shrink:0; color:var(--text-secondary); transition:transform .18s ease; }
.dropdown-trigger svg.expanded { transform:rotate(180deg); }
.dropdown-menu.more-menu { position:absolute; top:calc(100% + 6px); left:0; z-index:1010; min-width:100%; width:max-content; max-width:min(400px,80vw); max-height:280px; overflow-y:auto; padding:4px; border:1px solid var(--border-color); border-radius:8px; background:var(--bg-primary); box-shadow:0 6px 24px rgba(0,0,0,.1),0 2px 6px rgba(0,0,0,.05); }
.menu-item { width:100%; min-height:32px; padding:7px 10px; border:0; border-radius:5px; display:flex; align-items:center; justify-content:space-between; gap:8px; background:transparent; color:var(--text-primary); font:inherit; font-size:13px; font-weight:400; text-align:left; cursor:pointer; transition:background .12s ease; }
.menu-item:hover,.menu-item.active,.menu-item:focus { background:var(--bg-hover); color:var(--text-primary); }
.menu-item svg { flex-shrink:0; }
.dropdown-menu-enter-active,.dropdown-menu-leave-active { transition:opacity .15s cubic-bezier(.16,1,.3,1),transform .15s cubic-bezier(.16,1,.3,1); transform-origin:top; }
.dropdown-menu-enter-from,.dropdown-menu-leave-to { opacity:0; transform:translateY(-4px) scale(.96); }
</style>
