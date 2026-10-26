// IPC channel names for Nocturne settings and the Archive. Kept in a dependency-free module because
// both the main process and the renderer bundle import it.

export const CHANNELS = {
  read: 'nocturne:settings:read',
  write: 'nocturne:settings:write',
  changed: 'nocturne:settings:changed'
} as const;

export const ARCHIVE_CHANNELS = {
  list: 'typewriter-archive-list',
  save: 'typewriter-archive-save',
  remove: 'typewriter-archive-remove',
  rename: 'typewriter-archive-rename',
  exportImage: 'typewriter-archive-export-image',
  reveal: 'typewriter-archive-reveal'
} as const;
