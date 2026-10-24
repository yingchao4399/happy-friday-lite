<template>
  <div class="asset-preview">
    <p class="asset-name">{{ name }}</p>
    <p v-if="loading" role="status">{{ t('clipboard.loading') }}</p>
    <FridayNotice v-else-if="error" error>{{ error }}</FridayNotice>
    <video v-else-if="asset?.kind === 'video'" :src="asset.url" controls preload="metadata" @error="mediaError" />
    <audio v-else-if="asset?.kind === 'audio'" :src="asset.url" controls preload="metadata" @error="mediaError" />
  </div>
</template>
<script setup>
import { onBeforeUnmount, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import FridayNotice from '@/components/ui/FridayNotice.vue'
import { electronService } from '@/services/electron'
const props = defineProps({ itemId: String, index: Number, name: String })
const emit = defineEmits(['code'])
const { t } = useI18n()
const asset = ref(null), loading = ref(false), error = ref('')
let request = 0
watch(() => [props.itemId, props.index], async () => {
  const current = ++request
  asset.value = null; error.value = ''; loading.value = true
  try {
    const result = await electronService.getClipboardAsset(props.itemId, props.index)
    if (current !== request) return
    asset.value = result
    if (result.kind === 'code') emit('code', result)
  } catch { if (current === request) error.value = t('clipboard.assetUnavailable') }
  finally { if (current === request) loading.value = false }
}, { immediate: true })
function mediaError() { error.value = t('clipboard.mediaUnsupported') }
onBeforeUnmount(() => { request++; asset.value = null })
</script>
<style scoped>
.asset-preview{margin:12px 0;color:var(--text-secondary);font-size:13px}.asset-name{overflow-wrap:anywhere;margin:0 0 8px}video{display:block;width:100%;max-height:46vh;border-radius:8px;background:#111}audio{width:100%}
</style>
