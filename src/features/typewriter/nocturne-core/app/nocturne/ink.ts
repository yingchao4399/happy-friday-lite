import {contrast, mix, toHex, parseColor} from './color';
import type {Paper} from './papers';
import type {TypographySettings} from './types';

export const INKS = {carbon: '#2a2019', brown: '#503324', blue: '#17375e', navy: '#253047', wine: '#702738', green: '#264d3c'};

/** 纸面所有渲染层共用有效墨色；自动模式只调整亮度，保留所选色相。 */
export function readableInk(color: string, paper: string, ratio = 4.5): string {
  if (contrast(color, paper) >= ratio) return color;
  const end = contrast('#000000', paper) >= contrast('#ffffff', paper) ? '#000000' : '#ffffff';
  for (let n = 1; n <= 100; n++) {
    const candidate = toHex(parseColor(mix(color, end, n / 100))!);
    if (contrast(candidate, paper) >= ratio) return candidate;
  }
  return end;
}

export function resolveInk(paper: Paper, type: TypographySettings): Paper {
  const requested = type.inkMode === 'custom' ? type.inkColor
    : type.inkMode === 'preset' ? INKS[type.inkPreset] || paper.ink : paper.ink;
  const ratio = type.minimumContrast;
  const ink = type.contrastPolicy === 'exact' ? requested : readableInk(requested, paper.paper, ratio);
  return {...paper, ink, inkMuted: readableInk(mix(ink, paper.paper, .22), paper.paper, ratio), cursor: ink};
}
