import React, {useEffect, useRef} from 'react';
import {activePaper, drawnCursorOn, inkSelectionOn} from '../nocturne-core/app/nocturne/apply-config';
import {fontStack} from '../nocturne-core/app/nocturne/settings';
import {emit} from '../nocturne-core/lib/nocturne/bus';
import {useNocturneSettings} from '../nocturne-core/lib/nocturne/store';
import {activateContent} from '../content-plugin';
import {activateEditor} from '@/features/commands/editor-context';
import {createWikiPopup} from '@/features/notes/wiki-suggest';
import {noteLinkAt} from '@/features/notes/link-target';
import {consumeNoteLocation} from '@/features/notes/location';
import {i18n} from '@/i18n';

export function NoteSurface({document: source, onChange}: {document: any; onChange: (text: string) => void}) {
  const settings = useNocturneSettings();
  const initialValue = source.content;
  const input = useRef<HTMLTextAreaElement>(null);
  const mirror = useRef<HTMLDivElement>(null);
  const current = useRef(initialValue);
  const schedule = useRef<() => void>(() => {});
  const inserted = useRef<{at: number; text: string} | null>(null);
  const mirrorDirty = useRef(false);
  const mirrorIdleTimer = useRef<number | null>(null);
  // Chromium recalculates every visual line for soft-wrapped very long
  // textareas. Start long notes in the cheap mode and restore soft wrapping
  // after the editor has been idle.
  const fastWrap = useRef(initialValue.length > 20000);
  const paper = activePaper(settings);
  const type = settings.typography;
  const style = {fontFamily: fontStack(type), fontSize: type.fontSize, fontWeight: type.fontWeight,
    lineHeight: `${type.fontSize * type.lineHeight}px`, letterSpacing: type.letterSpacing,
    color: paper.ink, tabSize: 4} as React.CSSProperties;
  useEffect(() => {
    const el = input.current!, ghost = mirror.current!;
    if (fastWrap.current) el.wrap = 'off';
    let frame = 0, bell = true;
    // 长文只更新镜像中发生变化的字符，避免每次按键重排整篇正文。
    let mirroredValue: string | null = null;
    let metricsDirty = true;
    let metrics: { lineHeight: number; cellWidth: number } | null = null;
    let lastSelectionKey = '';
    const invalidateMetrics = () => { metricsDirty = true; };
    const publish = () => {
      frame = 0;
      const rect = el.getBoundingClientRect();
      if (!rect.width || !rect.height) return;
      const longDocument = current.current.length > 20000;
      if (!metrics || metricsDirty) {
        const lineHeight = parseFloat(getComputedStyle(el).lineHeight) || 16;
        const probe = document.createElement('canvas').getContext('2d');
        if (probe) probe.font = getComputedStyle(el).font;
        const cellWidth = probe?.measureText('M').width || 8;
        metrics = {lineHeight, cellWidth};
        metricsDirty = false;
      }
      const { lineHeight, cellWidth } = metrics;
      const viewportY = el.scrollTop / lineHeight;
      const rows = Math.max(1, Math.floor(rect.height / lineHeight));
      const cols = Math.max(1, Math.floor(el.clientWidth / cellWidth));
      // 大文档输入路径：避免同步修改完整镜像和 Range 布局测量。
      // 空闲定时器会触发一次完整镜像同步，保持光标和选区最终精确。
      if (longDocument && mirrorDirty.current) {
        if (ghost.style.display !== 'none') ghost.style.display = 'none';
        const index = el.selectionDirection === 'backward' ? el.selectionStart : el.selectionEnd;
        const before = current.current.slice(0, index);
        const lineStart = before.lastIndexOf('\n') + 1;
        const line = (before.match(/\n/g) || []).length;
        const rawCol = Array.from(before.slice(lineStart)).reduce((value, char) => value + (/[^\x00-\xff]/.test(char) ? 2 : 1), 0);
        const visualRow = line + Math.floor(rawCol / cols);
        const visualCol = rawCol % cols;
        const cursor = {x: rect.x + visualCol * cellWidth, y: rect.top + (visualRow - viewportY) * lineHeight, col: visualCol, line: visualRow};
        emit('cursor', {uid: source.id, x: cursor.x, y: cursor.y, width: cellWidth, height: lineHeight,
          col: cursor.col, row: cursor.line - viewportY, cols, rows, alternate: false,
          visible: cursor.y >= rect.top - 1 && cursor.y < rect.bottom, viewportY,
          baseY: Math.max(0, (el.scrollHeight - el.clientHeight) / lineHeight), cursorHidden: false,
          focused: document.activeElement === el, glyph: {char: Array.from(current.current.slice(index))[0] || ' ', width: 1, bold: false, italic: false},
          grid: {left: rect.x, top: rect.y, width: rect.width, height: rect.height}});
        inserted.current = null;
        emit('selection', {uid: source.id, cells: []});
        return;
      }
      if (ghost.style.display === 'none') ghost.style.display = '';
      if (mirroredValue !== current.current) {
        const nextMirrorText = current.current + '\u200b';
        if (ghost.firstChild?.nodeType === Node.TEXT_NODE) {
          const previous = (mirroredValue || '') + '\u200b';
          let start = 0;
          while (start < previous.length && start < nextMirrorText.length && previous[start] === nextMirrorText[start]) start++;
          let oldEnd = previous.length, newEnd = nextMirrorText.length;
          while (oldEnd > start && newEnd > start && previous[oldEnd - 1] === nextMirrorText[newEnd - 1]) { oldEnd--; newEnd--; }
          (ghost.firstChild as Text).replaceData(start, oldEnd - start, nextMirrorText.slice(start, newEnd));
        } else {
          ghost.textContent = nextMirrorText;
        }
        mirroredValue = current.current;
        lastSelectionKey = '';
      }
      const width = `${el.clientWidth}px`;
      if (ghost.style.width !== width) ghost.style.width = width;
      const transform = `translate(${-el.scrollLeft}px, ${-el.scrollTop}px)`;
      if (ghost.style.transform !== transform) ghost.style.transform = transform;
      const text = ghost.firstChild!;
      const ghostRect = ghost.getBoundingClientRect();
      const position = (index: number) => {
        const range = document.createRange();
        range.setStart(text, Math.min(index, current.current.length));
        range.setEnd(text, Math.min(index + 1, current.current.length + 1));
        const box = range.getBoundingClientRect();
        return {x: box.x, y: box.y, col: Math.max(0, Math.round((box.x - rect.x + el.scrollLeft) / cellWidth)),
          line: Math.max(0, Math.round((box.y - ghostRect.y) / lineHeight))};
      };
      const caret = position(el.selectionDirection === 'backward' ? el.selectionStart : el.selectionEnd);
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
      // 滚动不改变选区内容，无需重复创建选区的 Range。
      const selectionKey = `${el.selectionStart}:${el.selectionEnd}:${current.current.length}`;
      const cells = [];
      const selectionChanged = selectionKey !== lastSelectionKey;
      if (selectionChanged) {
        lastSelectionKey = selectionKey;
        for (let n = el.selectionStart; n < el.selectionEnd && cells.length < 4000;) {
          const char = Array.from(current.current.slice(n, n + 2))[0];
          if (!char) break;
          const p = position(n);
          if (char.trim()) cells.push({line: p.line, col: p.col, char, width: /[^\x00-\xff]/.test(char) ? 2 : 1, fg: null, bold: false});
          n += char.length;
        }
      }
      if (selectionChanged) emit('selection', {uid: source.id, cells});
    };
    const request = () => { if (!frame) frame = requestAnimationFrame(publish); };
    schedule.current = request;
    const observer = new ResizeObserver(() => { invalidateMetrics(); request(); }); observer.observe(el);
    const deactivateEditor=activateEditor({kind:'typewriter',noteId:()=>source.id,getValue:()=>current.current,getSelection:()=>({from:el.selectionStart,to:el.selectionEnd}),replaceSelection:(text:string)=>{el.setRangeText(text,el.selectionStart,el.selectionEnd,'end');current.current=el.value;onChange(el.value);schedule.current();},focus:()=>el.focus()});
    const deactivate = activateContent({focus: () => el.focus(), blur: () => el.blur(),
      text: (kind: string) => kind === 'selection' ? current.current.slice(el.selectionStart, el.selectionEnd) : current.current,
      insert: (text: string) => {
        const at = el.selectionStart, end = el.selectionEnd;
        el.setRangeText(String(text || ''), at, end, 'end');
        current.current = el.value;
        onChange(el.value);
        schedule.current();
      },
      scroll: (to: string | number) => { el.scrollTop = to === 'top' ? 0 : to === 'bottom' ? el.scrollHeight : Number(to) * parseFloat(getComputedStyle(el).lineHeight); request(); },
      flush: () => source.flush()});
    document.addEventListener('selectionchange', request);
    const locate=(event:any)=>{
      if(event.detail?.noteId!==source.id || event.detail.surface!=='typewriter')return;
      consumeNoteLocation(source.id,'typewriter');
      const heading=String(event.detail.heading||'').replace(/^#/, '');const snippet=String(event.detail.snippet||'').trim();let offset=0,at=-1;
      for(const line of current.current.split('\n')){if((heading&&line.replace(/^\s*#{1,6}\s+/, '').trim()===heading)||(!heading&&snippet&&line.trim()&&snippet.includes(line.trim()))){at=offset;break;}offset+=line.length+1;}
      if(at>=0){el.focus();el.setSelectionRange(at,at);el.scrollTop=current.current.slice(0,at).split('\n').length*parseFloat(getComputedStyle(el).lineHeight)-el.clientHeight/3;request();}
    };
    window.addEventListener('friday:note-locate',locate);
    const initialLocation=consumeNoteLocation(source.id,'typewriter');
    if(initialLocation)requestAnimationFrame(()=>locate({detail:initialLocation}));
    const refresh=(event:any)=>{if(event.detail?.noteId!==source.id)return;const a=el.selectionStart,b=el.selectionEnd;current.current=event.detail.text;el.value=event.detail.text;el.setSelectionRange(Math.min(a,el.value.length),Math.min(b,el.value.length));request();};
    window.addEventListener('friday:note-document',refresh);
    const typographyReady = () => { invalidateMetrics(); request(); };
    window.addEventListener('friday:typography-ready', typographyReady);
    el.focus(); request();
    if (fastWrap.current) {
      mirrorIdleTimer.current = window.setTimeout(() => {
        mirrorIdleTimer.current = null;
        fastWrap.current = false;
        el.wrap = 'soft';
        mirrorDirty.current = false;
        request();
      }, 800);
    }
    return () => { cancelAnimationFrame(frame); if (mirrorIdleTimer.current) window.clearTimeout(mirrorIdleTimer.current); observer.disconnect(); deactivate();
      window.removeEventListener('friday:note-locate',locate);
      window.removeEventListener('friday:note-document',refresh);
      window.removeEventListener('friday:typography-ready', typographyReady);
      deactivateEditor();document.removeEventListener('selectionchange', request); };
  }, [source.id]);
  useEffect(() => { schedule.current(); }, [settings]);
  useEffect(() => {
    const el=input.current!;const popup=createWikiPopup();
    const update=()=>{
      const match=/\[\[([^\]\n]{0,80})$/.exec(el.value.slice(0,el.selectionStart));
      if(!match || el.selectionStart!==el.selectionEnd){popup.close();return;}
      const end=el.selectionStart,start=end-match[0].length;
      const rect=el.getBoundingClientRect();
      popup.update(match[1],{left:rect.left,bottom:rect.top+40},(note:any)=>{
        el.setRangeText(`[${note.title}](friday://notes/${encodeURIComponent(note.id)})`,start,end,'end');
        current.current=el.value;onChange(el.value);el.focus();schedule.current();
      });
    };
    el.addEventListener('input',update);el.addEventListener('keydown',popup.keys,true);el.addEventListener('blur',popup.close);
    return()=>{el.removeEventListener('input',update);el.removeEventListener('keydown',popup.keys,true);el.removeEventListener('blur',popup.close);popup.destroy();};
  },[source.id]);
  function change(event: React.ChangeEvent<HTMLTextAreaElement>) {
    const next = event.target.value;
    document.dispatchEvent(new CustomEvent('friday:typewriter-input'));
    const inputEvent = event.nativeEvent as InputEvent;
    inserted.current = null;
    const typed = typeof inputEvent?.data === 'string' ? inputEvent.data : '';
    if (typed && !inputEvent.isComposing && /^insert(?:Text|ReplacementText|FromPaste|FromDrop)$/.test(inputEvent.inputType || '')) {
      inserted.current = {at: Math.max(0, event.target.selectionStart - typed.length), text: typed};
    }
    current.current = next;
    mirrorDirty.current = true;
    if (next.length > 20000 && !fastWrap.current) {
      // Native textarea soft wrapping recalculates every line on each input for
      // very long notes. Keep the editor responsive during the burst and
      // restore the original wrapping after the user pauses.
      event.target.wrap = 'off';
      fastWrap.current = true;
    }
    if (next.length <= 20000 && fastWrap.current) {
      event.target.wrap = 'soft';
      fastWrap.current = false;
    }
    if (mirrorIdleTimer.current) window.clearTimeout(mirrorIdleTimer.current);
    mirrorIdleTimer.current = window.setTimeout(() => {
      mirrorIdleTimer.current = null;
      mirrorDirty.current = false;
      if (fastWrap.current) {
        if (input.current) input.current.wrap = 'soft';
        fastWrap.current = false;
      }
      schedule.current();
    }, 500);
    onChange(next); schedule.current();
  }
  return <div className={`tn-note-plugin ${inkSelectionOn(settings) ? 'tn-note-ink' : ''}`} data-plugin="note" style={style}>
    <div ref={mirror} className="tn-note-mirror" aria-hidden="true" />
    <textarea ref={input} className="tn-note-input" defaultValue={initialValue} wrap={initialValue.length > 20000 ? 'off' : 'soft'} spellCheck={false}
      aria-label={i18n.global.t('typewriter.noteInput')} onChange={change}
      title={i18n.global.t('workspace.links.typingHint')}
      onClick={event => {
        if (!(event.ctrlKey || event.metaKey)) return;
        const target = noteLinkAt(current.current, input.current!.selectionStart);
        if (target) window.dispatchEvent(new CustomEvent('friday:open-note-link', {detail:target}));
      }}
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
