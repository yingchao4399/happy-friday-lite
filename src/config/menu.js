import {
  Bot
} from 'lucide-vue-next'
import OfficeIcon from '@/components/icons/OfficeIcon.vue'
import CalendarIcon from '@/components/icons/CalendarIcon.vue'
import KnowledgeIcon from '@/components/icons/KnowledgeIcon.vue'
import NoteIcon from '@/components/icons/NoteIcon.vue'
import DrawingIcon from '@/components/icons/DrawingIcon.vue'
import HarnessIcon from '@/components/icons/HarnessIcon.vue'
import AutomationIcon from '@/components/icons/AutomationIcon.vue'
import HistoryIcon from '@/components/icons/HistoryIcon.vue'
import SettingsIcon from '@/components/icons/SettingsIcon.vue'
import TypewriterIcon from '@/components/icons/TypewriterIcon.vue'
import { Clipboard, Headphones, Trash2 } from 'lucide-vue-next'

export const sidebarMenuConfig = [
  { key: 'typewriter', path: '/typewriter', icon: 'TypewriterIcon', iconComponent: TypewriterIcon, i18nKey: 'typewriter.title' },
  { key: 'note', path: '/note', icon: 'NoteIcon', iconComponent: NoteIcon, i18nKey: 'note.title' },
  { key: 'drawing', path: '/drawing', icon: 'DrawingIcon', iconComponent: DrawingIcon, i18nKey: 'drawing.title' },
  { key: 'knowledge', path: '/knowledge', icon: 'KnowledgeIcon', iconComponent: KnowledgeIcon, i18nKey: 'knowledge.title' },
  { key: 'office', path: '/office', icon: 'OfficeIcon', iconComponent: OfficeIcon, i18nKey: 'office.title' },
  { key: 'schedule', path: '/schedule', icon: 'CalendarIcon', iconComponent: CalendarIcon, i18nKey: 'schedule.title' },
  { key: 'automation', path: '/automation', icon: 'AutomationIcon', iconComponent: AutomationIcon, i18nKey: 'automation.title' },
  { key: 'harness', path: '/harness', icon: 'HarnessIcon', iconComponent: HarnessIcon, i18nKey: 'harness.title' },
  { key: 'recitation', path: '/recitation', icon: 'Headphones', iconComponent: Headphones, i18nKey: 'recitation.title' },
  { key: 'clipboard', path: '/clipboard', icon: 'Clipboard', iconComponent: Clipboard, i18nKey: 'clipboard.title' }
]

export const sidebarBottomMenuConfig = [
  { key: 'trash', path: '/trash', icon: 'Trash2', iconComponent: Trash2, i18nKey: 'trash.title' },
  { key: 'history', path: '/history', icon: 'HistoryIcon', iconComponent: HistoryIcon, i18nKey: 'history.title' },
  { key: 'settings', path: '/settings', icon: 'SettingsIcon', iconComponent: SettingsIcon, i18nKey: 'settings.title' }
]

// Settings stays available so a hidden module can always be restored.
export const sidebarModuleConfig = [
  ...sidebarMenuConfig,
  ...sidebarBottomMenuConfig.filter((item) => item.key !== 'settings')
]

export const fridayMenuConfig = {
  key: 'friday',
  path: '/friday',
  icon: 'Bot',
  iconComponent: Bot,
  i18nKey: 'friday.title'
}

export const allMenuConfigs = [
  ...sidebarMenuConfig,
  ...sidebarBottomMenuConfig,
  fridayMenuConfig
]

export const isElectronEnvironment = () => {
  return !!window.electronAPI
}
