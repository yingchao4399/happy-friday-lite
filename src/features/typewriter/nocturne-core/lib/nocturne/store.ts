// Friday 只替换设置持久化传输，原作 React 视图及引擎读取同一份状态。
import {useSyncExternalStore} from 'react';
import {defaultSettings, patchSettings, sanitizeSettings, settingsEqual} from '../../app/nocturne/settings';
import type {NocturneSettings, SettingsPatch} from '../../app/nocturne/types';

const listeners = new Set<() => void>();
let current = defaultSettings();
let persist: ((settings: NocturneSettings) => void) | null = null;
export const getSettings = () => current;
export function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}
export function setSettings(raw: NocturneSettings) {
  const next = sanitizeSettings(raw, current);
  if (settingsEqual(next, current)) return;
  current = next;
  listeners.forEach(listener => listener());
  persist?.(next);
}
export function updateSettings(patch: SettingsPatch) { setSettings(patchSettings(current, patch)); }
export function connectSettings(initial: NocturneSettings, save: (settings: NocturneSettings) => void) {
  setSettings(initial);
  persist = save;
  return () => { persist = null; };
}
export function useNocturneSettings() { return useSyncExternalStore(subscribe, getSettings); }
