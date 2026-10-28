import {tr} from '../i18n';
// Typeface choice: the bundled faces, Nerd Font builds of popular faces, or any font installed on
// the computer. A custom family is validated against a safe font-family grammar before it reaches
// CSS or xterm.js.

import {i18n} from '@/i18n';
import {electronService} from '@/services/electron';
import {ensureTypeface, loadPrivateFont} from '@/features/fonts/loader';
import {fontStack} from '../../../app/nocturne/settings';
import React, {useEffect, useState} from 'react';

import {FONTS, isSafeFontFamily} from '../../../app/nocturne/settings';
import type {FontId, TypographySettings} from '../../../app/nocturne/types';

const SUGGESTIONS = [
  'JetBrainsMono Nerd Font Mono',
  'FiraCode Nerd Font Mono',
  'Hack Nerd Font Mono',
  'Iosevka Nerd Font',
  'MesloLGM Nerd Font',
  'Cascadia Code',
  'Source Code Pro',
  'SF Mono',
  'Menlo',
  'Consolas',
  'Ubuntu Mono',
  'Sarasa Mono SC',
  'LXGW WenKai Mono'
];

/** The Local Font Access API (Chromium); not yet in TypeScript's DOM typings. */
type FontAccess = {queryLocalFonts?: () => Promise<{family: string}[]>};

type FontPickerProps = {
  typography: TypographySettings;
  onChange: (patch: Partial<TypographySettings>) => void;
};

export function FontPicker({typography, onChange}: FontPickerProps) {
  const t = (key: string) => String(i18n.global.t(`typewriter.fonts.${key}`));
  const [busy, setBusy] = useState(false);
  const [extra, setExtra] = useState<any[]>([]);
  useEffect(() => { if(window.electronAPI) void electronService.request('fonts-list').then(setExtra).catch(() => {}); }, []);
  const choose = async (patch: Partial<TypographySettings>) => {
    setBusy(true); setStatus(t('loading'));
    try { await ensureTypeface(fontStack({...typography, ...patch})); onChange(patch); setStatus(''); }
    catch { setStatus(t('failed')); } finally { setBusy(false); }
  };
  const download = async (font: any) => {
    setBusy(true); setStatus(t('loading'));
    try { const result = font.installed ? font : await electronService.request('fonts-download', {id:font.id});
      await loadPrivateFont(result); await choose({font:'custom',customFamily:result.family});
      setExtra(await electronService.request('fonts-list'));
    } catch {setStatus(t('failed'));} finally {setBusy(false);}
  };
  const importFont = async () => {
    if(!draft.trim()) return;
    setBusy(true);
    try { const font=await electronService.request('fonts-import',{family:draft.trim()});
      if(font){await loadPrivateFont(font);await choose({font:'custom',customFamily:font.family});setExtra(await electronService.request('fonts-list'));}
    }catch{setStatus(t('failed'));}finally{setBusy(false);}
  };
  const [draft, setDraft] = useState(typography.customFamily);
  const [installed, setInstalled] = useState<string[]>([]);
  const [status, setStatus] = useState('');
  const custom = typography.font === 'custom';

  const applyCustom = () => {
    const family = draft.trim();
    if (!family) {
      setStatus('');
      return;
    }
    if (!isSafeFontFamily(family)) {
      setStatus(tr("Use letters, digits, spaces, quotes, commas, dots and dashes only."));
      return;
    }
    setStatus('');
    void choose({font: 'custom', customFamily: family});
  };

  const findInstalled = async () => {
    const access = window as unknown as FontAccess;
    if (!access.queryLocalFonts) {
      setStatus(tr("This system does not list its fonts; type the family name instead."));
      return;
    }
    try {
      const fonts = await access.queryLocalFonts();
      const families = Array.from(new Set(fonts.map((font) => font.family))).filter((name) => isSafeFontFamily(name));
      setInstalled(families.sort((a, b) => a.localeCompare(b)));
      setStatus(tr('{count} installed families. Start typing to pick one.', {count: families.length}));
    } catch {
      setStatus(tr("Listing installed fonts was not allowed; type the family name instead."));
    }
  };

  const options = Array.from(new Set([...installed, ...SUGGESTIONS]));

  return (
    <div className="tn-slider">
      <div className="tn-slider-head">
        <label className="tn-label" htmlFor="tn-font">{tr("Typeface")}</label>
      </div>
      <select
        id="tn-font"
        className="tn-input"
        value={typography.font}
        disabled={busy}
        onChange={(event) => void choose({font: event.currentTarget.value as FontId})}
      >
        {FONTS.map((font) => (
          <option key={font.id} value={font.id}>
            {font.bundled ? tr(font.label) : `${tr(font.label)} (${tr("if installed")})`}
          </option>
        ))}
        <option value="custom">{tr("Custom font…")}</option>
      </select>
      {custom ? (
        <div className="tn-font-custom">
          <input
            className="tn-input"
            list="tn-font-families"
            value={draft}
            placeholder={tr("Font family, e.g. Iosevka Nerd Font")}
            aria-label={tr("Custom font family")}
            spellCheck={false}
            onChange={(event) => setDraft(event.currentTarget.value)}
            onBlur={applyCustom}
            onKeyDown={(event) => event.key === 'Enter' && applyCustom()}
          />
          <datalist id="tn-font-families">
            {options.map((name) => (
              <option key={name} value={name} />
            ))}
          </datalist>
          <button type="button" className="tn-button" onClick={() => void findInstalled()}>{tr("Find installed fonts")}</button>
        </div>
      ) : null}
      <details><summary className="tn-label">{t('manage')}</summary>
        {extra.map(font => <button type="button" className="tn-button" key={font.id} disabled={busy} onClick={() => void download(font)}>{font.family} · {t(font.installed ? 'installed' : 'download')}</button>)}
        <input className="tn-input" value={draft} aria-label={t('family')} placeholder={t('family')} onChange={e=>setDraft(e.target.value)} />
        <button type="button" className="tn-button" disabled={busy || !draft.trim()} onClick={() => void importFont()}>{t('import')}</button>
      </details>
      {status ? <p className="tn-note">{tr(status)}</p> : null}
      <p className="tn-note">{tr("Nerd Font icons are bundled and appear with every typeface.")}</p>
    </div>
  );
}
