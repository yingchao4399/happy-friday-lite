import { reactive } from 'vue'

// Keep the shell's plugin notice reactive state separate from the plugin
// runtime. App.vue can render notices without pulling plugin discovery,
// editor bridges, and note persistence into the initial bundle.
export const pluginState = reactive({ records: [], busy: '', error: '', notice: '' })
