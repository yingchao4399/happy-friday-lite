<template>
  <FridayDialog :visible="visible" :title="t('clipboard.qrTitle')" :close-label="t('clipboard.close')" @close="$emit('close')">
    <div class="qr-body">
      <div v-if="loading" class="qr-status" role="status"><LoaderCircle :size="24" class="spin" />{{ t('clipboard.' + (stage === 'collecting' ? 'qrCollecting' : stage === 'archiving' ? 'qrArchiving' : 'qrGenerating')) }}</div>
      <div v-else-if="error" class="qr-status error" role="alert"><QrCode :size="26" /><span>{{ error }}</span><FridayButton compact @click="generate">{{ t('clipboard.retry') }}</FridayButton></div>
      <div v-else-if="ended" class="qr-status" role="status"><QrCode :size="26" /><span>{{ t(ended === 'expired' ? 'clipboard.qrExpired' : 'clipboard.qrStopped') }}</span><FridayButton compact @click="generate">{{ t('clipboard.qrRegenerate') }}</FridayButton></div>
      <template v-else>
        <img class="qr-image" :src="qrDataUrl" :alt="t('clipboard.qrAlt')" />
        <p class="qr-hint">{{ shareUrl ? t('clipboard.qrNetworkHint') : t('clipboard.qrTextHint') }}</p>
        <FridaySelect v-if="addresses.length > 1" :model-value="shareUrl" :options="addresses" :label="t('clipboard.qrNetwork')" @update:model-value="changeAddress" />
        <FridayNotice v-if="localOnly">{{ t('clipboard.qrLocalOnly') }}</FridayNotice>
        <p v-if="folderCount" class="qr-hint">{{ t('clipboard.qrFolderZip', { count: folderCount }) }}</p>
        <p v-if="shareUrl" class="qr-url">{{ shareUrl }}</p>
        <p v-if="expiresAt" class="qr-expiry">{{ t('clipboard.qrExpiry', { time: new Date(expiresAt).toLocaleTimeString() }) }}</p>
        <FridayNotice v-if="actionError" error>{{ actionError }}</FridayNotice>
      </template>
    </div>
    <template #footer><FridayButton v-if="token && !ended && !loading" :disabled="revoking" @click="stopSharing">{{ t('clipboard.qrStop') }}</FridayButton><FridayButton @click="$emit('close')">{{ t('clipboard.close') }}</FridayButton></template>
  </FridayDialog>
</template>
<script setup>
import { onMounted, onUnmounted, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import QRCode from 'qrcode'
import { LoaderCircle, QrCode } from 'lucide-vue-next'
import FridayButton from '@/components/ui/FridayButton.vue'
import FridayDialog from '@/components/ui/FridayDialog.vue'
import FridaySelect from '@/components/ui/FridaySelect.vue'
import FridayNotice from '@/components/ui/FridayNotice.vue'
import { electronService } from '@/services/electron'
const props = defineProps({ visible: Boolean, item: Object })
defineEmits(['close'])
const { t } = useI18n()
const loading = ref(false), error = ref(''), qrDataUrl = ref(''), shareUrl = ref(''), expiresAt = ref('')
const token = ref(''), addresses = ref([]), folderCount = ref(0), localOnly = ref(false), ended = ref(''), revoking = ref(false), actionError = ref(''), stage = ref('')
let generation = 0, qrRevision = 0, expiryTimer, unlisten
watch(() => [props.visible, props.item?.id], ([visible]) => { if (visible) generate(); else { generation++; clearTimeout(expiryTimer); loading.value = false } })
onMounted(() => { unlisten = electronService.listen('clipboard-share-progress', ({ payload }) => { if (props.visible && loading.value && payload.id === props.item?.id) stage.value = payload.stage }) })
onUnmounted(() => { generation++; clearTimeout(expiryTimer); unlisten?.() })
async function changeAddress(value) {
  if (!addresses.value.some(entry => entry.value === value)) return
  const request = ++qrRevision
  shareUrl.value = value
  try {
    const result = await QRCode.toDataURL(value, { errorCorrectionLevel: 'M', margin: 2, width: 320, color: { dark: '#18181b', light: '#ffffff' } })
    if (request === qrRevision && !ended.value) qrDataUrl.value = result
  } catch { actionError.value = t('clipboard.qrFailed') }
}
async function stopSharing() {
  const request = generation
  revoking.value = true; actionError.value = ''
  try { await electronService.revokeClipboardShare(token.value); if (request === generation) { ended.value = 'stopped'; error.value = ''; qrDataUrl.value = ''; clearTimeout(expiryTimer); qrRevision++ } }
  catch { if (request === generation) actionError.value = t('clipboard.qrStopFailed') }
  finally { if (request === generation) revoking.value = false }
}
async function generate() {
  if (!props.item || props.item.sensitivity === 'secret') return
  const request = ++generation
  clearTimeout(expiryTimer); qrRevision++
  loading.value = true; error.value = ''; qrDataUrl.value = ''; shareUrl.value = ''; expiresAt.value = ''
  ended.value = ''; actionError.value = ''; stage.value = ''; addresses.value = []; folderCount.value = 0; localOnly.value = false; revoking.value = false
  try {
    if (token.value) { await electronService.revokeClipboardShare(token.value); token.value = '' }
    if (request !== generation) return
    let value = ''
    const item = props.item
    const hasBinary = Boolean(item.imagePath || /<img\b/i.test(item.html || '') || item.filePaths?.length || item.kind === 'mixed' || item.parts?.some(part => part.imagePath || part.filePaths?.length || /<img\b/i.test(part.html || '')))
    if (!hasBinary && item.plainText && new TextEncoder().encode(item.plainText).length <= 1800) value = item.plainText
    else {
      const share = await electronService.createClipboardShare(item.id)
      if (request !== generation) { await electronService.revokeClipboardShare(share.token); return }
      token.value = share.token; addresses.value = (share.urls || [{ url: share.url, label: share.url }]).map(entry => ({ label: entry.label, value: entry.url })); folderCount.value = share.folderCount || 0; localOnly.value = share.localOnly
      shareUrl.value = share.url; expiresAt.value = share.expiresAt; value = share.url
      expiryTimer = setTimeout(() => { ended.value = 'expired'; qrDataUrl.value = ''; qrRevision++ }, Math.max(0, Date.parse(share.expiresAt) - Date.now()))
    }
    const result = await QRCode.toDataURL(value, { errorCorrectionLevel: 'M', margin: 2, width: 320, color: { dark: '#18181b', light: '#ffffff' } })
    if (request === generation) qrDataUrl.value = result
  } catch (e) {
    if (request !== generation) return
    const code = ['FOLDER_TOO_LARGE', 'FOLDER_TIMEOUT', 'LINK_UNSUPPORTED', 'FILE_MISSING', 'FILE_UNAVAILABLE', 'SOURCE_CHANGED', 'TOO_MANY_FILES'].find(code => e.message?.includes('CLIPBOARD_SHARE_' + code))
    const imageCode = ['LOAD_FAILED', 'MISSING', 'TOO_LARGE', 'INVALID', 'UNAVAILABLE'].find(code => e.message?.includes('CLIPBOARD_IMAGE_' + code))
    error.value = code ? t('clipboard.qrErrors.' + code) : imageCode ? t('clipboard.' + ({ LOAD_FAILED: 'externalImageFailed', MISSING: 'imageMissing', TOO_LARGE: 'imageTooLarge', INVALID: 'imageInvalid', UNAVAILABLE: 'imageUnavailable' }[imageCode])) : e.message?.includes('CLIPBOARD_SHARE_UNAVAILABLE') ? t('clipboard.qrShareUnavailable') : t('clipboard.qrFailed')
  } finally { if (request === generation) loading.value = false }
}
</script>
<style scoped>
.qr-body{display:flex;flex-direction:column;align-items:center;gap:12px;min-height:350px;padding:6px}.qr-image{display:block;width:min(320px,80vw);height:auto;border-radius:8px;background:#fff;padding:10px;image-rendering:pixelated}.qr-hint{margin:0;text-align:center;color:var(--text-secondary);font-size:13px;line-height:1.6}.qr-url{max-width:100%;margin:0;color:var(--text-tertiary);font-size:11px;line-height:1.4;overflow-wrap:anywhere;text-align:center}.qr-expiry{margin:0;color:var(--text-tertiary);font-size:11px}.qr-status{display:flex;flex:1;min-height:260px;align-items:center;justify-content:center;flex-direction:column;gap:10px;color:var(--text-secondary);font-size:13px}.qr-status.error{color:#d9544d;text-align:center}.spin{animation:spin .7s linear infinite}@keyframes spin{to{transform:rotate(360deg)}}
</style>
