<template>
  <div class="secret-entry">
    <pre class="secret-text">{{ revealed ? content : item.maskedPreview || '••••••••' }}</pre>
    <FridayButton compact :disabled="loading" :aria-pressed="revealed" @click.stop="toggle"><EyeOff v-if="revealed" :size="14" /><Eye v-else :size="14" />{{ t(revealed ? 'clipboard.hideSecret' : 'clipboard.showSecret') }}</FridayButton>
    <p v-if="error" role="alert">{{ error }}</p>
  </div>
</template>
<script setup>
import { onDeactivated, onMounted, onUnmounted, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { Eye, EyeOff } from 'lucide-vue-next'
import FridayButton from '@/components/ui/FridayButton.vue'
import { electronService } from '@/services/electron'
const props = defineProps({ item: Object })
const { t } = useI18n()
const revealed = ref(false), content = ref(''), loading = ref(false), error = ref('')
let request = 0, expiry
function hide() { request++; clearTimeout(expiry); revealed.value = false; content.value = ''; loading.value = false }
async function toggle() {
  if (revealed.value) { hide(); return }
  const current = ++request
  loading.value = true; error.value = ''
  try {
    const result = await electronService.revealClipboardSecret(props.item.id)
    if (current !== request) return
    content.value = result.plainText + (result.note ? '\n\n' + t('clipboard.memo') + ': ' + result.note : ''); revealed.value = true
    expiry = setTimeout(hide, Math.min(60000, Math.max(0, Date.parse(result.expiresAt) - Date.now())))
  } catch { if (current === request) error.value = t('clipboard.secretUnavailable') }
  finally { if (current === request) loading.value = false }
}
function visibility() { if (document.hidden) hide() }
watch(() => [props.item.id, props.item.expiresAt, props.item.deletedAt], hide)
onMounted(() => { window.addEventListener('blur', hide); document.addEventListener('visibilitychange', visibility) })
onDeactivated(hide)
onUnmounted(() => { hide(); window.removeEventListener('blur', hide); document.removeEventListener('visibilitychange', visibility) })
</script>
<style scoped>
.secret-entry{display:flex;align-items:flex-start;gap:10px;flex-wrap:wrap}.secret-text{margin:0;white-space:pre-wrap;overflow-wrap:anywhere;max-height:240px;overflow:auto;min-width:0;flex:1;font:inherit;font-size:13px;line-height:1.6}.secret-entry p{width:100%;color:#d9544d;font-size:12px;margin:0}
</style>
