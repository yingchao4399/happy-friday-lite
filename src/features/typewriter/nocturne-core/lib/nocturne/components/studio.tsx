import {tr} from '../i18n';
// Nocturne Studio: theme, paper, type, lamp and typewriter in one panel. Every control writes a
// validated settings patch; nothing here touches the terminal directly.

import React from 'react';

import {activeTheme} from '../../../app/nocturne/apply-config';
import {resolveSource} from '../../../app/nocturne/light-model';
import {PAPER_IDS, PAPERS} from '../../../app/nocturne/papers';
import {applyLightingPreset} from '../../../app/nocturne/settings';
import {THEMES} from '../../../app/nocturne/themes';
import type {
  BeamShape,
  ClipFinish,
  CursorStyle,
  EffectQuality,
  FocusBackground,
  LightingPresetId,
  LightingSettings,
  NocturneSettings,
  ScrollbarStyle,
  SelectionStyle,
  ThemeId,
  TypewriterVoice
} from '../../../app/nocturne/types';
import {getSettings, setSettings, updateSettings} from '../store';

import {percent, Section, Segmented, Slider, Switch} from './controls';
import {FontPicker} from './font-picker';

const THEME_IDS: ThemeId[] = ['paper-and-ink', 'midnight-study', 'moonlit-poetry'];

const PRESETS = [
  {value: 'off', label: 'Off'},
  {value: 'balanced', label: 'Balanced'},
  {value: 'cinematic', label: 'Cinematic'}
] as const;

const QUALITIES: readonly {value: EffectQuality; label: string}[] = [
  {value: 'auto', label: 'Auto'},
  {value: 'high', label: 'High'},
  {value: 'medium', label: 'Medium'},
  {value: 'low', label: 'Low'}
];

const VOICES: readonly {value: TypewriterVoice; label: string}[] = [
  {value: 'standard', label: 'Standard'},
  {value: 'portable', label: 'Portable'},
  {value: 'electric', label: 'Electric'},
  {value: 'whisper', label: 'Whisper'}
];

const SOURCES: readonly {value: LightingSettings['source']; label: string}[] = [
  {value: 'theme', label: 'Theme'},
  {value: 'carriage', label: 'Carriage'},
  {value: 'desk-lamp', label: 'Desk lamp'},
  {value: 'moonlight', label: 'Window'}
];

const BEAMS: readonly {value: BeamShape; label: string}[] = [
  {value: 'pointed', label: 'Pointed'},
  {value: 'soft', label: 'Soft'}
];

const SCROLLBARS: readonly {value: ScrollbarStyle; label: string}[] = [
  {value: 'clip', label: 'Paper clip'},
  {value: 'bar', label: 'Bar'},
  {value: 'native', label: 'System'}
];

const FINISHES: readonly {value: ClipFinish; label: string}[] = [
  {value: 'silver', label: 'Silver'},
  {value: 'brass', label: 'Brass'},
  {value: 'gold', label: 'Gold'},
  {value: 'black', label: 'Black'}
];

const CURSORS: readonly {value: CursorStyle; label: string}[] = [
  {value: 'block', label: 'Block'},
  {value: 'quill', label: 'Quill'},
  {value: 'bar', label: 'Bar'},
  {value: 'underline', label: 'Line'}
];

const SELECTIONS: readonly {value: SelectionStyle; label: string}[] = [
  {value: 'ink', label: 'Ink'},
  {value: 'classic', label: 'Classic'}
];

const FOCUS_BACKGROUNDS: readonly {value: FocusBackground; label: string}[] = [
  {value: 'paper', label: 'Paper'},
  {value: 'dark', label: 'Dark'},
  {value: 'custom', label: 'Custom'}
];

const degrees = (value: number) => `${Math.round(value)}°`;
const signedDegrees = (value: number) => (value > 0 ? `+${Math.round(value)}°` : degrees(value));
const pixels = (value: number) => `${value}px`;
const panes = (value: number) => String(Math.round(value));

/** The sheet's width, from the narrowest to the full length of the platen. */
function sheetWidth(value: number) {
  if (value <= 0) {
    return 'Narrow';
  }
  return value >= 1 ? tr("Full platen") : percent(value);
}

type StudioProps = {
  settings: NocturneSettings;
  /** What the stage draws right now, e.g. "the full stage" or "the plain sheet (no usable GPU)". */
  drawing: string;
  onClose: () => void;
  onPress: () => void;
};

export function Studio({settings, drawing, onClose, onPress}: StudioProps) {
  const {lighting, typography, typewriter, paper, scrollbar, focus} = settings;
  const light = (patch: Partial<NocturneSettings['lighting']>) =>
    updateSettings({lighting: {...patch, preset: 'custom'}});
  const frame = (patch: Partial<LightingSettings['window']>) => light({window: {...lighting.window, ...patch}});
  const look = activeTheme(settings);
  const lightSource = look ? resolveSource(lighting, look) : 'carriage';
  const type = (patch: Partial<NocturneSettings['typography']>) =>
    updateSettings({typography: {...patch, preset: 'custom'}});
  const preset = lighting.enabled ? lighting.preset : 'off';
  const choosePreset = (value: LightingPresetId | 'custom') => {
    if (value !== 'custom') {
      setSettings(applyLightingPreset(getSettings(), value));
    }
  };

  return (
    <aside className="tn-studio" aria-label={tr("Nocturne Studio")}>
      <div className="tn-studio-head">
        <div>
          <div className="tn-eyebrow">{tr("Nocturne Studio")}</div>
          <h2>{tr("Light, Paper & Ink")}</h2>
        </div>
        <button type="button" className="tn-close" aria-label={tr("Close the Studio")} onClick={onClose}>
          ×
        </button>
      </div>

      <Section title={tr("Theme")}>
        <div className="tn-cards">
          {THEME_IDS.map((id) => {
            const theme = THEMES[id];
            const swatch = `linear-gradient(135deg, ${theme.palette.room} 50%, ${theme.light.color} 50%)`;
            return (
              <button
                key={id}
                type="button"
                className="tn-card"
                aria-pressed={settings.theme === id}
                onClick={() => updateSettings({theme: id})}
              >
                <span className="tn-card-swatch" style={{background: swatch}} />
                <span>{tr(theme.name)}</span>
              </button>
            );
          })}
        </div>
      </Section>

      <Section title={tr("Paper & Ink")}>
        <div className="tn-cards">
          {PAPER_IDS.map((id) => {
            const sheet = PAPERS[id];
            const swatch = `linear-gradient(135deg, ${sheet.paper} 60%, ${sheet.ink} 60%)`;
            return (
              <button
                key={id}
                type="button"
                className="tn-card"
                aria-pressed={paper.style === id}
                onClick={() => updateSettings({paper: {style: id}})}
              >
                <span className="tn-card-swatch" style={{background: swatch}} />
                <span>{tr(sheet.name)}</span>
              </button>
            );
          })}
        </div>
        <Slider
          label={tr("Texture depth")}
          value={paper.texture}
          min={0}
          max={1.6}
          step={0.01}
          format={percent}
          onChange={(texture) => updateSettings({paper: {texture}})}
        />
        <Slider
          label={tr("Sheet width")}
          value={paper.width}
          min={0}
          max={1}
          step={0.01}
          format={sheetWidth}
          onChange={(width) => updateSettings({paper: {width}})}
        />
        <Slider
          label={tr("Type impression")}
          value={typewriter.impression}
          min={0}
          max={1}
          step={0.01}
          format={percent}
          onChange={(impression) => updateSettings({typewriter: {impression}})}
        />
      </Section>

      <Section title={tr("Type")}>
        <FontPicker typography={typography} onChange={type} />
        <Slider
          label={tr("Type size")}
          value={typography.fontSize}
          min={11}
          max={22}
          step={0.5}
          format={pixels}
          onChange={(fontSize) => type({fontSize})}
        />
        <Slider
          label={tr("Line spacing")}
          value={typography.lineHeight}
          min={1.2}
          max={1.9}
          step={0.05}
          format={(value) => value.toFixed(2)}
          onChange={(lineHeight) => type({lineHeight})}
        />
        <Segmented
          label={tr("Cursor")}
          value={typography.cursorStyle}
          options={CURSORS}
          onChange={(cursorStyle) => updateSettings({typography: {cursorStyle}})}
        />
        <Segmented
          label={tr("Selection")}
          value={typography.selectionStyle}
          options={SELECTIONS}
          onChange={(selectionStyle) => updateSettings({typography: {selectionStyle}})}
        />
      </Section>

      <Section title={tr("Scrollbar")}>
        <Segmented
          label={tr("Style")}
          value={scrollbar.style}
          options={SCROLLBARS}
          onChange={(style) => updateSettings({scrollbar: {style}})}
        />
        {scrollbar.style === 'clip' ? (
          <Segmented
            label={tr("Finish")}
            value={scrollbar.finish}
            options={FINISHES}
            onChange={(finish) => updateSettings({scrollbar: {finish}})}
          />
        ) : null}
        {scrollbar.style === 'bar' ? (
          <>
            <Slider
              label={tr("Opacity")}
              value={scrollbar.barOpacity}
              min={0.1}
              max={0.9}
              step={0.01}
              format={percent}
              onChange={(barOpacity) => updateSettings({scrollbar: {barOpacity}})}
            />
            <Slider
              label={tr("Width")}
              value={scrollbar.barWidth}
              min={3}
              max={12}
              step={1}
              format={pixels}
              onChange={(barWidth) => updateSettings({scrollbar: {barWidth}})}
            />
          </>
        ) : null}
      </Section>

      <Section title={tr("Lamp")}>
        <Switch label={tr("Lamp")} checked={lighting.enabled} onChange={(enabled) => updateSettings({lighting: {enabled}})} />
        <Switch
          label={tr("Pull cord")}
          checked={settings.chrome.pullCord}
          onChange={(pullCord) => updateSettings({chrome: {pullCord}})}
        />
        <Segmented label={tr("Preset")} value={preset} options={PRESETS} onChange={choosePreset} />
        <Segmented label={tr("Light")} value={lighting.source} options={SOURCES} onChange={(source) => light({source})} />
        <Slider
          label={tr("Brightness")}
          value={lighting.intensity}
          min={0}
          max={2}
          step={0.01}
          format={percent}
          onChange={(intensity) => light({intensity})}
        />
        {lightSource === 'moonlight' ? (
          <>
            <Slider
              label={tr("Panes across")}
              value={lighting.window.columns}
              min={1}
              max={6}
              step={1}
              format={panes}
              onChange={(columns) => frame({columns})}
            />
            <Slider
              label={tr("Panes down")}
              value={lighting.window.rows}
              min={1}
              max={6}
              step={1}
              format={panes}
              onChange={(rows) => frame({rows})}
            />
            <Slider
              label={tr("Slant")}
              value={lighting.window.slant}
              min={-35}
              max={35}
              step={1}
              format={signedDegrees}
              onChange={(slant) => frame({slant})}
            />
            <Slider
              label={tr("Across the page")}
              value={lighting.window.x}
              min={0}
              max={1}
              step={0.01}
              format={percent}
              onChange={(x) => frame({x})}
            />
            <Slider
              label={tr("Down the page")}
              value={lighting.window.y}
              min={0}
              max={1}
              step={0.01}
              format={percent}
              onChange={(y) => frame({y})}
            />
          </>
        ) : (
          <>
            <Slider
              label={tr("Beam angle")}
              value={lighting.spread}
              min={20}
              max={160}
              step={1}
              format={degrees}
              onChange={(spread) => light({spread})}
            />
            <Segmented label={tr("Beam")} value={lighting.beam} options={BEAMS} onChange={(beam) => light({beam})} />
            <Slider
              label={tr("Aim")}
              value={lighting.aim}
              min={-45}
              max={45}
              step={1}
              format={signedDegrees}
              onChange={(aim) => light({aim})}
            />
          </>
        )}
        <Slider
          label={tr("Reach")}
          value={lighting.reach}
          min={0.2}
          max={2}
          step={0.01}
          format={percent}
          onChange={(reach) => light({reach})}
        />
        <Slider
          label={tr("Softness")}
          value={lighting.softness}
          min={0}
          max={1}
          step={0.01}
          format={percent}
          onChange={(softness) => light({softness})}
        />
        <Slider
          label={tr("Dust in the beam")}
          value={lighting.particles}
          min={0}
          max={1}
          step={0.01}
          format={percent}
          onChange={(particles) => light({particles})}
        />
        <Slider
          label={tr("Film grain")}
          value={lighting.grain}
          min={0}
          max={1}
          step={0.01}
          format={percent}
          onChange={(grain) => light({grain})}
        />
      </Section>

      <Section title={tr("Typewriter")}>
        <Switch
          label={tr("Machine")}
          checked={typewriter.carriage}
          onChange={(carriage) => updateSettings({typewriter: {carriage}})}
        />
        <Switch label={tr("Sound")} checked={typewriter.sound} onChange={(sound) => updateSettings({typewriter: {sound}})} />
        <Slider
          label={tr("Volume")}
          value={typewriter.volume}
          min={0}
          max={1}
          step={0.01}
          format={percent}
          onChange={(volume) => updateSettings({typewriter: {volume}})}
        />
        <Segmented
          label={tr("Voice")}
          value={typewriter.voice}
          options={VOICES}
          onChange={(voice) => updateSettings({typewriter: {voice}})}
        />
        <Switch
          label={tr("Margin bell")}
          checked={typewriter.marginBell}
          onChange={(marginBell) => updateSettings({typewriter: {marginBell}})}
        />
      </Section>

      <Section title={tr("Press & Archive")}>
        <Switch
          label={tr("Keep printed pages")}
          checked={settings.print.keepInArchive}
          onChange={(keepInArchive) => updateSettings({print: {keepInArchive}})}
          note={tr("Printed folios are kept as plain text in the archive folder of the configuration directory, on this computer only.")}
        />
        <button type="button" className="tn-button" onClick={onPress}>{tr("Open the Press…")}</button>
      </Section>

      <Section title={tr("Quiet")}>
        <Switch label={tr("Focus mode")} checked={settings.focusMode} onChange={(focusMode) => updateSettings({focusMode})} />
        <Segmented
          label={tr("Focus background")}
          value={focus.background}
          options={FOCUS_BACKGROUNDS}
          onChange={(background) => updateSettings({focus: {background}})}
        />
        {focus.background === 'custom' ? (
          <div className="tn-row">
            <label className="tn-label" htmlFor="tn-focus-color">{tr("Colour")}</label>
            <input
              id="tn-focus-color"
              type="color"
              className="tn-color"
              value={focus.color}
              onChange={(event) => updateSettings({focus: {color: event.currentTarget.value}})}
            />
          </div>
        ) : null}
        <Switch
          label={tr("Paper in focus mode")}
          checked={focus.paper}
          onChange={(value) => updateSettings({focus: {paper: value}})}
        />
        <Switch
          label={tr("Light in focus mode")}
          checked={focus.lighting}
          onChange={(value) => updateSettings({focus: {lighting: value}})}
        />
        <Switch
          label={tr("All visual effects")}
          checked={settings.effects}
          onChange={(effects) => updateSettings({effects})}
          note={tr("Light, glow, impressions and motion sit on top of the terminal and never touch its input or output.")}
        />
        <Segmented
          label={tr("Quality")}
          value={lighting.quality}
          options={QUALITIES}
          onChange={(quality) => updateSettings({lighting: {quality}})}
        />
        <p className="tn-note">{tr("Auto leaves out the typewriter and the light on computers without a usable GPU (virtual machines, remote desktops), where they would slow the terminal down.")}</p>
        <p className="tn-note">{tr("Now drawing")}{drawing}.</p>
      </Section>
    </aside>
  );
}
