// Nocturne/Hyper 的 light* 色位与 xterm 的 bright* 色位必须显式转换。
// 保留纸张 RGB、只将 alpha 设为 0：纸纹保持可见，xterm 的对比度校正
// 以真实纸色为依据，覆盖 ANSI、真彩色和淡色；不改写 PTY 字节流。
import {withAlpha} from '../nocturne-core/app/nocturne/color.ts'
export function terminalTheme(paper) {
  const theme = {background: withAlpha(paper.paper, 0), foreground: paper.ink}
  for (const name of ['Black', 'Red', 'Green', 'Yellow', 'Blue', 'Magenta', 'Cyan', 'White']) {
    theme[name.toLowerCase()] = paper.ansi[name.toLowerCase()]
    theme[`bright${name}`] = paper.ansi[`light${name}`]
  }
  return theme
}
