import { emit } from '../nocturne-core/lib/nocturne/bus.ts'

const PRINTABLE = /^[^\p{C}]$/u
const ECHO_WINDOW_MS = 600

function foregroundOf(cell) {
  if (!cell) return null
  if (cell.isFgRGB?.()) return `#${cell.getFgColor().toString(16).padStart(6, '0')}`
  return cell.isFgPalette?.() ? cell.getFgColor() : null
}

export function attachTypewriterTerminal(uid, terminal, { active = true } = {}) {
  const disposables = []
  let frameRequest = 0
  let expected = []
  let cursorShown = true
  let lastTypedAt = 0
  let bellArmed = true
  let published = ''

  const measure = () => {
    frameRequest = 0
    const screen = terminal.element?.querySelector('.xterm-screen')
    if (!screen || !terminal.cols || !terminal.rows) return
    const rect = screen.getBoundingClientRect()
    if (!rect.width || !rect.height) return
    const buffer = terminal.buffer.active
    const cellWidth = rect.width / terminal.cols
    const cellHeight = rect.height / terminal.rows
    const col = Math.min(buffer.cursorX, terminal.cols - 1)
    const row = buffer.cursorY
    const under = buffer.getLine(buffer.baseY + row)?.getCell(col)
    const frame = {
      uid,
      x: rect.left + col * cellWidth,
      y: rect.top + row * cellHeight,
      width: cellWidth,
      height: cellHeight,
      col,
      row,
      cols: terminal.cols,
      rows: terminal.rows,
      alternate: buffer.type === 'alternate',
      visible: buffer.viewportY === buffer.baseY,
      viewportY: buffer.viewportY,
      baseY: buffer.baseY,
      cursorHidden: !cursorShown,
      focused: document.activeElement === terminal.textarea,
      glyph: {
        char: under?.getChars?.() || ' ',
        width: Math.max(1, under?.getWidth?.() ?? 1),
        bold: !!under && under.isBold?.() !== 0,
        italic: !!under && under.isItalic?.() !== 0
      },
      grid: { left: rect.left, top: rect.top, width: rect.width, height: rect.height }
    }

    const now = Date.now()
    expected = expected.filter(item => {
      if (now - item.at > ECHO_WINDOW_MS) return false
      const line = buffer.getLine(buffer.baseY + item.row)
      while (item.chars.length) {
        const cell = line?.getCell(item.col)
        if (!cell || cell.getChars?.() !== item.chars[0]) break
        emit('strike', {
          uid,
          char: item.chars.shift(),
          col: item.col,
          line: buffer.baseY + item.row,
          cellWidth,
          width: cellWidth * Math.max(1, cell.getWidth?.() ?? 1),
          fg: foregroundOf(cell),
          bold: cell.isBold?.() !== 0
        })
        item.col += Math.max(1, cell.getWidth?.() ?? 1)
      }
      return item.chars.length > 0
    })

    const key = JSON.stringify(frame)
    if (active && key !== published) {
      published = key
      emit('cursor', frame)
    }
    const bellColumn = terminal.cols - 8
    if (col < bellColumn - 1) bellArmed = true
    else if (bellArmed && col >= bellColumn && now - lastTypedAt < 500) {
      bellArmed = false
      emit('marginBell', { uid })
    }
  }

  const schedule = () => {
    if (!frameRequest) frameRequest = requestAnimationFrame(measure)
  }
  const listen = disposable => disposable && disposables.push(() => disposable.dispose())

  listen(terminal.onCursorMove(schedule))
  listen(terminal.onRender(schedule))
  listen(terminal.onResize(schedule))
  listen(terminal.onScroll(schedule))
  listen(terminal.buffer.onBufferChange(schedule))
  listen(terminal.onKey(({ key, domEvent }) => {
    lastTypedAt = Date.now()
    if (!domEvent.isComposing && PRINTABLE.test(key)) {
      const buffer = terminal.buffer.active
      expected.push({ chars: [key], col: buffer.cursorX, row: buffer.cursorY, at: lastTypedAt })
    }
  }))
  listen(terminal.onSelectionChange(() => {
    emit('selection', { uid, cells: [] })
  }))

  const textarea = terminal.textarea
  if (textarea) {
    const onCompositionEnd = event => {
      const chars = Array.from(event.data || '').filter(char => PRINTABLE.test(char))
      if (!chars.length) return
      const buffer = terminal.buffer.active
      lastTypedAt = Date.now()
      expected.push({ chars, col: buffer.cursorX, row: buffer.cursorY, at: lastTypedAt })
    }
    textarea.addEventListener('compositionend', onCompositionEnd)
    disposables.push(() => textarea.removeEventListener('compositionend', onCompositionEnd))
    const onFocus = () => { published = ''; schedule() }
    textarea.addEventListener('focus', onFocus)
    textarea.addEventListener('blur', schedule)
    disposables.push(() => textarea.removeEventListener('focus', onFocus))
    disposables.push(() => textarea.removeEventListener('blur', schedule))
  }

  if (terminal.element) {
    const observer = new ResizeObserver(schedule)
    observer.observe(terminal.element)
    disposables.push(() => observer.disconnect())
  }
  schedule()

  return {
    refresh: schedule,
    dispose() {
      cancelAnimationFrame(frameRequest)
      disposables.splice(0).forEach(dispose => dispose())
    }
  }
}
