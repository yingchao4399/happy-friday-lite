<template>
  <div class="module-settings-page">
    <button class="back-btn" :aria-label="t('note.back')" @click="goBack">
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
        <polyline points="15 18 9 12 15 6"></polyline>
      </svg>
    </button>

    <h1 class="page-title">{{ t('settings.sidebarModulesTitle') }}</h1>
    <p class="page-desc">{{ t('settings.sidebarModulesDesc') }}</p>

    <div class="settings-content">
      <section class="behavior-panel module-order-panel">
        <div class="setting-row module-order-heading">
          <div class="setting-text">
            <h2 class="setting-label">{{ t('settings.moduleOrderTitle') }}</h2>
            <p class="setting-hint">{{ t('settings.moduleOrderHint') }}</p>
          </div>
          <FridayButton compact variant="text" :disabled="orderSaving" @click="persistOrder([])">
            <RotateCcw :size="14" />{{ t('settings.resetModuleOrder') }}
          </FridayButton>
        </div>
        <div
          v-for="(item, index) in orderedModules"
          :key="item.key"
          class="setting-row module-order-row"
          :class="{ dragging: draggedModule === item.key }"
          @dragover.prevent
          @drop.prevent="dropModule(item.key)"
        >
          <span
            class="drag-handle"
            :draggable="!orderSaving"
            aria-hidden="true"
            @dragstart="startModuleDrag($event, item.key)"
            @dragend="draggedModule = ''"
          ><GripVertical :size="16" /></span>
          <component :is="item.iconComponent" :size="17" :stroke-width="1.7" class="module-order-icon" />
          <span class="module-order-label">{{ t(item.i18nKey) }}</span>
          <label class="toggle-switch module-order-toggle" :title="t(`settings.${item.key}Module`)">
            <input
              type="checkbox"
              :checked="isEnabled(item.key)"
              :aria-label="t(`settings.${item.key}Module`)"
              @change="toggleModule(item.key, $event.target.checked)"
            />
            <span class="toggle-slider"></span>
          </label>
          <div class="module-order-actions">
            <FridayButton icon-only variant="text" :disabled="index === 0 || orderSaving" :aria-label="t('settings.moveModuleUp') + ' · ' + t(item.i18nKey)" :title="t('settings.moveModuleUp')" @click="moveModule(item.key, -1)"><ArrowUp :size="16" /></FridayButton>
            <FridayButton icon-only variant="text" :disabled="index === orderedModules.length - 1 || orderSaving" :aria-label="t('settings.moveModuleDown') + ' · ' + t(item.i18nKey)" :title="t('settings.moveModuleDown')" @click="moveModule(item.key, 1)"><ArrowDown :size="16" /></FridayButton>
          </div>
        </div>
        <p v-if="orderError" class="order-error" role="alert">{{ orderError }}</p>
      </section>

      <section class="preview-panel">
        <div class="preview-rail">
          <div class="preview-avatar">
            <img :src="avatarSrc" alt="" />
          </div>
          <div class="preview-menu">
            <button
              v-for="item in orderedModules"
              :key="item.key"
              type="button"
              class="preview-item"
              :class="[`preview-item-${item.key}`, { off: !isEnabled(item.key), highlight: highlightedKey === item.key }]"
              :aria-pressed="isEnabled(item.key)"
              :aria-label="t(`settings.${item.key}Module`)"
              :title="t(`settings.${item.key}Module`)"
              @click="toggleModule(item.key, !isEnabled(item.key))"
              @mouseenter="highlightedKey = item.key"
              @mouseleave="highlightedKey = ''"
            >
              <component :is="item.iconComponent" :size="18" :stroke-width="1.7" />
            </button>
          </div>
          <div class="preview-bottom">
            <button
              v-for="item in utilityItems"
              :key="item.key"
              type="button"
              class="preview-item"
              :class="[`preview-item-${item.key}`, { off: !isEnabled(item.key), highlight: highlightedKey === item.key }]"
              :aria-pressed="isEnabled(item.key)"
              :aria-label="t(`settings.${item.key}Module`)"
              :title="t(`settings.${item.key}Module`)"
              @click="toggleModule(item.key, !isEnabled(item.key))"
              @mouseenter="highlightedKey = item.key"
              @mouseleave="highlightedKey = ''"
            >
              <component :is="item.iconComponent" :size="18" :stroke-width="1.7" />
            </button>
            <div class="preview-item preview-item-settings locked" :title="t('settings.settingsAlwaysVisible')">
              <Settings :size="18" :stroke-width="1.7" />
            </div>
          </div>
        </div>

        <div class="preview-meta">
          <div class="preview-meta-top">
            <span class="preview-kicker">{{ t('settings.sidebarPreviewTitle') }}</span>
            <span class="preview-count">{{ t('settings.sidebarModulesHint', { count: enabledModuleCount, total: sidebarModuleCount }) }}</span>
          </div>
          <p class="preview-hint">{{ t('settings.sidebarPreviewHint') }}</p>
          <div class="preview-chips">
            <button
              v-for="item in utilityItems"
              :key="item.key"
              type="button"
              class="module-chip"
              :class="[`module-chip-${item.key}`, { off: !isEnabled(item.key), highlight: highlightedKey === item.key }]"
              :aria-pressed="isEnabled(item.key)"
              @click="toggleModule(item.key, !isEnabled(item.key))"
              @mouseenter="highlightedKey = item.key"
              @mouseleave="highlightedKey = ''"
            >
              <component :is="item.iconComponent" :size="14" :stroke-width="1.8" />
              <span>{{ t(`settings.${item.key}Module`) }}</span>
            </button>
          </div>
          <div class="preview-actions">
            <button v-if="hasHiddenModules" class="action-btn" type="button" @click="enableAll">
              {{ t('settings.enableAllModules') }}
            </button>
            <span v-else class="all-on-badge">
              <Check :size="14" :stroke-width="2.4" />
              {{ t('settings.allModulesEnabled') }}
            </span>
          </div>
        </div>
      </section>

      <section class="behavior-panel">
        <div class="setting-row">
          <div class="setting-text">
            <span class="setting-label">{{ t('settings.homePageSetting') }}</span>
            <span class="setting-hint">{{ t('settings.homePageSettingDesc') }}</span>
          </div>
          <div class="home-select-wrapper" ref="homeSelectRef">
            <button type="button" class="home-select-trigger" @click="showHomeDropdown = !showHomeDropdown">
              <span>{{ currentHomePageLabel }}</span>
              <svg class="select-arrow" :class="{ expanded: showHomeDropdown }" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <polyline points="6 9 12 15 18 9"></polyline>
              </svg>
            </button>
            <div v-if="showHomeDropdown" class="home-dropdown-menu">
              <button
                v-for="option in homeOptions"
                :key="option.value"
                type="button"
                class="home-dropdown-item"
                :class="{ active: homePage === option.value }"
                @click="selectHomePage(option.value)"
              >
                <span>{{ option.label }}</span>
                <Check v-if="homePage === option.value" :size="18" :stroke-width="2.5" stroke="#10b981" />
              </button>
            </div>
          </div>
        </div>
        <div class="setting-row">
          <div class="setting-text">
            <span class="setting-label">{{ t('settings.collapseSidebarOnLaunch') }}</span>
            <span class="setting-hint">{{ t('settings.collapseSidebarOnLaunchDesc') }}</span>
          </div>
          <label class="toggle-switch">
            <input type="checkbox" :checked="collapseOnLaunch" @change="toggleCollapseOnLaunch($event)" />
            <span class="toggle-slider"></span>
          </label>
        </div>
      </section>
    </div>
  </div>
</template>

<script setup>
import { computed, onMounted, onUnmounted, ref } from 'vue';
import { useRouter } from 'vue-router';
import { useI18n } from 'vue-i18n';
import { ArrowDown, ArrowUp, Check, GripVertical, RotateCcw, Settings } from 'lucide-vue-next';
import FridayButton from '@/components/ui/FridayButton.vue';
import { useAppStore } from '@/store';
import { fridayMenuConfig, sidebarMenuConfig, sidebarBottomMenuConfig, sidebarModuleConfig } from '@/config/menu';
import { electronService } from '@/services/electron';

const router = useRouter();
const appStore = useAppStore();
const { t } = useI18n();

const highlightedKey = ref('');
const avatarSrc = `${import.meta.env.BASE_URL}images/icon.png`;
const utilityItems = sidebarBottomMenuConfig.filter((item) => item.key !== 'settings');
const sidebarModuleCount = sidebarModuleConfig.length;

const enabledModuleCount = computed(() => sidebarModuleConfig.filter(item => appStore.sidebarModules[item.key] !== false).length);
const hasHiddenModules = computed(() => sidebarModuleConfig.some(item => appStore.sidebarModules[item.key] === false));
const isEnabled = (key) => appStore.sidebarModules[key] !== false;
const draggedModule = ref('');
const orderError = ref('');
const orderSaving = ref(false);
const orderedModules = computed(() => {
  const ids = [...new Set([...appStore.moduleOrder, ...sidebarMenuConfig.map(item => item.key)])];
  return ids.map(id => sidebarMenuConfig.find(item => item.key === id)).filter(Boolean);
});
const startModuleDrag = (event, id) => {
  draggedModule.value = id;
  event.dataTransfer.effectAllowed = 'move';
  event.dataTransfer.setData('text/plain', id);
};
const persistOrder = async ids => {
  if (orderSaving.value) return;
  orderSaving.value = true;
  const previous = [...appStore.moduleOrder];
  orderError.value = '';
  try {
    await electronService.request('module-order-save', { ids });
    appStore.setModuleOrder(ids);
  } catch (_error) { appStore.setModuleOrder(previous); orderError.value = t('settings.moduleOrderFailed'); }
  finally { orderSaving.value = false; }
};
const moveModule = (id, offset) => {
  const ids = orderedModules.value.map(item => item.key);
  const from = ids.indexOf(id); const to = from + offset;
  if (from < 0 || to < 0 || to >= ids.length) return;
  ids.splice(to, 0, ids.splice(from, 1)[0]);
  persistOrder(ids);
};
const dropModule = target => {
  const ids = orderedModules.value.map(item => item.key);
  const from = ids.indexOf(draggedModule.value); const to = ids.indexOf(target);
  draggedModule.value = '';
  if (from < 0 || to < 0 || from === to) return;
  ids.splice(to, 0, ids.splice(from, 1)[0]); persistOrder(ids);
};

// ========== 启动行为设置：首页 + 启动时收起侧边栏 ==========
const homeSelectRef = ref(null);
const showHomeDropdown = ref(false);
const homePage = ref('/friday');
const collapseOnLaunch = ref(false);

const homeOptions = computed(() =>
  [fridayMenuConfig, ...sidebarModuleConfig].map((item) => ({ value: item.path, label: t(item.i18nKey) }))
);
const currentHomePageLabel = computed(
  () => homeOptions.value.find((option) => option.value === homePage.value)?.label || t('friday.title')
);

const saveConfigPatch = async (patch) => {
  const config = await electronService.invoke('get-config');
  if (!config) throw new Error('Failed to load config');
  Object.assign(config, patch);
  const result = await electronService.invoke('save-config', config);
  if (result?.success === false) throw new Error(result.error || 'Failed to save configuration');
};

const selectHomePage = async (value) => {
  showHomeDropdown.value = false;
  if (value === homePage.value) return;
  const previous = homePage.value;
  homePage.value = value;
  try {
    await saveConfigPatch({ homePage: value });
  } catch (_error) {
    homePage.value = previous;
  }
};

const toggleCollapseOnLaunch = async (event) => {
  const next = event.target.checked;
  const previous = collapseOnLaunch.value;
  collapseOnLaunch.value = next;
  try {
    await saveConfigPatch({ collapseSidebarOnLaunch: next });
  } catch (_error) {
    collapseOnLaunch.value = previous;
    event.target.checked = previous;
  }
};

const handleHomeClickOutside = (event) => {
  if (homeSelectRef.value && !homeSelectRef.value.contains(event.target)) {
    showHomeDropdown.value = false;
  }
};

onMounted(async () => {
  document.addEventListener('click', handleHomeClickOutside);
  try {
    const config = await electronService.invoke('get-config');
    if (config) {
      if (typeof config.homePage === 'string' && config.homePage) homePage.value = config.homePage;
      collapseOnLaunch.value = config.collapseSidebarOnLaunch === true;
    }
  } catch (_error) {}
});

onUnmounted(() => {
  document.removeEventListener('click', handleHomeClickOutside);
});

const persistModules = async (nextModules, previousModules) => {
  appStore.setSidebarModules(nextModules);
  try {
    const config = await electronService.invoke('get-config');
    if (!config) return;
    config.sidebarModules = nextModules;
    const result = await electronService.invoke('save-config', config);
    if (result?.success === false) throw new Error(result.error || 'Failed to save configuration');
  } catch (_error) {
    appStore.setSidebarModules(previousModules);
  }
};

const toggleModule = (key, enabled) => {
  if (isEnabled(key) === enabled) return;
  const previousModules = { ...appStore.sidebarModules };
  persistModules({ ...previousModules, [key]: enabled }, previousModules);
};

const enableAll = () => {
  const previousModules = { ...appStore.sidebarModules };
  const nextModules = Object.keys(previousModules).reduce((modules, key) => ({ ...modules, [key]: true }), {});
  persistModules(nextModules, previousModules);
};

const goBack = () => router.push('/settings');
</script>

<style scoped>
.module-order-heading {
  padding: 9px 0;
}

.module-order-heading .setting-label,
.module-order-heading .setting-hint {
  margin: 0;
}

.module-order-row {
  justify-content: flex-start;
  gap: 9px;
  padding: 5px 0;
  transition: opacity 0.18s ease;
}

.module-order-row.dragging {
  opacity: 0.45;
}

.drag-handle {
  width: 18px;
  height: 28px;
  flex: 0 0 18px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  color: var(--text-tertiary);
  cursor: grab;
  user-select: none;
}

.drag-handle:active {
  cursor: grabbing;
}

.module-order-icon {
  flex-shrink: 0;
  color: var(--text-secondary);
}

.module-order-label {
  flex: 1;
  min-width: 0;
  color: var(--text-primary);
  font-size: 13px;
  line-height: 1.35;
  overflow-wrap: anywhere;
}

.module-order-toggle {
  margin-left: auto;
}

.module-order-actions {
  display: flex;
  flex: 0 0 auto;
  align-items: center;
  gap: 2px;
}

.order-error {
  margin: 0;
  padding: 8px 0;
  color: #d9544d;
  font-size: 12px;
}

.module-settings-page {
  width: 100%;
  display: flex;
  flex-direction: column;
  align-items: center;
  padding: 32px 40px 48px;
  position: relative;
}

:global([data-theme='dark'] .module-settings-page) {
  --text-tertiary: #9b9ba1;
}

.back-btn {
  position: absolute;
  top: 12px;
  left: 16px;
  background: none;
  border: none;
  cursor: pointer;
  padding: 6px;
  display: flex;
  align-items: center;
  justify-content: center;
  color: var(--text-primary);
  transition: background-color 0.15s;
  border-radius: 6px;
}

.back-btn:hover {
  background-color: var(--bg-hover);
}

.page-title {
  font-size: 24px;
  font-weight: 600;
  color: var(--text-primary);
  margin: 0 0 8px;
  max-width: 720px;
  width: 100%;
  text-align: left;
}

.page-desc {
  margin: 0 0 22px;
  max-width: 720px;
  width: 100%;
  color: var(--text-tertiary);
  font-size: 13px;
  line-height: 1.5;
}

.settings-content {
  display: flex;
  flex-direction: column;
  gap: 8px;
  max-width: 720px;
  width: 100%;
}

.preview-panel {
  display: flex;
  flex-direction: column;
  gap: 10px;
  padding: 16px;
  background: var(--bg-secondary);
  border-radius: 8px;
}

.behavior-panel {
  display: flex;
  flex-direction: column;
  padding: 6px 16px;
  background: var(--bg-secondary);
  border-radius: 8px;
}

.setting-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  padding: 12px 0;
}

.setting-row + .setting-row {
  border-top: 1px solid var(--border-color);
}

.setting-text {
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
}

.setting-label {
  color: var(--text-primary);
  font-size: 14px;
  font-weight: 500;
}

.setting-hint {
  color: var(--text-tertiary);
  font-size: 12px;
  line-height: 1.5;
}

.home-select-wrapper {
  position: relative;
  flex-shrink: 0;
}

.home-select-trigger {
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 140px;
  padding: 7px 12px;
  background: var(--bg-primary);
  border: 1px solid var(--border-color);
  border-radius: 8px;
  font: inherit;
  font-size: 13px;
  color: var(--text-primary);
  cursor: pointer;
  transition: background-color 0.15s;
}

.home-select-trigger:hover {
  background: var(--bg-hover);
}

.select-arrow {
  color: var(--text-tertiary);
  transition: transform 0.15s;
}

.select-arrow.expanded {
  transform: rotate(180deg);
}

.home-dropdown-menu {
  position: absolute;
  top: calc(100% + 4px);
  right: 0;
  z-index: 20;
  min-width: 180px;
  max-height: 280px;
  overflow-y: auto;
  background: var(--bg-primary);
  border: 1px solid var(--border-color);
  border-radius: 8px;
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.12);
  padding: 4px;
  display: flex;
  flex-direction: column;
}

.home-dropdown-item {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  padding: 7px 10px;
  background: none;
  border: none;
  border-radius: 6px;
  font: inherit;
  font-size: 13px;
  color: var(--text-primary);
  cursor: pointer;
  text-align: left;
  transition: background-color 0.15s;
}

.home-dropdown-item:hover {
  background: var(--bg-hover);
}

.home-dropdown-item.active {
  color: #10b981;
  font-weight: 500;
}

.toggle-switch {
  position: relative;
  display: inline-block;
  width: 44px;
  height: 24px;
  flex-shrink: 0;
}

.toggle-switch input {
  opacity: 0;
  width: 0;
  height: 0;
}

.toggle-slider {
  position: absolute;
  cursor: pointer;
  inset: 0;
  background-color: var(--text-tertiary);
  border-radius: 24px;
  transition: background-color 0.25s ease;
}

.toggle-slider::before {
  content: '';
  position: absolute;
  height: 18px;
  width: 18px;
  left: 3px;
  bottom: 3px;
  background-color: var(--bg-primary);
  border-radius: 50%;
  transition: transform 0.25s ease;
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.15);
}

.toggle-switch input:checked + .toggle-slider {
  background-color: #10b981;
}

.toggle-switch input:checked + .toggle-slider::before {
  transform: translateX(20px);
}

.toggle-switch input:focus-visible + .toggle-slider {
  outline: 2px solid var(--text-primary);
  outline-offset: 2px;
}

.preview-rail {
  width: 100%;
  display: flex;
  align-items: center;
  gap: 4px;
  overflow-x: auto;
  overflow-y: hidden;
  scrollbar-width: thin;
  padding: 6px 8px;
  background: var(--bg-primary);
  border: 1px solid var(--border-color);
  border-radius: 8px;
}

.preview-avatar {
  width: 26px;
  height: 26px;
  flex: 0 0 26px;
  margin-right: 6px;
  border-radius: 50%;
  overflow: hidden;
}

.preview-avatar img {
  width: 100%;
  height: 100%;
  object-fit: cover;
  display: block;
}

.preview-menu,
.preview-bottom {
  display: flex;
  align-items: center;
  flex: 0 0 auto;
  gap: 3px;
}

.preview-bottom {
  padding-left: 7px;
  border-left: 1px solid var(--border-color);
}

.preview-item {
  width: 32px;
  height: 32px;
  flex: 0 0 32px;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 0;
  border: none;
  background: transparent;
  border-radius: 9px;
  color: var(--text-primary);
  cursor: pointer;
  transition: background-color 0.15s, opacity 0.18s, color 0.15s;
}

.preview-item:hover,
.preview-item.highlight {
  background: var(--bg-hover);
}

.preview-item.off {
  opacity: 0.28;
}

.preview-item.off:hover,
.preview-item.off.highlight {
  opacity: 0.7;
}

.preview-item.locked {
  cursor: default;
  opacity: 0.9;
}

.preview-item-note,
.module-chip-note { color: #2563eb; }
.preview-item-knowledge,
.module-chip-knowledge { color: #0d9488; }
.preview-item-office,
.module-chip-office { color: #d83b01; }
.preview-item-schedule,
.module-chip-schedule { color: #d97706; }
.preview-item-automation,
.module-chip-automation { color: #4f46e5; }
.preview-item-harness,
.module-chip-harness { color: #7c3aed; }
.preview-item-history,
.module-chip-history { color: #b45309; }
.preview-item-settings { color: var(--text-secondary); }

.preview-meta {
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 7px;
}

.preview-meta-top {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 12px;
}

.preview-kicker {
  color: var(--text-primary);
  font-size: 14px;
  font-weight: 600;
}

.preview-count {
  color: var(--text-tertiary);
  font-size: 12px;
  white-space: nowrap;
}

.preview-hint {
  margin: 0;
  color: var(--text-tertiary);
  font-size: 12px;
  line-height: 1.5;
}

.preview-chips {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}

.module-chip {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  min-height: 30px;
  padding: 4px 10px;
  border: 1px solid transparent;
  border-radius: 8px;
  background: var(--bg-primary);
  font: inherit;
  font-size: 12px;
  font-weight: 500;
  color: var(--text-primary);
  cursor: pointer;
  transition: background-color 0.15s, opacity 0.18s, border-color 0.15s;
}

.module-chip:hover,
.module-chip.highlight {
  background: var(--bg-hover);
}

.module-chip.off {
  opacity: 0.45;
}

.module-chip.off:hover,
.module-chip.off.highlight {
  opacity: 0.8;
}

.preview-actions {
  display: flex;
  align-items: center;
  min-height: 28px;
}

.action-btn {
  background-color: var(--text-primary);
  color: var(--bg-primary);
  border: none;
  padding: 5px 14px;
  border-radius: 6px;
  font-size: 13px;
  cursor: pointer;
  font-weight: 500;
  font-family: inherit;
  transition: opacity 0.15s;
}

.action-btn:hover {
  opacity: 0.85;
}

.all-on-badge {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  color: #059669;
  font-size: 13px;
  font-weight: 500;
}

.back-btn:focus-visible,
.preview-item:focus-visible,
.module-chip:focus-visible,
.action-btn:focus-visible,
.home-select-trigger:focus-visible,
.home-dropdown-item:focus-visible,
.module-order-panel :deep(.friday-button:focus-visible) {
  outline: 2px solid var(--text-primary);
  outline-offset: 2px;
}

@media (max-width: 620px) {
  .module-settings-page {
    padding: 28px 20px 40px;
  }

  .page-title {
    font-size: 21px;
  }

  .preview-panel {
    gap: 10px;
    padding: 12px;
  }

  .preview-meta-top {
    flex-direction: column;
    align-items: flex-start;
    gap: 4px;
  }
}

@media (max-width: 420px) {
  .module-order-heading {
    align-items: flex-start;
    flex-direction: column;
    gap: 4px;
  }

  .module-order-heading :deep(.friday-button) {
    align-self: flex-end;
  }

  .module-order-row {
    gap: 6px;
  }
}
</style>
