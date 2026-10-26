import React, {useEffect, useRef, useState} from 'react';
import {activePaper, drawnCursorOn, inkSelectionOn} from '../nocturne-core/app/nocturne/apply-config';
import {fontStack} from '../nocturne-core/app/nocturne/settings';
import {emit} from '../nocturne-core/lib/nocturne/bus';
import {useNocturneSettings} from '../nocturne-core/lib/nocturne/store';
import {activateContent} from '../content-plugin';
import {i18n} from '@/i18n';

export function NoteSurface({document: source, onChange}: {document: any; onChange: (text: string) => void}) {
  const settings = useNocturneSettings();
  const [value, setValue] = useState(source.content);
  const input = useRef<HTMLTextAreaElement>(null);
  const mirror = useRef<HTMLDivElement>(null);
  const current = useRef(value);
  const schedule = useRef<() => void>(() => {});
  const inserted = useRef<{at: number; text: string} | null>(null);
  const paper = activePaper(settings);
  const type = settings.typography;
  const style = {fontFamily: fontStack(type), fontSize: type.fontSize, fontWeight: type.fontWeight,
    lineHeight: `${type.fontSize * type.lineHeight}px`, letterSpacing: type.letterSpacing,
    color: paper.ink, tabSize: 4} as React.CSSProperties;
  useEffect(() => {
    const el = input.current!, ghost = mirror.current!;
    let frame = 0, bell = true;
    const publish = () => {
      frame = 0;
      const rect = el.getBoundingClientRect();
      if (!rect.width || !rect.height) return;
      ghost.textContent = current.current + '\u200b';
      ghost.style.width = `${el.clientWidth}px`;
      ghost.style.transform = `translate(${-el.scrollLeft}px, ${-el.scrollTop}px)`;
      const text = ghost.firstChild!;
      const lineHeight = parseFloat(getComputedStyle(el).lineHeight);
      const probe = document.createElement('span');
      probe.textContent = 'M'; ghost.appendChild(probe);
      const cellWidth = probe.getBoundingClientRect().width;
      probe.remove();
      const position = (index: number) => {
        const range = document.createRange();
        range.setStart(text, Math.min(index, current.current.length));
        range.setEnd(text, Math.min(index + 1, current.current.length + 1));
        const box = range.getBoundingClientRect();
        return {x: box.x, y: box.y, col: Math.max(0, Math.round((box.x - rect.x + el.scrollLeft) / cellWidth)),
          line: Math.max(0, Math.round((box.y - ghost.getBoundingClientRect().y) / lineHeight))};
      };
      const caret = position(el.selectionDirection === 'backward' ? el.selectionStart : el.selectionEnd);
      const viewportY = el.scrollTop / lineHeight;
      const rows = Math.max(1, Math.floor(rect.height / lineHeight));
      const cols = Math.max(1, Math.floor(el.clientWidth / cellWidth));
      emit('cursor', {uid: source.id, x: caret.x, y: caret.y, width: cellWidth, height: lineHeight,
        col: caret.col, row: caret.line - viewportY, cols, rows, alternate: false,
        visible: caret.y >= rect.top - 1 && caret.y < rect.bottom, viewportY,
        baseY: Math.max(0, (el.scrollHeight - el.clientHeight) / lineHeight),
        cursorHidden: false, focused: document.activeElement === el,
        glyph: {char: Array.from(current.current.slice(el.selectionEnd))[0] || ' ', width: 1, bold: false, italic: false},
        grid: {left: rect.x, top: rect.y, width: rect.width, height: rect.height}});
      if (inserted.current) {
        const {at, text: typed} = inserted.current;
        let offset = at;
        for (const char of Array.from(typed).slice(0, 64)) {
          const p = position(offset);
          if (char.trim()) emit('strike', {uid: source.id, char, col: p.col, line: p.line, cellWidth,
            width: /[^\x00-\xff]/.test(char) ? 2 : 1, fg: null, bold: false});
          offset += char.length;
        }
        inserted.current = null;
        if (caret.col >= cols - 7 && bell) { emit('marginBell', {uid: source.id}); bell = false; }
      }
      if (caret.col < cols - 10) bell = true;
      const cells = [];
      for (let n = el.selectionStart; n < el.selectionEnd && cells.length < 4000;) {
        const char = Array.from(current.current.slice(n, n + 2))[0];
        const p = position(n);
        if (char.trim()) cells.push({line: p.line, col: p.col, char, width: /[^\x00-\xff]/.test(char) ? 2 : 1, fg: null, bold: false});
        n += char.length;
      }
      emit('selection', {uid: source.id, cells});
    };
    const request = () => { if (!frame) frame = requestAnimationFrame(publish); };
    schedule.current = request;
    const observer = new ResizeObserver(request); observer.observe(el);
    const deactivate = activateContent({focus: () => el.focus(),
      text: (kind: string) => kind === 'selection' ? current.current.slice(el.selectionStart, el.selectionEnd) : current.current,
      scroll: (to: string | number) => { el.scrollTop = to === 'top' ? 0 : to === 'bottom' ? el.scrollHeight : Number(to) * parseFloat(getComputedStyle(el).lineHeight); request(); },
      flush: () => source.flush()});
    document.addEventListener('selectionchange', request);
    el.focus(); request();
    return () => { cancelAnimationFrame(frame); observer.disconnect(); deactivate();
      document.removeEventListener('selectionchange', request); };
  }, [source.id]);
  useEffect(() => { schedule.current(); }, [settings, value]);
  function change(event: React.ChangeEvent<HTMLTextAreaElement>) {
    const next = event.target.value;
    let at = 0;
    while (at < next.length && next[at] === current.current[at]) at++;
    let oldEnd = current.current.length, newEnd = next.length;
    while (oldEnd > at && newEnd > at && current.current[oldEnd - 1] === next[newEnd - 1]) {oldEnd--; newEnd--;}
    if (newEnd > at && !(event.nativeEvent as InputEvent)?.isComposing) inserted.current = {at, text: next.slice(at, newEnd)};
    current.current = next; setValue(next); onChange(next);
  }
  return <div className={`tn-note-plugin ${inkSelectionOn(settings) ? 'tn-note-ink' : ''}`} data-plugin="note" style={style}>
    <div ref={mirror} className="tn-note-mirror" aria-hidden="true" />
    <textarea ref={input} className="tn-note-input" value={value} wrap="soft" spellCheck={false}
      aria-label={i18n.global.t('typewriter.noteInput')} onChange={change}
      onScroll={() => schedule.current()} onSelect={() => schedule.current()}
      onCompositionEnd={event => { const text = event.data || ''; if (text) inserted.current = {at: Math.max(0, input.current!.selectionEnd - text.length), text}; schedule.current(); }}
      onFocus={() => schedule.current()} onBlur={() => { schedule.current(); void source.flush().catch(() => {}); }}
      style={{...style, caretColor: drawnCursorOn(settings) ? 'transparent' : paper.cursor}}
      onKeyDown={event => {
        if (event.key === 'Tab') { event.preventDefault(); const el = input.current!;
          el.setRangeText('  ', el.selectionStart, el.selectionEnd, 'end');
          change({target: el} as React.ChangeEvent<HTMLTextAreaElement>); }
        if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 's') {
          event.preventDefault(); void source.flush().catch(() => {});
        }
      }} />
  </div>;
}
