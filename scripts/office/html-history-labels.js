import zhOffice from '../../src/i18n/locales/zh-CN/office.json' with { type: 'json' }
import enOffice from '../../src/i18n/locales/en-US/office.json' with { type: 'json' }

export const htmlHistoryLabels = lang => (String(lang).startsWith('zh') ? zhOffice : enOffice).htmlHistory
