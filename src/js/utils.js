export function cleanName(filename) {
  return filename.replace(/\.[^.]+$/, '').replace('-master', '')
}

export function formatSize(bytes) {
  return bytes ? `${(bytes / 1048576).toFixed(1)} MB` : ''
}
