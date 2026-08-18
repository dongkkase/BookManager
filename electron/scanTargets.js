import { AUDIO_EXTENSIONS } from '../src/metadata/metadataTypes.js';

export const SCAN_TARGET_EXTENSIONS = Object.freeze([
  '.zip',
  '.cbz',
  '.rar',
  '.cbr',
  '.7z',
  '.cb7',
  '.pdf',
  '.epub',
  '.txt',
  ...AUDIO_EXTENSIONS,
]);
