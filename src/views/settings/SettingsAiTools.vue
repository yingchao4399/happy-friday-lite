<template>
  <div ref="page" class="file-open-settings-page">
    <SettingsBackButton />
    <h1 class="page-title">{{ t('settings.aiToolsServices') }}</h1>
    <div class="settings-content"><OfficeAiServicesSettings /></div>
  </div>
</template>

<script setup>
import { useI18n } from 'vue-i18n'
import { onActivated, onMounted, ref } from 'vue'
import OfficeAiServicesSettings from '@/components/office/OfficeAiServicesSettings.vue'
import SettingsBackButton from '@/components/settings/SettingsBackButton.vue'
const { t } = useI18n()
const page = ref(null)
// 设置首页和二级页共用滚动容器；进入长页面时让标题与返回按钮保持在顶部。
const revealPageStart = () => page.value?.scrollIntoView({ block: 'start', inline: 'nearest', behavior: 'instant' })
onMounted(revealPageStart)
onActivated(revealPageStart)
</script>

<style scoped src="./settings-subpage.css"></style>
