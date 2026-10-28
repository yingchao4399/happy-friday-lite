import React from 'react';
import {i18n} from '@/i18n';
import {activePaper} from '../../../app/nocturne/apply-config';
import {contrast} from '../../../app/nocturne/color';
import {INKS} from '../../../app/nocturne/ink';
import {updateSettings} from '../store';
import {Switch,Slider} from './controls';

export function InkPicker({settings}: {settings: any}) {
  const t = (key: string) => String(i18n.global.t(`typewriter.ink.${key}`));
  const type = settings.typography;
  const paper = activePaper(settings);
  const patch = (value: any) => updateSettings({typography: value});
  return <div className="tn-slider tn-ink-picker">
    <label className="tn-label" htmlFor="tn-ink-mode">{t('title')}</label>
    <select id="tn-ink-mode" className="tn-input" value={type.inkMode} onChange={e => patch({inkMode: e.target.value})}>
      {['paper', 'preset', 'custom'].map(id => <option key={id} value={id}>{t(id)}</option>)}
    </select>
    {type.inkMode === 'preset' ? <div className="tn-ink-swatches">{Object.entries(INKS).map(([id, color]) =>
      <button type="button" key={id} title={t(id)} aria-label={t(id)} aria-pressed={type.inkPreset === id}
        style={{background: color}} onClick={() => patch({inkPreset: id})} />)}</div> : null}
    {type.inkMode === 'custom' ? <input type="color" aria-label={t('custom')} value={type.inkColor} onChange={e => patch({inkColor: e.target.value})} /> : null}
    <Switch label={t('contrast')} checked={type.contrastPolicy !== 'exact'} onChange={checked => patch({contrastPolicy: checked ? 'auto' : 'exact'})} />
    {type.contrastPolicy !== 'exact' ? <Slider label={t('minimumContrast')} value={type.minimumContrast} min={1} max={21} step={.5} format={value=>`${value.toFixed(1)}:1`} onChange={minimumContrast=>patch({minimumContrast})} /> : null}
    <p className="tn-note tn-ink-preview">{t('effective')}: <span className="tn-ink-sample" style={{background:paper.ink}} /><span className="tn-ink-code">{paper.ink}</span><span>Aa 中文</span>
      {contrast(paper.ink, paper.paper) < 4.5 ? ` · ${t('lowContrast')}` : ''}</p>
    <p className="tn-note">{t('terminalHint')}</p>
    <button type="button" className="tn-button" onClick={() => patch({inkMode:'paper',contrastPolicy:'auto'})}>{t('reset')}</button>
  </div>;
}
