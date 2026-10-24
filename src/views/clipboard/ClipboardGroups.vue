<template>
  <FridayDialog :visible="visible" :title="t('clipboard.manageGroups')" :close-label="t('clipboard.close')" @close="!saving && $emit('close')">
    <FridayNotice v-if="error" error>{{ error }}</FridayNotice>
    <div class="group-tabs" role="tablist" :aria-label="t('clipboard.manageGroups')"><button v-for="option in typeOptions" :key="option.value" type="button" role="tab" :aria-selected="type === option.value" :disabled="saving" @click="type = option.value">{{ option.label }}</button></div>

    <p v-if="!groups[type].length" class="empty">{{ t('clipboard.noGroups') }}</p>
    <div v-for="entry in groups[type]" :key="entry" class="group-row">
      <template v-if="editing === entry"><input v-model="nextName" :aria-label="t('clipboard.groupName')" maxlength="40" :disabled="saving" @keydown.enter.prevent="manage('rename', entry)" @keydown.esc="editing = ''" /><FridayButton compact :disabled="saving || !nextName.trim()" @click="manage('rename', entry)">{{ t('clipboard.saveSettings') }}</FridayButton><FridayButton compact variant="text" :disabled="saving" @click="editing = ''">{{ t('clipboard.cancel') }}</FridayButton></template>
      <template v-else><span>{{ entry }}</span><FridayButton icon-only variant="text" :disabled="saving" :aria-label="t('clipboard.renameGroup', { name: entry })" @click="editing = entry; nextName = entry"><Pencil :size="14" /></FridayButton><FridayButton icon-only variant="danger" :disabled="saving" :aria-label="t('clipboard.deleteGroup', { name: entry })" @click="deleting = entry"><Trash2 :size="14" /></FridayButton></template>
    </div>
    <template #footer><form class="new-group" @submit.prevent="manage('create')"><label :for="nameId">{{ t(type === 'categories' ? 'clipboard.newCategory' : 'clipboard.newTag') }}</label><div><input :id="nameId" ref="nameInput" v-model="name" :aria-label="t('clipboard.groupName')" :placeholder="t('clipboard.groupName')" maxlength="40" :disabled="saving" /><FridayButton type="submit" variant="primary" :disabled="!name.trim() || saving"><Plus :size="14" />{{ t(saving ? 'clipboard.saving' : type === 'categories' ? 'clipboard.newCategory' : 'clipboard.newTag') }}</FridayButton></div><span v-if="created" class="created-feedback" role="status">{{ t('clipboard.groupCreated', { name: created }) }}</span></form><FridayButton :disabled="saving" @click="$emit('close')">{{ t('clipboard.close') }}</FridayButton></template>
  </FridayDialog>
  <FridayConfirmDialog :visible="!!deleting" :title="t('clipboard.deleteGroup', { name: deleting })" :message="t('clipboard.deleteGroupHint')" :cancel-label="t('clipboard.cancel')" :confirm-label="t('clipboard.delete')" @cancel="deleting = ''" @confirm="manage('delete', deleting)" />
</template>
<script setup>
import { computed, nextTick, ref, useId, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { Pencil, Plus, Trash2 } from 'lucide-vue-next'
import FridayDialog from '@/components/ui/FridayDialog.vue'
import FridayButton from '@/components/ui/FridayButton.vue'
import FridayConfirmDialog from '@/components/ui/FridayConfirmDialog.vue'
import FridayNotice from '@/components/ui/FridayNotice.vue'
import { electronService } from '@/services/electron'
const props = defineProps({ visible: Boolean, initialType: { type: String, default: 'categories' }, groups: { type: Object, required: true } })
const emit = defineEmits(['close', 'changed'])
const { t } = useI18n()
const nameId = useId(), nameInput = ref(null), created = ref('')
const type = ref('categories'), name = ref(''), editing = ref(''), nextName = ref(''), deleting = ref(''), saving = ref(false), error = ref('')
const typeOptions = computed(() => [{ value: 'categories', label: t('clipboard.categories') }, { value: 'tags', label: t('clipboard.tags') }])
watch(type, () => { name.value = ''; editing.value = ''; error.value = ''; created.value = ''; nextTick(() => nameInput.value?.focus()) })
watch(() => props.visible, visible => { if (!visible) { deleting.value = ''; editing.value = '' } else { type.value = props.initialType; name.value = ''; created.value = ''; error.value = ''; nextTick(() => nameInput.value?.focus()) } })
async function manage(action, current = name.value) {
  if (saving.value || (action === 'create' && !name.value.trim())) return
  saving.value = true; error.value = ''; created.value = ''
  try { await electronService.manageClipboardGroup({ type: type.value, action, name: current, nextName: nextName.value }); emit('changed'); if (action === 'create') created.value = current.trim(); name.value = ''; editing.value = ''; deleting.value = '' }
  catch (e) { error.value = t(e.message?.includes('CLIPBOARD_GROUP_EXISTS') ? 'clipboard.groupExists' : 'clipboard.groupInvalid') }
  finally { saving.value = false; nextTick(() => nameInput.value?.focus()) }
}
</script>
<style scoped>
.group-tabs{display:flex;gap:6px;margin-bottom:14px}.group-tabs button{padding:7px 14px;border:0;border-radius:7px;background:transparent;color:var(--text-secondary);font:inherit;font-size:13px;cursor:pointer}.group-tabs button[aria-selected=true]{background:var(--bg-secondary);color:var(--text-primary)}.new-group{display:flex;flex:1;min-width:0;flex-direction:column;gap:8px;margin:0}.new-group>div{display:flex;align-items:center;gap:8px}.new-group label,.created-feedback{font-size:12px;color:var(--text-secondary)}.new-group input{width:0}.new-group button{flex-shrink:0}.new-group input,.group-row input{flex:1;min-width:0;border:1px solid var(--border-color);border-radius:7px;padding:9px 10px;color:var(--text-primary);background:var(--bg-secondary);font:inherit;font-size:13px}.group-row{display:flex;align-items:center;gap:7px;min-height:44px;border-bottom:1px solid var(--border-color);font-size:13px;color:var(--text-primary)}.group-row>span{flex:1;overflow-wrap:anywhere}.empty{padding:30px;text-align:center;color:var(--text-tertiary);font-size:13px}
</style>
