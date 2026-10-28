import React, {useEffect, useRef, useState} from 'react';
import {Terminal} from 'xterm';
import {FitAddon} from 'xterm-addon-fit';
import {CanvasAddon} from 'xterm-addon-canvas';
import {ImageAddon} from 'xterm-addon-image';
import {Unicode11Addon} from 'xterm-addon-unicode11';
import {activePaper, drawnCursorOn, inkSelectionOn} from '../nocturne-core/app/nocturne/apply-config';
import {fontStack} from '../nocturne-core/app/nocturne/settings';
import {attachTerminal, setActiveTerminal} from '../nocturne-core/lib/nocturne/terminal-bridge';
import {useNocturneSettings} from '../nocturne-core/lib/nocturne/store';
import {typewriterService} from '@/services/typewriter';
import {activateContent} from '../content-plugin';
import {i18n} from '@/i18n';
import {terminalTheme} from './terminal-theme';

export function TerminalSurface() {
  const host = useRef<HTMLDivElement>(null);
  const term = useRef<Terminal | null>(null);
  const settings = useNocturneSettings();
  const [status, setStatus] = useState('terminalStarting');
  const [generation, restart] = useState(0);
  useEffect(() => {
    if (!host.current) return;
    let closed = false;
    let session = '';
    setStatus('terminalStarting');
    const pending = new Map<string, string[]>();
    const paper = activePaper(settings);
    const xterm = new Terminal({allowProposedApi:true, allowTransparency:true, scrollback:5000,
      fontFamily:fontStack(settings.typography),fontSize:settings.typography.fontSize,
      minimumContrastRatio:settings.typography.contrastPolicy === 'exact' ? 1 : settings.typography.minimumContrast,
      theme:terminalTheme(paper)});
    const fit = new FitAddon();
    xterm.loadAddon(fit);
    xterm.open(host.current);
    const canvas = new CanvasAddon();
    const images = new ImageAddon({sixelSupport: true, iipSupport: true});
    const unicode = new Unicode11Addon();
    xterm.loadAddon(canvas);
    xterm.loadAddon(images);
    xterm.loadAddon(unicode);
    xterm.unicode.activeVersion = '11';
    term.current = xterm;
    const bridge = attachTerminal('friday-terminal', xterm);
    setActiveTerminal('friday-terminal');
    const deactivate = activateContent({focus: () => xterm.focus(), text: () => '', scroll: () => {}});
    const data = typewriterService.listenData(({payload}) => {
      if (payload?.sessionId === session) xterm.write(payload.data);
      else if (!session && payload?.sessionId) {
        const chunks = pending.get(payload.sessionId) || [];
        chunks.push(payload.data); pending.set(payload.sessionId, chunks);
      }
    });
    const exit = typewriterService.listenExit(({payload}) => {
      if (payload?.sessionId === session) { session = ''; setStatus('terminalExited'); }
    });
    const input = xterm.onData(value => {
      if (session && !closed) void typewriterService.writeTerminal(session, value);
    });
    const resize = () => {
      if (closed) return;
      try {
        fit.fit();
        if (session) void typewriterService.resizeTerminal(session, xterm.cols, xterm.rows);
      } catch {}
    };
    const observer = new ResizeObserver(resize);
    observer.observe(host.current);
    window.addEventListener('friday:typography-ready', resize);
    const typographyResize = () => { void document.fonts.ready.then(resize); };
    window.addEventListener('friday:typography-change', typographyResize);
    // 先注册事件，再启动 PTY，接收创建响应前的启动输出。
    void document.fonts.ready.then(async () => {
      if (closed) return;
      resize();
      const result = await typewriterService.createTerminal({cols: xterm.cols, rows: xterm.rows});
      if (closed) { if (result?.sessionId) void typewriterService.killTerminal(result.sessionId); return; }
      if (!result?.success) { setStatus('terminalFailed'); return; }
      session = result.sessionId;
      for (const chunk of pending.get(session) || []) xterm.write(chunk);
      pending.clear();
      setStatus(''); resize(); xterm.focus();
    });
    return () => {
      window.removeEventListener('friday:typography-ready', resize);
      window.removeEventListener('friday:typography-change', typographyResize);
      closed = true; observer.disconnect(); data(); exit(); input.dispose();
      bridge.dispose(); deactivate(); setActiveTerminal(null);
      if (session) void typewriterService.killTerminal(session);
      // CanvasAddon 卸载会重新创建默认 renderer，必须发生在 xterm core 销毁之前。
      images.dispose(); canvas.dispose(); unicode.dispose(); fit.dispose();
      xterm.dispose(); term.current = null;
    };
  }, [generation]);
  useEffect(() => {
    const xterm = term.current;
    if (!xterm) return;
    const paper = activePaper(settings);
    const type = settings.typography;
    xterm.options.minimumContrastRatio = type.contrastPolicy === 'exact' ? 1 : type.minimumContrast;
    xterm.options.fontFamily = fontStack(type);
    xterm.options.fontSize = type.fontSize;
    xterm.options.fontWeight = type.fontWeight;
    xterm.options.fontWeightBold = type.fontWeightBold;
    xterm.options.lineHeight = type.lineHeight;
    xterm.options.letterSpacing = type.letterSpacing;
    xterm.options.cursorStyle = drawnCursorOn(settings) ? 'bar' : type.cursorStyle;
    xterm.options.cursorBlink = !drawnCursorOn(settings) && type.cursorBlink;
    xterm.options.theme = {...terminalTheme(paper),
      cursor: drawnCursorOn(settings) ? '#00000000' : paper.cursor,
      selectionBackground: inkSelectionOn(settings) ? '#00000000' : paper.selection};
    window.dispatchEvent(new Event('friday:typography-change'));
  }, [settings, generation]);
  return <div className="tn-terminal-plugin" data-plugin="terminal">
    <div ref={host} className="tn-terminal-host" />
    {status ? <div className="tn-plugin-status" role="status">{i18n.global.t(`typewriter.${status}`)}
      {status !== 'terminalStarting' ? <button className="tn-button" data-action="restart-terminal" onClick={() => restart(n => n + 1)}>{i18n.global.t('typewriter.restartTerminal')}</button> : null}
    </div> : null}
  </div>;
}
