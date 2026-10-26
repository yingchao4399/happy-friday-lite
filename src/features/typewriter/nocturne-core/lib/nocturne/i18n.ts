import {i18n} from '@/i18n';
// 英文原词到稳定 key 的映射只作用于界面标签，不处理用户正文或终端输出。
export function tr(value: string, values: Record<string, string | number> = {}): string {
  const key = Array.from(value).map(char => char.codePointAt(0)!.toString(36)).join('_');
  const path = `typewriter.original.${key}`;
  return i18n.global.te(path) ? String(i18n.global.t(path, values)) : value;
}
