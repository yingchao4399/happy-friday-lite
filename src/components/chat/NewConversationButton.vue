<template>
  <button class="new-conversation-button" type="button" :title="error || t('friday.newConversation')" :aria-label="error || t('friday.newConversation')" :aria-busy="creating" :disabled="creating || disabled" @click="create">
    <span v-if="error" role="alert">{{ error }}</span>
    <slot v-else><Plus :size="16" :stroke-width="2" /></slot>
  </button>
</template>

<script setup>
import { ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { Plus } from 'lucide-vue-next'
import { conversationStore } from '@/services/conversationStore'

const props = defineProps({
  scope: { type: String, required: true },
  scopeKey: { type: String, default: '' },
  agentId: { type: String, default: '' },
  modelId: { type: String, default: '' },
  mode: { type: String, default: 'chat' },
  disabled: { type: Boolean, default: false }
})
const emit = defineEmits(['create'])
const { t } = useI18n()
const creating = ref(false)
const error = ref('')

async function create() {
  if (creating.value || props.disabled) return
  creating.value = true
  error.value = ''
  const scope = { scope: props.scope, scopeKey: props.scopeKey || null }
  try {
    const session = await conversationStore.create({ ...scope, title: t('friday.newConversation'), agentId: props.agentId || undefined, modelId: props.modelId || undefined, mode: props.mode })
    if (!session?.id) throw new Error(t('friday.scopedHistory.actionFailed'))
    // 切换资源期间完成的创建不能覆盖新资源的当前会话。
    if (scope.scope === props.scope && scope.scopeKey === (props.scopeKey || null)) emit('create', { session, messages: [] })
  } catch (err) {
    error.value = err?.message || t('friday.scopedHistory.actionFailed')
  } finally { creating.value = false }
}
</script>

<style scoped>
.new-conversation-button:focus-visible { outline: 2px solid var(--accent-color, #6366f1); outline-offset: 2px; }
.new-conversation-button:disabled { opacity: .6; cursor: wait; }
</style>
