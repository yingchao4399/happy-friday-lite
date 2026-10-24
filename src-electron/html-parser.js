import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
// 保留同步 HTML 清洗协议，首次处理富文本时才加载解析器。
export function loadHtml(...args) { return require('cheerio').load(...args) }
