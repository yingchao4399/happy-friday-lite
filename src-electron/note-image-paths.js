import path from 'path'

export const IMAGE_RELATIVE_PREFIX = 'note-images/'

const SAFE_FILE_NAME = /^[A-Za-z0-9._-]+$/
let imageDir = null

export function setNoteImageDirectory(dataDir) {
  imageDir = dataDir ? path.join(dataDir, 'note-images') : null
}

export function getNoteImageDirectory() {
  return imageDir
}

export function getNoteImagePath(fileName) {
  if (!imageDir || !fileName || !SAFE_FILE_NAME.test(fileName)) return null
  return path.join(imageDir, fileName)
}
