<template>
  <FridayDialog :visible="visible" :title="t(phrase ? item ? 'clipboard.editPhrase' : 'clipboard.newPhrase' : 'clipboard.editOrganization')" :close-label="t('clipboard.close')" @close="!saving && $emit('close')">
    <FridayNotice v-if="error" error>{{ error }}</FridayNotice>
    <FridayNotice v-if="batchIds.length">{{ t('clipboard.batchOrganizeHint', { count: batchIds.length }) }}</FridayNotice>
    <label v-if="phrase" class="field"><span>{{ t('clipboard.phraseContent') }}</span><textarea ref="phraseInput" v-model="text" :aria-label="t('clipboard.phraseContent')" rows="7" maxlength="24000" :disabled="saving" /></label>
    <label class="field"><span>{{ t('clipboard.category') }}</span><input v-model="category" :list="categoryListId" maxlength="40" :disabled="saving" :placeholder="t('clipboard.categoryHint')" /><datalist :id="categoryListId"><option v-for="name in groups.categories" :key="name" :value="name" /></datalist></label>
    <div class="field"><label :for="tagInputId">{{ t('clipboard.tags') }}</label><div class="tag-entry"><input :id="tagInputId" v-model="tagInput" :list="tagListId" maxlength="40" :disabled="saving || tags.length >= 20" @keydown.enter.prevent="addTag" :placeholder="t('clipboard.tagHint')" /><FridayButton :disabled="saving || !tagInput.trim() || tags.length >= 20" @click="addTag">{{ t('clipboard.add') }}</FridayButton></div><datalist :id="tagListId"><option v-for="name in groups.tags" :key="name" :value="name" /></datalist><div class="tags"><button v-for="tag in tags" :key="tag" class="tag-chip" :disabled="saving" type="button" :aria-label="t('clipboard.removeTag', { name: tag })" @click="tags = tags.filter(value => value !== tag)">{{ tag }}<X :size="12" /></button></div></div>
    <template #footer><FridayButton :disabled="saving" @click="$emit('close')">{{ t('clipboard.cancel') }}</FridayButton><FridayButton variant="primary" :disabled="saving || (phrase && !text.trim())" @click="save">{{ t(saving ? 'clipboard.saving' : 'clipboard.saveSettings') }}</FridayButton></template>
  </FridayDialog>
</template>
<script setup>
import { nextTick, ref, useId, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { X } from 'lucide-vue-next'
import FridayDialog from '@/components/ui/FridayDialog.vue'
import FridayButton from '@/components/ui/FridayButton.vue'
import FridayNotice from '@/components/ui/FridayNotice.vue'
import { electronService } from '@/services/electron'
const props = defineProps({ visible: Boolean, item: Object, phrase: Boolean, batchIds: { type: Array, default: () => [] }, groups: { type: Object, default: () => ({ categories: [], tags: [] }) } })
const emit = defineEmits(['close', 'changed'])
const { t } = useI18n()
const categoryListId = useId(), tagListId = useId(), tagInputId = useId()
const phraseInput = ref(null)
const text = ref(''), category = ref(''), tags = ref([]), tagInput = ref(''), saving = ref(false), error = ref('')
watch(() => props.visible, visible => { if (visible) { text.value = props.item?.plainText || ''; category.value = props.item?.category || ''; tags.value = [...(props.item?.tags || [])]; tagInput.value = ''; error.value = ''; nextTick(() => { if (props.phrase) phraseInput.value?.focus() }) } })
function addTag() { const tag = tagInput.value.trim(); if (tag && !tags.value.includes(tag) && tags.value.length < 20) tags.value.push(tag); tagInput.value = '' }
async function save() {
  if (saving.value || (props.phrase && !text.value.trim())) return
  addTag(); saving.value = true; error.value = ''
  try {
    // IPC 不能克隆 Vue 响应式数组，传入独立的普通数组。
    const patch = { category: category.value.trim(), tags: [...tags.value] }
    if (props.phrase) patch.plainText = text.value
    if (props.batchIds.length && !patch.category) delete patch.category
    const updated = props.batchIds.length ? await electronService.batchClipboardItems({ ids: [...props.batchIds], action: 'organize', patch }) : props.item ? await electronService.request('clipboard-update', { id: props.item.id, ...patch }) : await electronService.createClipboardPhrase({ text: text.value, ...patch })
    emit('changed', updated); emit('close')
  } catch (e) { const code = ['STALE', 'SENSITIVE', 'TAG_LIMIT'].find(code => e.message?.includes('CLIPBOARD_BATCH_' + code)); error.value = code ? t('clipboard.batchErrors.' + code) : e.message?.includes('CLIPBOARD_AI_SENSITIVE') ? t('clipboard.sensitivePhraseBlocked') : t('clipboard.organizeFailed') }
  finally { saving.value = false }
}
</script>
<style scoped>
.field{display:flex;flex-direction:column;gap:9px;margin-bottom:18px;color:var(--text-secondary);font-size:13px}.field input,.field textarea{width:100%;box-sizing:border-box;padding:10px 12px;border:1px solid var(--border-color);border-radius:8px;background:var(--bg-secondary);font:inherit;font-size:13px;line-height:1.6;color:var(--text-primary);outline:none}.field input:focus,.field textarea:focus{border-color:var(--text-tertiary)}.field textarea{resize:vertical;max-height:40vh}.tag-entry{display:flex;align-items:center;gap:8px}.tag-entry input{min-width:0;flex:1}.tags{display:flex;gap:6px;flex-wrap:wrap}.tag-chip{display:inline-flex;align-items:center;gap:6px;border:0;border-radius:5px;padding:5px 8px;font:inherit;font-size:12px;background:var(--bg-secondary);color:var(--text-secondary);cursor:pointer}.tag-chip:hover{background:var(--bg-hover)}
</style>
