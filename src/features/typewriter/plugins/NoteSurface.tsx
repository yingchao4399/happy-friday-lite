import React, {useEffect, useRef} from 'react';
import {Compartment, EditorState, StateEffect, StateField} from '@codemirror/state';
import {EditorView, Decoration, drawSelection, keymap, WidgetType} from '@codemirror/view';
import {defaultKeymap, history, historyKeymap} from '@codemirror/commands';
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
import {parseTypewriterImageNodes, updateTypewriterImageMetadata} from '../image-utils';

const refreshImages = StateEffect.define<void>();
const tr = (key: string) => i18n.global.t(`typewriter.${key}`);
const stopWidgetEvent = (event: Event) => { event.preventDefault(); event.stopPropagation(); };

function updateImage(view: EditorView, image: any, attrs: Record<string, string | number>) {
  const before = view.state.doc.toString();
  const after = updateTypewriterImageMetadata(before, image.anchor.offset, attrs);
  if (after === before) return;
  const oldNode = parseTypewriterImageNodes(before).find(item => item.anchor.offset === image.anchor.offset);
  const nextNode = parseTypewriterImageNodes(after).find(item => item.anchor.offset === image.anchor.offset);
  if (!oldNode || !nextNode) return;
  view.dispatch({changes: {from: oldNode.range.from, to: oldNode.range.to, insert: after.slice(nextNode.range.from, nextNode.range.to)}});
}

class TypewriterImageWidget extends WidgetType {
  constructor(readonly image: any, readonly failed: boolean, readonly retry: () => void, readonly fail: () => void) { super(); }
  eq(other: TypewriterImageWidget) {
    return this.image.id === other.image.id && this.image.src === other.image.src && this.image.width === other.image.width &&
      this.image.height === other.image.height && this.image.align === other.image.align && this.image.light.intensity === other.image.light.intensity &&
      this.image.light.temperature === other.image.light.temperature && this.image.light.shadow === other.image.light.shadow &&
      this.image.light.blend === other.image.light.blend && this.failed === other.failed;
  }
  toDOM(view: EditorView) {
    const image = this.image;
    const figure = document.createElement('figure');
    figure.className = `tn-typewriter-image-node tn-inline-image-node${image.align === 'inline' ? ' is-inline' : ` align-${image.align}`}${this.failed ? ' is-failed' : ''}${image.light.blend === 'paper' ? ' blend-paper' : ''}`;
    // Paper texture and illumination are composited by Nocturne's stage canvases
    // above the whole sheet. Multiplying the entire figure here applies the
    // dark sheet colour a second time and makes photographs muddy on dark paper.
    figure.dataset.imageId = image.id;
    figure.setAttribute('aria-label', image.alt || tr('image'));
    figure.style.setProperty('--tn-image-width', `${image.width}px`);
    figure.style.setProperty('--tn-image-shadow', String(image.light.shadow));
    figure.style.setProperty('--tn-image-intensity', String(image.light.intensity));
    figure.style.setProperty('--tn-image-temperature', String(image.light.temperature));
    const button = (label: string, action: () => void) => {
      const control = document.createElement('button');
      control.type = 'button'; control.textContent = label; control.setAttribute('aria-label', label); control.title = label;
      control.addEventListener('pointerdown', stopWidgetEvent);
      control.addEventListener('click', event => { stopWidgetEvent(event); action(); });
      return control;
    };
    if (this.failed) {
      const fallback = document.createElement('div'); fallback.className = 'tn-typewriter-image-fallback'; fallback.setAttribute('role', 'status');
      const title = document.createElement('strong'); title.textContent = tr('imageFailed');
      const detail = document.createElement('small'); detail.textContent = `${image.assetId} · read_failed`;
      fallback.append(title, detail, button(tr('retryImage'), this.retry)); figure.append(fallback); return figure;
    }
    const frame = document.createElement('span'); frame.className = 'tn-typewriter-image-frame';
    const img = document.createElement('img'); img.src = image.src; img.alt = image.alt || tr('image'); img.draggable = false;
    img.style.width = `${image.width}px`; img.style.maxWidth = '100%'; img.style.height = 'auto';
    if (image.height) img.style.aspectRatio = `${image.width} / ${image.height}`;
    const temperature = image.light.temperature;
    img.style.filter = `saturate(${1 + image.light.intensity * .2}) sepia(${Math.max(0, temperature) * 10}%) hue-rotate(${Math.min(0, temperature) * -18}deg) brightness(${1 - image.light.intensity * .06})`;
    img.addEventListener('error', this.fail, {once: true});
    frame.append(img);
    const controls = document.createElement('div'); controls.className = 'tn-typewriter-image-controls'; controls.setAttribute('role', 'toolbar');
    const alignments = [
      ['imageAlignLeft', 'left'], ['imageAlignCenter', 'center'], ['imageAlignRight', 'right'], ['imageAlignInline', 'inline']
    ];
    for (const [key, align] of alignments) controls.append(button(tr(key), () => updateImage(view, image, {align})));
    const resize = document.createElement('button'); resize.type = 'button'; resize.className = 'tn-typewriter-image-resize';
    resize.setAttribute('aria-label', tr('resizeImage')); resize.title = tr('resizeImage');
    resize.addEventListener('pointerdown', event => {
      event.preventDefault(); event.stopPropagation();
      const startX = event.clientX, startWidth = image.width;
      const maxWidth = Math.max(96, Math.min(960, view.scrollDOM.clientWidth - 48));
      let nextWidth = startWidth;
      const move = (next: PointerEvent) => {
        nextWidth = Math.max(96, Math.min(maxWidth, Math.round(startWidth + next.clientX - startX)));
        img.style.width = `${nextWidth}px`;
      };
      const finish = () => {
        window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', finish);
        window.removeEventListener('pointercancel', finish); window.removeEventListener('blur', finish);
        if (nextWidth !== startWidth) updateImage(view, image, {width: nextWidth});
      };
      window.addEventListener('pointermove', move); window.addEventListener('pointerup', finish, {once: true});
      window.addEventListener('pointercancel', finish, {once: true}); window.addEventListener('blur', finish, {once: true});
    });
    controls.append(resize);
    const lighting = document.createElement('details'); lighting.className = 'tn-typewriter-image-lighting';
    const summary = document.createElement('summary'); summary.textContent = tr('imageLighting'); lighting.append(summary);
    const sliders: Array<[string, string, number, number, number]> = [
      ['imageIntensity', 'intensity', 0, 1, .01], ['imageTemperature', 'temperature', -1, 1, .01], ['imageShadow', 'shadow', 0, 1, .01]
    ];
    for (const [key, attr, min, max, step] of sliders) {
      const label = document.createElement('label'); label.textContent = tr(key);
      const input = document.createElement('input'); input.type = 'range'; input.min = String(min); input.max = String(max); input.step = String(step);
      input.value = String(attr === 'intensity' ? image.light.intensity : attr === 'temperature' ? image.light.temperature : image.light.shadow);
      input.addEventListener('pointerdown', event => event.stopPropagation());
      input.addEventListener('change', () => updateImage(view, image, {[attr]: Number(input.value)}));
      label.append(input); lighting.append(label);
    }
    controls.append(lighting); frame.append(controls); figure.append(frame);
    figure.addEventListener('pointerdown', event => event.stopPropagation());
    return figure;
  }
  ignoreEvent() { return true; }
}

function imageDecorations(state: EditorState, failures: Set<string>, refresh: () => void) {
  const decorations: any[] = [];
  const text = state.doc.toString();
  for (const image of parseTypewriterImageNodes(text)) {
    const fail = () => { failures.add(image.id); refresh(); };
    const retry = () => { failures.delete(image.id); refresh(); };
    const widget = new TypewriterImageWidget(image, failures.has(image.id), retry, fail);
    decorations.push(Decoration.replace({widget, block: image.align !== 'inline'}).range(image.range.from, image.range.to));
  }
  return Decoration.set(decorations, true);
}

function imageMarkupChanged(transaction: any, decorations: any) {
  let refresh = false;
  transaction.changes.iterChanges((from: number, to: number, fromAfter: number, toAfter: number, inserted: any) => {
    if (refresh) return;
    const text = transaction.state.doc.sliceString(Math.max(0, fromAfter - 1), Math.min(transaction.state.doc.length, toAfter + 1));
    if (text.includes('![') || inserted.toString().includes('![')) {
      refresh = true;
      return;
    }
    const nearFrom = Math.max(0, from - 1), nearTo = Math.max(nearFrom, to + 1);
    decorations.between(nearFrom, nearTo, (imageFrom: number, imageTo: number) => {
      if ((from === to && from >= imageFrom && from <= imageTo) || (from < imageTo && to > imageFrom)) refresh = true;
    });
  });
  return refresh;
}

function createImageDecorationField(failures: Set<string>, refresh: () => void) {
  return StateField.define({
    create: state => imageDecorations(state, failures, refresh),
    update: (decorations, transaction) => transaction.effects.some(effect => effect.is(refreshImages)) || imageMarkupChanged(transaction, decorations)
      ? imageDecorations(transaction.state, failures, refresh)
      : decorations.map(transaction.changes),
    provide: field => EditorView.decorations.from(field)
  });
}

export function NoteSurface({document: source, onChange}: {document: any; onChange: (text: string) => void}) {
  const settings = useNocturneSettings();
  const host = useRef<HTMLDivElement>(null);
  const viewRef = useRef<EditorView | null>(null);
  const cursorCompartment = useRef(new Compartment());
  const current = useRef(String(source.content || ''));
  const failedImages = useRef(new Set<string>());
  const schedule = useRef<() => void>(() => {});
  const paper = activePaper(settings);
  const type = settings.typography;
  const style = {fontFamily: fontStack(type), fontSize: type.fontSize, fontWeight: type.fontWeight,
    lineHeight: `${type.fontSize * type.lineHeight}px`, letterSpacing: type.letterSpacing, color: paper.ink, tabSize: 4} as React.CSSProperties;

  useEffect(() => {
    if (!host.current) return;
    let frame = 0;
    let lastSelection = '';
    let previousLength = current.current.length;
    let popup: any;
    let updateWiki = () => {};
    const metricCanvas = document.createElement('canvas');
    const metricContext = metricCanvas.getContext('2d');
    let metricKey = '';
    let cachedLineHeight = 20;
    let cachedCellWidth = 8;
    const refresh = () => { const view = viewRef.current; if (view) view.dispatch({effects: refreshImages.of()}); };
    const publish = () => {
      frame = 0;
      const view = viewRef.current;
      if (!view) return;
      const scroller = view.scrollDOM, rect = scroller.getBoundingClientRect();
      if (!rect.width || !rect.height) return;
      const computed = getComputedStyle(view.contentDOM);
      const lineHeight = parseFloat(computed.lineHeight) || Number(type.fontSize) * Number(type.lineHeight) || 20;
      const nextMetricKey = `${computed.font}|${lineHeight}|${scroller.clientWidth}`;
      if (nextMetricKey !== metricKey) {
        metricKey = nextMetricKey;
        cachedLineHeight = lineHeight;
        if (metricContext) {
          metricContext.font = computed.font;
          cachedCellWidth = metricContext.measureText('M').width || 8;
        }
      }
      const cellWidth = cachedCellWidth;
      const measuredLineHeight = cachedLineHeight;
      const cols = Math.max(1, Math.floor(scroller.clientWidth / cellWidth));
      const rows = Math.max(1, Math.floor(scroller.clientHeight / measuredLineHeight));
      const head = view.state.selection.main.head;
      const caret = view.coordsAtPos(head) || {left: rect.left, right: rect.left + cellWidth, top: rect.top, bottom: rect.top + measuredLineHeight};
      const viewportY = scroller.scrollTop / measuredLineHeight;
      const caretRow = Math.max(0, Math.round((caret.top - rect.top) / measuredLineHeight));
      const caretCol = Math.max(0, Math.round((caret.left - rect.left) / cellWidth));
      const nextGlyph = Array.from(view.state.doc.sliceString(head, Math.min(view.state.doc.length, head + 4)))[0] || ' ';
      emit('cursor', {uid: source.id, x: caret.left, y: caret.top, width: cellWidth, height: lineHeight,
        col: caretCol, row: caretRow, cols, rows, alternate: false, visible: caret.top >= rect.top - 1 && caret.top < rect.bottom,
        viewportY, baseY: Math.max(0, (scroller.scrollHeight - scroller.clientHeight) / lineHeight), cursorHidden: false,
        focused: view.hasFocus, glyph: {char: nextGlyph, width: /[^\x00-\xff]/.test(nextGlyph) ? 2 : 1, bold: false, italic: false},
        grid: {left: rect.left, top: rect.top, width: rect.width, height: rect.height}});
      const selection = view.state.selection.main;
      const selectionKey = `${selection.from}:${selection.to}:${view.state.doc.length}`;
      if (selectionKey !== lastSelection) {
        lastSelection = selectionKey;
        const cells = [];
        for (let at = selection.from; at < selection.to && cells.length < 4000;) {
          const char = Array.from(view.state.doc.sliceString(at, Math.min(view.state.doc.length, at + 4)))[0];
          if (!char) break;
        if (char !== '\n' && char !== '\r' && char.trim()) {
            const point = view.coordsAtPos(at);
            if (point) cells.push({line: Math.max(0, Math.round((point.top - rect.top) / measuredLineHeight + viewportY)), col: Math.max(0, Math.round((point.left - rect.left) / cellWidth)), char, width: /[^\x00-\xff]/.test(char) ? 2 : 1, fg: null, bold: false});
          }
          at += char.length;
        }
        emit('selection', {uid: source.id, cells});
      }
    };
    const request = () => { if (!frame) frame = requestAnimationFrame(publish); };
    schedule.current = request;
    const imageDecorationField = createImageDecorationField(failedImages.current, refresh);
    const state = EditorState.create({doc: current.current, extensions: [
      history(), EditorView.lineWrapping, EditorState.tabSize.of(4), imageDecorationField,
      keymap.of([
        {key: 'Tab', run: view => { view.dispatch(view.state.replaceSelection('  ')); return true; }},
        {key: 'Mod-s', run: () => { void source.flush().catch(() => {}); return true; }},
        {key: 'Backspace', run: view => { const pos = view.state.selection.main.head; const image = parseTypewriterImageNodes(view.state.doc.toString()).find(item => item.range.to === pos); if (!image) return false; view.dispatch({changes: {from: image.range.from, to: image.range.to}}); return true; }},
        {key: 'Delete', run: view => { const pos = view.state.selection.main.head; const image = parseTypewriterImageNodes(view.state.doc.toString()).find(item => item.range.from === pos); if (!image) return false; view.dispatch({changes: {from: image.range.from, to: image.range.to}}); return true; }},
        ...defaultKeymap, ...historyKeymap
      ]),
      EditorView.theme({
        '&': {height: '100%', backgroundColor: 'transparent', color: 'inherit', fontFamily: 'inherit', fontSize: 'inherit'},
        '.cm-scroller': {overflow: 'auto', fontFamily: 'inherit'},
        '.cm-content': {minHeight: '100%', padding: '0', whiteSpace: 'pre-wrap', overflowWrap: 'anywhere'},
        '.cm-line': {padding: '0'}, '.cm-gutters': {display: 'none'}, '.cm-focused': {outline: 'none'}
      }),
      cursorCompartment.current.of([
        drawSelection({cursorBlinkRate: settings.typography.cursorBlink ? 1200 : 0}),
        EditorView.theme({'.cm-cursor': {borderLeftColor: drawnCursorOn(settings) ? 'transparent' : paper.cursor}})
      ]),
      EditorView.contentAttributes.of({'aria-label': tr('noteInput')}),
      EditorView.updateListener.of(update => {
        if (update.docChanged) {
          current.current = update.state.doc.toString();
          const delta = update.state.doc.length - previousLength;
          if (delta > 0 && !update.view.composing) {
            let emitted = 0;
            const scrollRect = update.view.scrollDOM.getBoundingClientRect();
            const strikeLineHeight = Number(type.fontSize) * Number(type.lineHeight);
            update.changes.iterChanges((_from, _to, fromB, _toB, inserted) => {
              for (const char of Array.from(inserted.toString()).slice(0, 64 - emitted)) {
                if (char.trim() && emitted < 64) {
                  const point = update.view.coordsAtPos(fromB + emitted);
                  if (point) emit('strike', {uid: source.id, char, col: Math.max(0, Math.round((point.left - scrollRect.left) / 8)), line: Math.max(0, Math.round((point.top - scrollRect.top) / strikeLineHeight)), cellWidth: 8, width: /[^\x00-\xff]/.test(char) ? 2 : 1, fg: null, bold: false});
                }
                emitted++;
              }
            });
          }
          previousLength = update.state.doc.length;
          onChange(current.current);
          document.dispatchEvent(new CustomEvent('friday:typewriter-input'));
        }
        request(); updateWiki();
      })
    ]});
    const view = new EditorView({state, parent: host.current}); viewRef.current = view;
    view.contentDOM.classList.add('tn-note-editor-input');
    Object.assign(view.dom.style, {position: 'absolute', top: '26px', left: '34px', width: 'calc(100% - 68px)', height: 'calc(100% - 36px)', outline: 'none', background: 'transparent', ...style});
    popup = createWikiPopup();
    updateWiki = () => {
      const editor = viewRef.current; if (!editor) return;
      const head = editor.state.selection.main.head;
      const match = /\[\[([^\]\n]{0,80})$/.exec(editor.state.doc.sliceString(Math.max(0, head - 82), head));
      if (!match || !editor.state.selection.main.empty) { popup.close(); return; }
      const start = head - match[0].length, rect = editor.coordsAtPos(head);
      if (!rect) return;
      popup.update(match[1], {left: rect.left, bottom: rect.bottom}, (note: any) => {
        const replacement = `[${note.title}](friday://notes/${encodeURIComponent(note.id)})`;
        editor.dispatch({changes: {from: start, to: head, insert: replacement}, selection: {anchor: start + replacement.length}});
        editor.focus(); request();
      });
    };
    const onClick = (event: MouseEvent) => {
      if (!(event.ctrlKey || event.metaKey)) return;
      const pos = view.posAtCoords({x: event.clientX, y: event.clientY});
      const target = noteLinkAt(current.current, pos ?? view.state.selection.main.head);
      if (target) window.dispatchEvent(new CustomEvent('friday:open-note-link', {detail: target}));
    };
    const scroll = () => request();
    const locate = (event: any) => {
      if (event.detail?.noteId !== source.id || event.detail.surface !== 'typewriter') return;
      consumeNoteLocation(source.id, 'typewriter');
      const heading = String(event.detail.heading || '').replace(/^#/, ''), snippet = String(event.detail.snippet || '').trim();
      let offset = 0, found = -1;
      for (const line of current.current.split('\n')) {
        if ((heading && line.replace(/^\s*#{1,6}\s+/, '').trim() === heading) || (!heading && snippet && line.trim() && snippet.includes(line.trim()))) { found = offset; break; }
        offset += line.length + 1;
      }
      if (found >= 0) { view.dispatch({selection: {anchor: found}, scrollIntoView: true}); view.focus(); request(); }
    };
    const refreshDocument = (event: any) => {
      if (event.detail?.noteId !== source.id) return;
      const value = String(event.detail.text || '');
      view.dispatch({changes: {from: 0, to: view.state.doc.length, insert: value}, selection: {anchor: Math.min(view.state.selection.main.head, value.length)}});
      request();
    };
    const composition = () => request();
    const hostElement = host.current as any;
    const selectRange = (from: number, to = from) => view.dispatch({selection: {anchor: Math.max(0, Math.min(from, view.state.doc.length)), head: Math.max(0, Math.min(to, view.state.doc.length))}});
    Object.defineProperties(hostElement, {
      value: {configurable: true, get: () => view.state.doc.toString(), set: (value: string) => view.dispatch({changes: {from: 0, to: view.state.doc.length, insert: String(value ?? '')}})},
      selectionStart: {configurable: true, get: () => view.state.selection.main.from},
      selectionEnd: {configurable: true, get: () => view.state.selection.main.to},
      selectionDirection: {configurable: true, get: () => view.state.selection.main.anchor > view.state.selection.main.head ? 'backward' : 'forward'},
      setSelectionRange: {configurable: true, value: selectRange},
      setRangeText: {configurable: true, value: (text: string, from: number, to: number, mode = 'preserve') => {
        const insert = String(text ?? ''), anchor = mode === 'select' ? from : mode === 'start' ? from : mode === 'preserve' ? view.state.selection.main.head : from + insert.length;
        view.dispatch({changes: {from, to, insert}, selection: {anchor, head: mode === 'select' ? from + insert.length : anchor}});
      }},
      scrollTop: {configurable: true, get: () => view.scrollDOM.scrollTop, set: (value: number) => { view.scrollDOM.scrollTop = Number(value) || 0; request(); }},
      scrollHeight: {configurable: true, get: () => view.scrollDOM.scrollHeight},
      clientWidth: {configurable: true, get: () => view.scrollDOM.clientWidth},
      clientHeight: {configurable: true, get: () => view.scrollDOM.clientHeight},
      focus: {configurable: true, value: () => view.focus()},
      blur: {configurable: true, value: () => view.contentDOM.blur()},
      wrap: {configurable: true, get: () => 'soft', set: () => {}}
    });
    hostElement.addEventListener('click', onClick, true); hostElement.addEventListener('keydown', popup.keys, true);
    hostElement.addEventListener('input', updateWiki); hostElement.addEventListener('keyup', updateWiki);
    hostElement.addEventListener('compositionend', composition); hostElement.addEventListener('scroll', scroll, {passive: true});
    view.scrollDOM.addEventListener('scroll', scroll, {passive: true});
    view.dom.addEventListener('blur', () => { void source.flush().catch(() => {}); }, true);
    window.addEventListener('friday:note-locate', locate); window.addEventListener('friday:note-document', refreshDocument);
    view.focus(); request();
    const initialLocation = consumeNoteLocation(source.id, 'typewriter');
    if (initialLocation) requestAnimationFrame(() => locate({detail: initialLocation}));
    const deactivateEditor = activateEditor({kind: 'typewriter', noteId: () => source.id,
      getValue: () => current.current,
      getSelection: () => ({from: view.state.selection.main.from, to: view.state.selection.main.to}),
      replaceSelection: (text: string) => { view.dispatch(view.state.replaceSelection(text)); view.focus(); request(); },
      focus: () => view.focus()});
    const deactivate = activateContent({focus: () => view.focus(), blur: () => view.contentDOM.blur(),
      text: (kind: string) => kind === 'selection' ? view.state.doc.sliceString(view.state.selection.main.from, view.state.selection.main.to) : current.current,
      insert: (text: string) => { view.dispatch(view.state.replaceSelection(String(text || ''))); view.focus(); request(); },
      scroll: (to: string | number) => { if (to === 'top') view.scrollDOM.scrollTop = 0; else if (to === 'bottom') view.scrollDOM.scrollTop = view.scrollDOM.scrollHeight; else view.scrollDOM.scrollTop = Number(to) * (Number(type.fontSize) * Number(type.lineHeight)); request(); },
      flush: () => source.flush()});
    return () => {
      if (frame) cancelAnimationFrame(frame); popup?.destroy(); deactivate(); deactivateEditor(); view.destroy(); viewRef.current = null;
      hostElement.removeEventListener('click', onClick, true); hostElement.removeEventListener('keydown', popup.keys, true);
      hostElement.removeEventListener('input', updateWiki); hostElement.removeEventListener('keyup', updateWiki);
      hostElement.removeEventListener('compositionend', composition); hostElement.removeEventListener('scroll', scroll);
      view.scrollDOM.removeEventListener('scroll', scroll);
      schedule.current = () => {};
      window.removeEventListener('friday:note-locate', locate); window.removeEventListener('friday:note-document', refreshDocument);
    };
  }, [source.id]);

  useEffect(() => {
    const view = viewRef.current; if (!view) return;
    const paper = activePaper(settings), type = settings.typography;
    Object.assign(view.dom.style, {fontFamily: fontStack(type), fontSize: `${type.fontSize}px`, fontWeight: String(type.fontWeight),
      lineHeight: `${type.fontSize * type.lineHeight}px`, letterSpacing: `${type.letterSpacing}px`, color: paper.ink});
    view.dispatch({effects: cursorCompartment.current.reconfigure([
      drawSelection({cursorBlinkRate: settings.typography.cursorBlink ? 1200 : 0}),
      EditorView.theme({'.cm-cursor': {borderLeftColor: drawnCursorOn(settings) ? 'transparent' : paper.cursor}})
    ])});
    view.requestMeasure(); schedule.current();
  }, [settings]);

  return <div className={`tn-note-plugin${inkSelectionOn(settings) ? ' tn-note-ink' : ''}${drawnCursorOn(settings) ? ' tn-note-drawn-cursor' : ''}${settings.typography.cursorStyle === 'underline' ? ' tn-note-cursor-underline' : ''}`} data-plugin="note" style={{...style, ['--tn-cursor-color' as any]: paper.cursor}}>
    <div ref={host} className="tn-note-input" style={style} />
  </div>;
}
