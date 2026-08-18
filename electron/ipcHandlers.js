import pkg from 'electron';
const { ipcMain, app, BrowserWindow, dialog, shell, net, nativeImage } = pkg;
import fs from 'fs';
import path from 'path';
import os from 'os';
import crypto from 'crypto';
import https from 'https';
import http from 'http';
import { execFile, spawn } from 'child_process';
import { promisify } from 'util';

import { inspectFolderFile, scanFolder } from './tasks/folderScanTask.js';
import { analyzeOrganizerInputs, executeOrganizer } from './tasks/organizerTask.js';
import { analyzeRenamerInputs, executeRenamer, extractRenamerImage } from './tasks/renamerTask.js';
import {
  analyzeMetadataInputs,
  listMetadataEpubImages,
  loadMetadataCover,
  loadMetadataEpubImage,
  loadMetadataImageFile,
  loadLatestSeriesMetadata,
  saveMetadataItems,
} from './tasks/metadataTask.js';
import {
  getSharingNetworkAddresses,
  getSharingServerStatus,
  normalizeSharingServerType,
  normalizeSharingServerAddress,
  setSharingServerAddress,
  startSharingServer,
  stopSharingServer,
} from './servers/sharingServers.js';
import {
  createArchiveDialogOptions,
  createFolderDialogOptions,
  normalizeArchiveDialogResult,
  normalizeFileDialogResult,
  normalizeFilesDialogResult,
  normalizeFolderDialogResult,
  normalizeSaveDialogResult,
} from './dialogOptions.js';
import { TaskCancellationRegistry } from './taskCancellation.js';
import { normalizeRuntimeState } from './exitPolicy.js';
import {
  createMessageDialogOptions,
  resolveMessageDialogResponse,
} from './messageDialog.js';
import {
  createLibrarySyncDialogOptions,
  resolveLibrarySyncChoice,
} from './libraryDialog.js';
import { normalizeExternalUrl } from './externalUrlPolicy.js';
import { installAppUpdate } from './updateInstaller.js';
import {
  pathHasHiddenDirectorySegment,
  shouldSkipScanDirectoryEntry,
} from './scanExclusions.js';
import { SCAN_TARGET_EXTENSIONS } from './scanTargets.js';
import { createSoundCommand, normalizeSoundFilename } from './soundPolicy.js';
import { setLanguage, t as i18nT } from './utils/i18n.js';
import { LibraryDB } from './database/library_db.js';
import {
  LibrarySearchService,
  isRetryableLibrarySearchWorkerError,
} from './librarySearchService.js';
import { ContentIndexService } from './contentIndexService.js';
import {
  buildLibraryFolderIndexRecords,
  normalizeLibraryFolderForRenderer,
} from './libraryFolderIndex.js';
import {
  buildCsvContent,
  resolveCsvExportPath,
} from './csvExport.js';
import {
  getDefaultWindowsDriveRoot,
  listWindowsDriveRoots,
  normalizeDirectoryPathForRead,
} from './fsRoots.js';
import {
  clearApiCache,
  getCachedApiResults,
  openApiCache as openApiCacheDb,
  setCachedApiResults,
} from './database/apiCache.js';
import {
  resolveApiCoverCacheDir,
  resolveApiCacheDbPath,
  resolveAppDataDir,
  resolveContentIndexDbPath,
  resolveLibraryDbPath,
  resolveRenameHistoryPath,
  resolveThumbnailDir,
} from './dataPaths.js';
import {
  commitRenameOperation,
  executeLibraryMoveAsync,
  executeMultiRename,
  findLibraryMoveConflicts,
  removeTreeIfNoFilesAsync,
  reverseRenameMapForCompletedMoves,
  saveRenameHistoryFile,
  undoRename,
} from './fsOperations.js';
import {
  listBundledFontFaces,
  listSystemFontFamilies,
} from './fontDiscovery.js';
import {
  COVER_IDENTIFICATION_SCHEMA,
  COVER_OBSERVATION_SCHEMA,
  COVER_TITLE_PROMPT_VERSION,
  createCoverObservationPrompt,
  createCoverTitlePrompt,
  normalizeCoverConfidence,
  normalizeCoverObservation,
  normalizeCoverTitleCandidates,
  parseImageDataUrl,
  toGeminiResponseSchema,
} from './coverTitleIdentification.js';
import {
  decodeMetadataCoverDataUrl,
  defaultMetadataCoverName,
} from './metadataCoverExport.js';

const RENAMER_PREVIEW_MAX_DIMENSION = 720;
const RENAMER_PREVIEW_JPEG_QUALITY = 86;
const COVER_TITLE_THUMBNAIL_MAX_DIMENSION = 2048;
const COVER_TITLE_REQUEST_TIMEOUT = 60000;
const OPENAI_TTS_MODEL = 'gpt-4o-mini-tts';
const OPENAI_TTS_FALLBACK_MODEL = 'tts-1';
const OPENAI_TTS_INPUT_MAX_LENGTH = 4096;
const OPENAI_TTS_VOICES = new Set([
  'alloy',
  'ash',
  'ballad',
  'coral',
  'echo',
  'fable',
  'nova',
  'onyx',
  'sage',
  'shimmer',
  'verse',
  'marin',
  'cedar',
]);
const OPENAI_TTS_FALLBACK_VOICES = new Set([
  'alloy',
  'ash',
  'coral',
  'echo',
  'fable',
  'onyx',
  'nova',
  'sage',
  'shimmer',
]);
const GOOGLE_TTS_INPUT_MAX_LENGTH = 5000;
const GOOGLE_TTS_DEFAULT_VOICE = 'ko-KR';
const GOOGLE_TTS_VOICES = new Map([
  ['ko-KR', { languageCode: 'ko-KR' }],
  ['en-US', { languageCode: 'en-US' }],
  ['ja-JP', { languageCode: 'ja-JP' }],
]);
const GOOGLE_TTS_OAUTH_SCOPE = 'https://www.googleapis.com/auth/cloud-platform';
const GOOGLE_TTS_TOKEN_URI = 'https://oauth2.googleapis.com/token';
const googleTtsAccessTokenCache = new Map();

function createRenamerPreviewBuffer(buffer, entryPath) {
  try {
    if (!Buffer.isBuffer(buffer) || buffer.length === 0) return { buffer };
    if (path.extname(entryPath).toLowerCase() === '.gif') return { buffer };

    const image = nativeImage.createFromBuffer(buffer);
    if (image.isEmpty()) return { buffer };

    const size = image.getSize();
    const maxSide = Math.max(size.width || 0, size.height || 0);
    if (maxSide <= RENAMER_PREVIEW_MAX_DIMENSION) return { buffer };

    const scale = RENAMER_PREVIEW_MAX_DIMENSION / maxSide;
    const width = Math.max(1, Math.round(size.width * scale));
    const height = Math.max(1, Math.round(size.height * scale));
    const resized = image.resize({ width, height, quality: 'good' });
    const extension = path.extname(entryPath).toLowerCase();
    const encoded = ['.jpg', '.jpeg'].includes(extension)
      ? { buffer: resized.toJPEG(RENAMER_PREVIEW_JPEG_QUALITY), mime: 'image/jpeg' }
      : { buffer: resized.toPNG(), mime: 'image/png' };

    if (!Buffer.isBuffer(encoded.buffer) || encoded.buffer.length === 0) return { buffer };
    return encoded.buffer.length < buffer.length ? encoded : { buffer };
  } catch {
    return { buffer };
  }
}

function requestJson(url) {
  return new Promise((resolve, reject) => {
    const req = https.get(url, {
      headers: {
        'User-Agent': 'BookManager',
        'Accept': 'application/vnd.github+json',
      },
      timeout: 10000,
    }, (res) => {
      let body = '';
      res.setEncoding('utf8');
      res.on('data', chunk => { body += chunk; });
      res.on('end', () => {
        if (res.statusCode < 200 || res.statusCode >= 300) {
          reject(new Error(`HTTP ${res.statusCode}`));
          return;
        }
        try {
          resolve(JSON.parse(body));
        } catch (error) {
          reject(error);
        }
      });
    });
    req.on('timeout', () => req.destroy(new Error(i18nT('request_timeout'))));
    req.on('error', reject);
  });
}

function requestJsonGeneric(url, headers = {}, timeout = 12000) {
  return new Promise((resolve, reject) => {
    const target = new URL(url);
    const transport = target.protocol === 'http:' ? http : https;
    const req = transport.get(url, {
      headers: {
        'User-Agent': 'BookManager',
        'Accept': 'application/json',
        ...headers,
      },
      timeout,
    }, (res) => {
      let body = '';
      res.setEncoding('utf8');
      res.on('data', chunk => { body += chunk; });
      res.on('end', () => {
        if (res.statusCode === 429) {
          reject(new Error('RATE_LIMIT'));
          return;
        }
        if (res.statusCode < 200 || res.statusCode >= 300) {
          let apiMessage = '';
          try {
            const parsed = JSON.parse(body);
            apiMessage = parsed?.error?.message || parsed?.message || '';
          } catch {
            apiMessage = body;
          }
          apiMessage = String(apiMessage || '')
            .replace(/\bsk-(?:proj-)?[A-Za-z0-9_*\-]+\b/g, '[REDACTED]')
            .replace(/\bAIza[A-Za-z0-9_\-]+\b/g, '[REDACTED]')
            .replace(/\s+/g, ' ')
            .trim()
            .slice(0, 300);
          const error = new Error(`HTTP ${res.statusCode}${apiMessage ? `: ${apiMessage}` : ''}`);
          error.statusCode = res.statusCode;
          reject(error);
          return;
        }
        try {
          resolve(JSON.parse(body));
        } catch (error) {
          reject(error);
        }
      });
    });
    req.on('timeout', () => req.destroy(new Error(i18nT('request_timeout'))));
    req.on('error', reject);
  });
}

function resolveAppVersion() {
  const fallbackVersion = app?.getVersion?.() || '3.0.0';
  try {
    const versionPath = path.join(app.getAppPath(), 'version.json');
    const versionInfo = JSON.parse(fs.readFileSync(versionPath, 'utf8'));
    const latestVersion = String(versionInfo?.latest_version || '').trim();
    return latestVersion || fallbackVersion;
  } catch {
    return fallbackVersion;
  }
}

function requestJsonPost(url, payload = {}, extraHeaders = {}, timeout = 12000) {
  return new Promise((resolve, reject) => {
    const target = new URL(url);
    const body = JSON.stringify(payload);
    const req = https.request({
      hostname: target.hostname,
      path: `${target.pathname}${target.search}`,
      method: 'POST',
      headers: {
        'User-Agent': 'BookManager',
        'Accept': 'application/json',
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(body),
        ...extraHeaders,
      },
      timeout,
    }, (res) => {
      let responseBody = '';
      res.setEncoding('utf8');
      res.on('data', chunk => { responseBody += chunk; });
      res.on('end', () => {
        if (res.statusCode < 200 || res.statusCode >= 300) {
          let apiMessage = '';
          try {
            const parsed = JSON.parse(responseBody);
            apiMessage = parsed?.error?.message || parsed?.message || '';
          } catch {
            apiMessage = responseBody;
          }
          apiMessage = String(apiMessage || '')
            .replace(/\bsk-(?:proj-)?[A-Za-z0-9_*\-]+\b/g, '[REDACTED]')
            .replace(/\bAIza[A-Za-z0-9_\-]+\b/g, '[REDACTED]')
            .replace(/\s+/g, ' ')
            .trim()
            .slice(0, 300);
          const error = new Error(`HTTP ${res.statusCode}${apiMessage ? `: ${apiMessage}` : ''}`);
          error.statusCode = res.statusCode;
          error.responseBody = responseBody;
          reject(error);
          return;
        }
        try {
          resolve(JSON.parse(responseBody));
        } catch (error) {
          reject(error);
        }
      });
    });
    req.on('timeout', () => req.destroy(new Error(i18nT('request_timeout'))));
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

function requestFormPost(url, form = {}, extraHeaders = {}) {
  return new Promise((resolve, reject) => {
    const target = new URL(url);
    const body = new URLSearchParams(form).toString();
    const req = https.request({
      hostname: target.hostname,
      path: `${target.pathname}${target.search}`,
      method: 'POST',
      headers: {
        'User-Agent': 'BookManager',
        'Accept': 'application/json',
        'Content-Type': 'application/x-www-form-urlencoded',
        'Content-Length': Buffer.byteLength(body),
        ...extraHeaders,
      },
      timeout: 12000,
    }, (res) => {
      let responseBody = '';
      res.setEncoding('utf8');
      res.on('data', chunk => { responseBody += chunk; });
      res.on('end', () => {
        if (res.statusCode < 200 || res.statusCode >= 300) {
          let apiMessage = '';
          try {
            const parsed = JSON.parse(responseBody);
            apiMessage = parsed?.error_description || parsed?.error?.message || parsed?.error || parsed?.message || '';
          } catch {
            apiMessage = responseBody.replace(/\s+/g, ' ').trim().slice(0, 300);
          }
          const error = new Error(`HTTP ${res.statusCode}${apiMessage ? `: ${apiMessage}` : ''}`);
          error.statusCode = res.statusCode;
          error.responseBody = responseBody;
          reject(error);
          return;
        }
        try {
          resolve(JSON.parse(responseBody));
        } catch (error) {
          reject(error);
        }
      });
    });
    req.on('timeout', () => req.destroy(new Error(i18nT('request_timeout'))));
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

function requestBufferPost(url, payload = {}, extraHeaders = {}, timeout = 30000, maxBytes = 24 * 1024 * 1024) {
  return new Promise((resolve, reject) => {
    const target = new URL(url);
    const body = JSON.stringify(payload);
    const req = https.request({
      hostname: target.hostname,
      path: `${target.pathname}${target.search}`,
      method: 'POST',
      headers: {
        'User-Agent': 'BookManager',
        'Accept': 'audio/mpeg,application/json',
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(body),
        ...extraHeaders,
      },
      timeout,
    }, (res) => {
      const chunks = [];
      let totalBytes = 0;
      const contentLength = Number(res.headers['content-length']) || 0;
      if (maxBytes > 0 && contentLength > maxBytes) {
        req.destroy(new Error('RESPONSE_TOO_LARGE'));
        return;
      }
      res.on('data', chunk => {
        totalBytes += chunk.length;
        if (maxBytes > 0 && totalBytes > maxBytes) {
          req.destroy(new Error('RESPONSE_TOO_LARGE'));
          return;
        }
        chunks.push(Buffer.from(chunk));
      });
      res.on('end', () => {
        const buffer = Buffer.concat(chunks);
        if (res.statusCode < 200 || res.statusCode >= 300) {
          let apiMessage = '';
          try {
            const parsed = JSON.parse(buffer.toString('utf8'));
            apiMessage = parsed?.error?.message || parsed?.message || '';
          } catch {
            apiMessage = buffer.toString('utf8').replace(/\s+/g, ' ').trim().slice(0, 300);
          }
          const error = new Error(`HTTP ${res.statusCode}${apiMessage ? `: ${apiMessage}` : ''}`);
          error.statusCode = res.statusCode;
          error.responseBody = buffer.toString('utf8');
          reject(error);
          return;
        }
        resolve({ buffer, contentType: res.headers['content-type'] || '' });
      });
    });
    req.on('timeout', () => req.destroy(new Error(i18nT('request_timeout'))));
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

function requestJsonWithElectronNet(url, headers = {}, timeout = 12000) {
  return new Promise((resolve, reject) => {
    const request = net.request({
      method: 'GET',
      url,
      useSessionCookies: true,
    });
    for (const [key, value] of Object.entries(headers)) {
      request.setHeader(key, value);
    }
    const timer = setTimeout(() => {
      request.abort();
      reject(new Error(i18nT('request_timeout')));
    }, timeout);
    let body = '';
    request.on('response', (response) => {
      response.on('data', chunk => { body += chunk.toString(); });
      response.on('end', () => {
        clearTimeout(timer);
        if (response.statusCode === 429) {
          reject(new Error('RATE_LIMIT'));
          return;
        }
        if (response.statusCode < 200 || response.statusCode >= 300) {
          reject(new Error(`HTTP ${response.statusCode}`));
          return;
        }
        try {
          resolve(JSON.parse(body));
        } catch (error) {
          reject(error);
        }
      });
    });
    request.on('error', (error) => {
      clearTimeout(timer);
      reject(error);
    });
    request.end();
  });
}

function requestTextWithElectronNet(url, headers = {}, timeout = 12000) {
  return new Promise((resolve, reject) => {
    const request = net.request({
      method: 'GET',
      url,
      useSessionCookies: true,
    });
    for (const [key, value] of Object.entries(headers)) {
      request.setHeader(key, value);
    }
    const timer = setTimeout(() => {
      request.abort();
      reject(new Error(i18nT('request_timeout')));
    }, timeout);
    let body = '';
    request.on('response', (response) => {
      response.on('data', chunk => { body += chunk.toString(); });
      response.on('end', () => {
        clearTimeout(timer);
        if (response.statusCode < 200 || response.statusCode >= 300) {
          reject(new Error(`HTTP ${response.statusCode}`));
          return;
        }
        resolve(body);
      });
    });
    request.on('error', (error) => {
      clearTimeout(timer);
      reject(error);
    });
    request.end();
  });
}

function requestTextGeneric(url, headers = {}, timeout = 12000, redirects = 3) {
  return new Promise((resolve, reject) => {
    const target = new URL(url);
    const transport = target.protocol === 'http:' ? http : https;
    const req = transport.get(url, {
      headers: {
        'User-Agent': 'BookManager',
        'Accept': 'text/html, text/plain, */*',
        ...headers,
      },
      timeout,
    }, (res) => {
      let body = '';
      res.setEncoding('utf8');
      res.on('data', chunk => { body += chunk; });
      res.on('end', () => {
        if ([301, 302, 303, 307, 308].includes(res.statusCode) && res.headers.location && redirects > 0) {
          const nextUrl = new URL(res.headers.location, url).toString();
          requestTextGeneric(nextUrl, headers, timeout, redirects - 1).then(resolve, reject);
          return;
        }
        if (res.statusCode < 200 || res.statusCode >= 300) {
          reject(new Error(`HTTP ${res.statusCode}`));
          return;
        }
        resolve(body);
      });
    });
    req.on('timeout', () => req.destroy(new Error(i18nT('request_timeout'))));
    req.on('error', reject);
  });
}

function requestBufferGeneric(url, headers = {}, timeout = 12000, redirects = 3, maxBytes = 12 * 1024 * 1024) {
  return new Promise((resolve, reject) => {
    const target = new URL(url);
    const transport = target.protocol === 'http:' ? http : https;
    let settled = false;
    const fail = (error) => {
      if (settled) return;
      settled = true;
      reject(error);
    };
    const req = transport.get(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 BookManager',
        'Accept': 'image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8',
        ...headers,
      },
      timeout,
    }, (res) => {
      const chunks = [];
      let totalBytes = 0;
      const contentLength = Number(res.headers['content-length']) || 0;
      if (maxBytes > 0 && contentLength > maxBytes) {
        req.destroy(new Error('IMAGE_TOO_LARGE'));
        return;
      }
      res.on('data', chunk => {
        totalBytes += chunk.length;
        if (maxBytes > 0 && totalBytes > maxBytes) {
          req.destroy(new Error('IMAGE_TOO_LARGE'));
          return;
        }
        chunks.push(Buffer.from(chunk));
      });
      res.on('end', () => {
        if (settled) return;
        if ([301, 302, 303, 307, 308].includes(res.statusCode) && res.headers.location && redirects > 0) {
          const nextUrl = new URL(res.headers.location, url).toString();
          requestBufferGeneric(nextUrl, headers, timeout, redirects - 1, maxBytes).then(resolve, reject);
          return;
        }
        if (res.statusCode < 200 || res.statusCode >= 300) {
          fail(new Error(`HTTP ${res.statusCode}`));
          return;
        }
        settled = true;
        resolve({ buffer: Buffer.concat(chunks), contentType: res.headers['content-type'] || '' });
      });
    });
    req.on('timeout', () => req.destroy(new Error(i18nT('request_timeout'))));
    req.on('error', fail);
  });
}

function stripHtml(value = '') {
  return String(value)
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .trim();
}

function normalizeSearchResult(raw = {}, id = '') {
  const metadata = {
    Title: raw.Title || '',
    Series: raw.Series || raw.Title || '',
    SeriesGroup: raw.SeriesGroup || '',
    Count: raw.Count || '',
    Volume: raw.Volume || '',
    Number: raw.Number || '',
    PageCount: raw.PageCount || '',
    Summary: raw.Summary || '',
    Writer: raw.Writer || '',
    Penciller: raw.Penciller || '',
    Inker: raw.Inker || '',
    Colorist: raw.Colorist || '',
    Letterer: raw.Letterer || '',
    CoverArtist: raw.CoverArtist || '',
    Editor: raw.Editor || '',
    Publisher: raw.Publisher || '',
    Imprint: raw.Imprint || '',
    ISBN: raw.ISBN || raw.isbn || '',
    Web: raw.Web || '',
    Format: raw.Format || 'Manga',
    Year: raw.Year || '',
    Month: raw.Month || '',
    Day: raw.Day || '',
    Genre: raw.Genre || '',
    Tags: raw.Tags || '',
    Characters: raw.Characters || '',
    AgeRating: raw.AgeRating || '',
    CommunityRating: raw.CommunityRating || '',
    LanguageISO: raw.LanguageISO || '',
    Manga: raw.Manga || '',
    Notes: raw.Notes || '',
  };

  return {
    ...raw,
    id: id || raw.b_id || raw.ID || raw.Web || raw.Title,
    title: raw.Title || '',
    author: raw.Writer || raw.Penciller || '',
    publisher: raw.Publisher || '',
    isbn: raw.ISBN || raw.isbn || '',
    coverUrl: raw.CoverUrl || '',
    summary: raw.Summary || '',
    tags: raw.Tags || raw.Genre || '',
    link: raw.Web || '',
    rating: raw.RatingScore || raw.CommunityRating || '',
    metadata,
  };
}

const ridiPublishDateCache = new Map();
const ridiBookDetailCache = new Map();
const googleBooksRatingCache = new Map();
const metadataTranslationCache = new Map();
const coverTitleIdentificationCache = new Map();

function metadataSearchLog(stage, details = {}) {
  const safeDetails = Object.fromEntries(
    Object.entries(details).filter(([key]) => !/key|token|image|base64/i.test(key))
  );
  console.log(`[MetadataSearch] ${stage}`, safeDetails);
}

function parseAiJson(content = '') {
  const clean = String(content || '').replace(/^```(?:json)?\s*|\s*```$/gi, '').trim();
  try {
    return JSON.parse(clean);
  } catch {
    const objectText = clean.match(/\{[\s\S]*\}/)?.[0];
    if (!objectText) return null;
    try {
      return JSON.parse(objectText);
    } catch {
      return null;
    }
  }
}

function createCoverTitleThumbnail(imageDataUrl = '') {
  const parsed = parseImageDataUrl(imageDataUrl);
  if (!parsed) throw Object.assign(new Error(i18nT('api_cover_title_image_missing')), { userFacing: true });

  const image = nativeImage.createFromDataURL(`data:${parsed.mimeType};base64,${parsed.data}`);
  if (image.isEmpty()) throw Object.assign(new Error(i18nT('api_cover_title_image_missing')), { userFacing: true });
  const size = image.getSize();
  const maxDimension = Math.max(size.width || 0, size.height || 0);
  const scale = maxDimension > COVER_TITLE_THUMBNAIL_MAX_DIMENSION
    ? COVER_TITLE_THUMBNAIL_MAX_DIMENSION / maxDimension
    : 1;
  const thumbnail = scale < 1
    ? image.resize({
        width: Math.max(1, Math.round(size.width * scale)),
        height: Math.max(1, Math.round(size.height * scale)),
        quality: 'best',
      })
    : image;
  const buffer = thumbnail.toPNG();
  if (!buffer.length) throw Object.assign(new Error(i18nT('api_cover_title_image_missing')), { userFacing: true });

  return {
    mimeType: 'image/png',
    data: buffer.toString('base64'),
    dataUrl: `data:image/png;base64,${buffer.toString('base64')}`,
    hash: crypto.createHash('sha256').update(buffer).digest('hex'),
  };
}

function rememberCoverTitleIdentification(cacheKey, result) {
  coverTitleIdentificationCache.delete(cacheKey);
  coverTitleIdentificationCache.set(cacheKey, result);
  while (coverTitleIdentificationCache.size > 64) {
    coverTitleIdentificationCache.delete(coverTitleIdentificationCache.keys().next().value);
  }
}

function coverAiCredential(apiKeys = {}, provider = 'Gemini') {
  const providerKey = provider === 'OpenAI'
    ? apiKeys.ai_openai_key
    : apiKeys.ai_gemini_key;
  return String(providerKey || apiKeys.ai_key || '').trim();
}

function coverAiModel(apiKeys = {}, provider = 'Gemini') {
  const providerModel = provider === 'OpenAI'
    ? apiKeys.ai_openai_model
    : apiKeys.ai_gemini_model;
  const fallback = provider === 'OpenAI' ? 'gpt-4.1-mini' : 'gemini-2.5-flash';
  return String(providerModel || apiKeys.ai_model || fallback).trim();
}

function openAiResponseText(data = {}) {
  if (typeof data.output_text === 'string' && data.output_text.trim()) return data.output_text;
  return (Array.isArray(data.output) ? data.output : [])
    .flatMap(item => Array.isArray(item?.content) ? item.content : [])
    .filter(item => item?.type === 'output_text' || item?.type === 'text')
    .map(item => String(item?.text || ''))
    .filter(Boolean)
    .join('\n');
}

function geminiResponseText(data = {}) {
  return (Array.isArray(data.candidates) ? data.candidates : [])
    .flatMap(candidate => Array.isArray(candidate?.content?.parts) ? candidate.content.parts : [])
    .map(part => String(part?.text || ''))
    .filter(Boolean)
    .join('\n');
}

function normalizeCoverSources(values = []) {
  const seen = new Set();
  const result = [];
  for (const value of values) {
    const url = String(value?.url || value?.uri || '').trim();
    if (!/^https?:\/\//i.test(url) || seen.has(url)) continue;
    seen.add(url);
    result.push({
      title: String(value?.title || '').replace(/\s+/g, ' ').trim().slice(0, 180),
      url,
    });
    if (result.length >= 8) break;
  }
  return result;
}

function openAiGroundingInfo(data = {}) {
  const sources = [];
  let searched = false;
  for (const output of Array.isArray(data.output) ? data.output : []) {
    if (output?.type === 'web_search_call') {
      searched = output.status === 'completed' || searched;
      sources.push(...(Array.isArray(output?.action?.sources) ? output.action.sources : []));
    }
    for (const content of Array.isArray(output?.content) ? output.content : []) {
      for (const annotation of Array.isArray(content?.annotations) ? content.annotations : []) {
        if (annotation?.type === 'url_citation') sources.push(annotation);
      }
    }
  }
  const normalizedSources = normalizeCoverSources(sources);
  return {
    searched: searched || normalizedSources.length > 0,
    sources: normalizedSources,
  };
}

function geminiGroundingInfo(data = {}) {
  const sources = [];
  let searched = false;
  for (const candidate of Array.isArray(data.candidates) ? data.candidates : []) {
    const grounding = candidate?.groundingMetadata || {};
    if (Array.isArray(grounding.webSearchQueries) && grounding.webSearchQueries.length > 0) searched = true;
    for (const chunk of Array.isArray(grounding.groundingChunks) ? grounding.groundingChunks : []) {
      if (chunk?.web) sources.push(chunk.web);
    }
  }
  const normalizedSources = normalizeCoverSources(sources);
  return {
    searched: searched || normalizedSources.length > 0,
    sources: normalizedSources,
  };
}

async function observeCoverWithOpenAi(thumbnail, model, apiKey) {
  const data = await requestJsonPost('https://api.openai.com/v1/responses', {
    model,
    input: [
      {
        role: 'system',
        content: 'Extract visible cover evidence precisely. Do not invent publication data.',
      },
      {
        role: 'user',
        content: [
          { type: 'input_text', text: createCoverObservationPrompt() },
          { type: 'input_image', image_url: thumbnail.dataUrl, detail: 'auto' },
        ],
      },
    ],
    text: {
      format: {
        type: 'json_schema',
        name: 'cover_observation',
        strict: true,
        schema: COVER_OBSERVATION_SCHEMA,
      },
    },
    max_output_tokens: 1400,
  }, {
    Authorization: `Bearer ${apiKey}`,
  }, COVER_TITLE_REQUEST_TIMEOUT);
  return normalizeCoverObservation(parseAiJson(openAiResponseText(data)) || {});
}

async function verifyCoverWithOpenAi(observation, model, apiKey) {
  const data = await requestJsonPost('https://api.openai.com/v1/responses', {
    model,
    tools: [{ type: 'web_search' }],
    tool_choice: 'required',
    include: ['web_search_call.action.sources'],
    input: [
      {
        role: 'system',
        content: 'Use web search to verify the exact publication identity. Return precise structured data and never invent localized titles.',
      },
      {
        role: 'user',
        content: createCoverTitlePrompt(observation),
      },
    ],
    text: {
      format: {
        type: 'json_schema',
        name: 'cover_title_identification',
        strict: true,
        schema: COVER_IDENTIFICATION_SCHEMA,
      },
    },
    max_output_tokens: 1800,
  }, {
    Authorization: `Bearer ${apiKey}`,
  }, COVER_TITLE_REQUEST_TIMEOUT);
  return {
    parsed: parseAiJson(openAiResponseText(data)),
    grounding: openAiGroundingInfo(data),
  };
}

async function observeCoverWithGemini(thumbnail, model, apiKey) {
  const data = await requestJsonPost(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(apiKey)}`, {
    systemInstruction: {
      parts: [{ text: 'Extract visible cover evidence precisely. Do not invent publication data.' }],
    },
    contents: [{
      role: 'user',
      parts: [
        { text: createCoverObservationPrompt() },
        { inline_data: { mime_type: thumbnail.mimeType, data: thumbnail.data } },
      ],
    }],
    generationConfig: {
      temperature: 0.1,
      responseMimeType: 'application/json',
      responseSchema: toGeminiResponseSchema(COVER_OBSERVATION_SCHEMA),
    },
  }, {}, COVER_TITLE_REQUEST_TIMEOUT);
  return normalizeCoverObservation(parseAiJson(geminiResponseText(data)) || {});
}

async function verifyCoverWithGemini(observation, model, apiKey) {
  const data = await requestJsonPost(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(apiKey)}`, {
    systemInstruction: {
      parts: [{ text: 'Use Google Search to verify the exact publication identity. Return a precise JSON object and never invent localized titles.' }],
    },
    contents: [{
      role: 'user',
      parts: [{ text: createCoverTitlePrompt(observation) }],
    }],
    tools: [{ google_search: {} }],
    generationConfig: {
      temperature: 0.1,
    },
  }, {}, COVER_TITLE_REQUEST_TIMEOUT);
  return {
    parsed: parseAiJson(geminiResponseText(data)),
    grounding: geminiGroundingInfo(data),
  };
}

async function identifyCoverTitlesFromImage(imageDataUrl = '', apiKeys = {}) {
  const provider = apiKeys.ai_provider === 'OpenAI' ? 'OpenAI' : 'Gemini';
  const apiKey = coverAiCredential(apiKeys, provider);
  if (!apiKey) {
    throw Object.assign(new Error(i18nT('api_cover_title_key_missing', { provider })), { userFacing: true });
  }

  const thumbnail = createCoverTitleThumbnail(imageDataUrl);
  const model = coverAiModel(apiKeys, provider);
  const cacheKey = `${provider}:${model}:${COVER_TITLE_PROMPT_VERSION}:${thumbnail.hash}`;
  if (coverTitleIdentificationCache.has(cacheKey)) {
    return coverTitleIdentificationCache.get(cacheKey);
  }

  const observation = provider === 'OpenAI'
    ? await observeCoverWithOpenAi(thumbnail, model, apiKey)
    : await observeCoverWithGemini(thumbnail, model, apiKey);
  const verification = provider === 'OpenAI'
    ? await verifyCoverWithOpenAi(observation, model, apiKey)
    : await verifyCoverWithGemini(observation, model, apiKey);
  const parsed = verification.parsed;

  const candidates = normalizeCoverTitleCandidates(parsed);
  if (candidates.length === 0) {
    throw Object.assign(new Error(i18nT('api_cover_title_not_found')), { userFacing: true });
  }
  if (!verification.grounding.searched) {
    throw Object.assign(new Error(i18nT('api_cover_title_verification_failed')), { userFacing: true });
  }
  const result = {
    candidates,
    provider,
    model,
    confidence: normalizeCoverConfidence(parsed?.confidence),
    verified: true,
    sources: verification.grounding.sources,
  };
  rememberCoverTitleIdentification(cacheKey, result);
  return result;
}

const TRANSLATABLE_METADATA_FIELDS = [
  'Title',
  'LocalizedSeries',
  'Writer',
  'Penciller',
  'Publisher',
  'Genre',
  'Tags',
  'Summary',
  'Characters',
];

function metadataFieldValue(result = {}, field = '') {
  const aliases = {
    Title: ['Title', 'title'],
    LocalizedSeries: ['LocalizedSeries', 'Series'],
    Writer: ['Writer', 'author'],
    Penciller: ['Penciller'],
    Publisher: ['Publisher', 'publisher'],
    Genre: ['Genre'],
    Tags: ['Tags', 'tags'],
    Summary: ['Summary', 'summary'],
    Characters: ['Characters'],
  };
  for (const key of aliases[field] || [field]) {
    const value = result?.metadata?.[key] ?? result?.[key];
    if (value !== undefined && value !== null && String(value).trim() && String(value).trim() !== '-') {
      return Array.isArray(value) ? value.join(', ') : String(value);
    }
  }
  return '';
}

async function translateTextWithGoogle(text = '', targetLang = 'ko') {
  const source = String(text || '').trim();
  if (!source) return source;
  const params = new URLSearchParams({
    client: 'gtx',
    sl: 'auto',
    tl: targetLang,
    dt: 't',
    q: source,
  });
  const data = await requestJsonGeneric(`https://translate.googleapis.com/translate_a/single?${params.toString()}`, {}, 10000);
  return Array.isArray(data?.[0])
    ? data[0].map(part => Array.isArray(part) ? part[0] || '' : '').join('')
    : source;
}

async function translateMetadataResult(result = {}, apiKeys = {}, targetLang = 'ko') {
  const language = ['ko', 'en', 'ja'].includes(targetLang) ? targetLang : 'ko';
  const sourceFields = Object.fromEntries(
    TRANSLATABLE_METADATA_FIELDS
      .map(field => [field, metadataFieldValue(result, field)])
      .filter(([, value]) => value)
  );
  if (Object.keys(sourceFields).length === 0) return result;

  const cacheKey = `${language}:${JSON.stringify(sourceFields)}`;
  const cachedFields = metadataTranslationCache.get(cacheKey);

  const aiProvider = apiKeys.ai_provider === 'OpenAI' ? 'OpenAI' : 'Gemini';
  const aiKey = coverAiCredential(apiKeys, aiProvider);
  const languageNames = { ko: 'Korean', en: 'English', ja: 'Japanese' };
  const prompt = [
    'You are an expert translator specializing in comic books, manga, and graphic novels.',
    `Translate every value in the supplied JSON object into natural ${languageNames[language]}.`,
    'Use terminology commonly used by comic and manga publishers.',
    'Treat Summary as a synopsis, Genre and Tags as category terms, and Characters and creator fields as proper names.',
    'Preserve every JSON key exactly and return only a valid JSON object.',
  ].join(' ');

  let translatedFields = cachedFields || null;
  if (!translatedFields && aiKey) {
    try {
      if (aiProvider === 'OpenAI') {
        const data = await requestJsonPost('https://api.openai.com/v1/chat/completions', {
          model: coverAiModel(apiKeys, aiProvider),
          response_format: { type: 'json_object' },
          messages: [
            { role: 'system', content: prompt },
            { role: 'user', content: JSON.stringify(sourceFields) },
          ],
          temperature: 0.3,
        }, {
          Authorization: `Bearer ${aiKey}`,
        });
        translatedFields = parseAiJson(data.choices?.[0]?.message?.content);
      } else {
        const model = coverAiModel(apiKeys, aiProvider);
        const data = await requestJsonPost(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(aiKey)}`, {
          systemInstruction: { parts: [{ text: prompt }] },
          contents: [{ role: 'user', parts: [{ text: JSON.stringify(sourceFields) }] }],
          generationConfig: { temperature: 0.3, responseMimeType: 'application/json' },
        });
        translatedFields = parseAiJson(data.candidates?.[0]?.content?.parts?.[0]?.text);
      }
    } catch (error) {
      metadataSearchLog('Metadata AI translation failed; using fallback', {
        provider: aiProvider,
        targetLang: language,
        error: error.message,
      });
    }
  }

  if (!translatedFields || typeof translatedFields !== 'object') translatedFields = {};
  for (const [field, original] of Object.entries(sourceFields)) {
    if (String(translatedFields[field] || '').trim()) continue;
    try {
      translatedFields[field] = await translateTextWithGoogle(original, language);
    } catch {
      translatedFields[field] = original;
    }
  }

  const metadata = {
    ...(result.metadata || {}),
    ...Object.fromEntries(
      Object.entries(translatedFields)
        .filter(([field, value]) => TRANSLATABLE_METADATA_FIELDS.includes(field) && String(value || '').trim())
    ),
  };
  if (translatedFields.LocalizedSeries) metadata.Series = translatedFields.LocalizedSeries;
  const translated = {
    ...result,
    ...translatedFields,
    title: translatedFields.Title || result.title,
    author: translatedFields.Writer || result.author,
    publisher: translatedFields.Publisher || result.publisher,
    summary: translatedFields.Summary || result.summary,
    tags: translatedFields.Tags || result.tags,
    metadata,
    translated: true,
    translationLanguage: language,
  };
  metadataTranslationCache.set(cacheKey, translatedFields);
  return translated;
}

function aiProviderError(provider, error) {
    const message = String(error?.message || error || '');
    if (/\b401\b|incorrect api key|api key not valid|invalid.*key/i.test(message)) {
        return i18nT('api_provider_invalid_key', { provider });
    }
    if (/\b429\b|rate.?limit|quota/i.test(message)) {
        return i18nT('api_provider_quota', { provider });
    }
    if (/\b503\b|high demand|overloaded/i.test(message)) {
        return i18nT('api_provider_overloaded', { provider });
    }
    if (/\b(500|502|504)\b/i.test(message)) {
        return i18nT('api_provider_server_error', { provider });
    }
    return i18nT('api_provider_identify_failed', {
        provider,
        msg: message || i18nT('api_response_unhandled'),
    });
}

function parseDateParts(value = '') {
  const match = String(value).match(/(\d{4})(?:[^\d]+(\d{1,2}))?(?:[^\d]+(\d{1,2}))?/);
  return {
    Year: match?.[1] || '',
    Month: match?.[2] ? String(Number(match[2])) : '',
    Day: match?.[3] ? String(Number(match[3])) : '',
  };
}

function formatParsedDate(value = '') {
  const parts = parseDateParts(value);
  if (!parts.Year) return '';
  return parts.Month
    ? `${parts.Year}-${parts.Month.padStart(2, '0')}${parts.Day ? `-${parts.Day.padStart(2, '0')}` : ''}`
    : parts.Year;
}

function ridiBookHeaders() {
  return {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
    'Accept-Language': 'ko-KR,ko;q=0.9,en-US;q=0.8',
    'Referer': 'https://ridibooks.com/',
  };
}

async function fetchRidiBookHtml(bookId = '') {
  const id = String(bookId || '').trim();
  if (!/^\d+$/.test(id)) return '';
  const url = `https://ridibooks.com/books/${id}`;
  const headers = ridiBookHeaders();
  try {
    return await requestTextWithElectronNet(url, headers, 10000);
  } catch {
    try {
      return await requestTextGeneric(url, headers, 10000);
    } catch {
      return '';
    }
  }
}

function findJsonValueByKey(value, keys = [], depth = 0) {
  if (!value || depth > 6) return '';
  if (Array.isArray(value)) {
    for (const item of value) {
      const found = findJsonValueByKey(item, keys, depth + 1);
      if (found) return found;
    }
    return '';
  }
  if (typeof value !== 'object') return '';

  const normalizedKeys = new Set(keys.map(key => String(key).toLowerCase()));
  for (const [key, entry] of Object.entries(value)) {
    if (normalizedKeys.has(String(key).toLowerCase()) && entry !== undefined && entry !== null && typeof entry !== 'object') {
      return String(entry);
    }
  }
  for (const entry of Object.values(value)) {
    const found = findJsonValueByKey(entry, keys, depth + 1);
    if (found) return found;
  }
  return '';
}

function extractRidiBookDetail(html = '') {
  const detail = {
    ISBN: '',
    PubDate: '',
    Year: '',
    Month: '',
    Day: '',
  };

  for (const json of extractJsonLdObjects(html)) {
    const graph = Array.isArray(json?.['@graph']) ? json['@graph'] : [json];
    const datePublished = graph.find(entry => entry?.datePublished)?.datePublished || findJsonValueByKey(graph, ['datePublished']);
    if (datePublished) {
      detail.PubDate = formatParsedDate(datePublished);
    }
    const isbn = normalizeIsbn(findJsonValueByKey(graph, ['isbn', 'isbn13', 'isbn10']));
    if (isbn) {
      detail.ISBN = isbn;
    }
    if (detail.PubDate && detail.ISBN) break;
  }

  const cleanHtml = decodeHtmlEntities(html);
  const plain = stripHtml(cleanHtml).replace(/\s+/g, ' ').trim();
  if (!detail.PubDate) {
    const dateMatch =
      plain.match(/출간(?:일|일자)?\s*[:：]?\s*(\d{4}\s*[./-]\s*\d{1,2}\s*[./-]\s*\d{1,2})/i)
      || plain.match(/(\d{4}\s*[./-]\s*\d{1,2}\s*[./-]\s*\d{1,2})(?:\s|.){0,16}출간/i);
    detail.PubDate = formatParsedDate(dateMatch?.[1] || '');
  }
  if (!detail.ISBN) {
    const isbnMatch =
      plain.match(/(?:ISBN(?:-1[03])?|전자책\s*ISBN|종이책\s*ISBN)\s*[:：]?\s*([0-9A-Za-z][0-9A-Za-z -]{6,30})/i)
      || cleanHtml.match(/"isbn"\s*:\s*"([^"]+)"/i);
    detail.ISBN = normalizeIsbn(isbnMatch?.[1] || '');
  }

  const date = parseDateParts(detail.PubDate);
  detail.Year = date.Year;
  detail.Month = date.Month;
  detail.Day = date.Day;
  return detail;
}

async function getRidiBookDetail(bookId = '') {
  const id = String(bookId || '').trim();
  if (!/^\d+$/.test(id)) return {};
  if (ridiBookDetailCache.has(id)) return ridiBookDetailCache.get(id);

  const html = await fetchRidiBookHtml(id);
  if (!html) return {};
  const detail = extractRidiBookDetail(html);
  if (detail.PubDate) ridiPublishDateCache.set(id, detail.PubDate);
  ridiBookDetailCache.set(id, detail);
  return detail;
}

async function getRidiPublishDate(bookId = '') {
  const id = String(bookId || '').trim();
  if (!/^\d+$/.test(id)) return '';
  if (ridiPublishDateCache.has(id)) return ridiPublishDateCache.get(id);
  const detail = await getRidiBookDetail(id);
  return detail.PubDate || '';
}

function normalizeApiSource(apiName = '') {
  const name = String(apiName).toLowerCase();
  if (name.includes('google')) return 'Google Books';
  if (name.includes('anilist')) return 'Anilist';
  if (name.includes('amazon') || name.includes('아마존')) return 'Amazon';
  if (name.includes('알라딘') || name.includes('aladin')) return '알라딘';
  if (name.includes('vine')) return 'Vine';
  return '리디북스';
}

function normalizeSearchBookType(value = '') {
  const raw = String(value || '').trim().toLowerCase();
  if (raw === 'pdf') return 'pdf';
  if (['audio', 'audiobook', 'audio-book'].includes(raw)) return 'audio';
  return ['book', 'document', 'novel', 'epub', 'txt'].includes(raw) ? 'book' : 'comic';
}

function metadataFormatForBookType(bookType = 'comic') {
  if (bookType === 'pdf') return 'PDF';
  if (bookType === 'audio') return 'Audiobook';
  return bookType === 'book' ? 'Novel' : 'Manga';
}

function mangaValueForBookType(bookType = 'comic') {
  return bookType === 'comic' ? 'YesAndRightToLeft' : '';
}

function isMetadataApiAllowedForBookType(apiName = '', bookType = 'comic') {
  const allowed = bookType === 'book' || bookType === 'pdf' || bookType === 'audio'
    ? new Set(['리디북스', '알라딘', 'Google Books', 'Amazon'])
    : new Set(['리디북스', '알라딘', 'Google Books', 'Anilist', 'Vine']);
  return allowed.has(apiName);
}

function pickBookIsbn(identifiers = []) {
  if (!Array.isArray(identifiers)) return '';
  const isbn13 = identifiers.find(item => String(item?.type || '').toUpperCase() === 'ISBN_13')?.identifier;
  const isbn10 = identifiers.find(item => String(item?.type || '').toUpperCase() === 'ISBN_10')?.identifier;
  return String(isbn13 || isbn10 || '').trim();
}

function normalizeIsbn(value = '') {
  return String(value || '')
    .replace(/(?:ISBN(?:-1[03])?|ASIN)\s*[:：]?\s*/gi, '')
    .replace(/[^0-9A-Za-z-]/g, '')
    .trim();
}

function normalizeStarRating(value = '') {
  const match = String(value || '').replace(',', '.').match(/\b([0-5](?:\.\d+)?)\b/);
  if (!match) return '';
  const number = Number(match[1]);
  if (!Number.isFinite(number) || number < 0 || number > 5) return '';
  return String(number);
}

function extractGoogleBooksStarRating(html = '') {
  const source = String(html || '');
  const itempropMatch = /\bitemprop=["']starRating["']/i.exec(source);
  if (!itempropMatch) return '';
  const chunk = decodeHtmlEntities(source.slice(
    Math.max(0, itempropMatch.index - 800),
    itempropMatch.index + 3000,
  ));
  const patterns = [
    /\bitemprop=["']ratingValue["'][^>]*(?:content|value)=["']([^"']+)["']/i,
    /별표\s*5\s*개\s*만점에\s*([0-5](?:[.,]\d+)?)\s*개/i,
    /만점에\s*([0-5](?:[.,]\d+)?)\s*개/i,
    />\s*([0-5](?:[.,]\d+)?)\s*<i\b[^>]*>\s*star\s*<\/i>/i,
    /\b(?:content|value|aria-label|title)=["'][^"']*?([0-5](?:[.,]\d+)?)\s*(?:\/\s*5|out\s+of\s+5|stars?|점|개)?[^"']*["']/i,
    /([0-5](?:[.,]\d+)?)\s*(?:\/\s*5|out\s+of\s+5|stars?|점|개)/i,
  ];
  for (const pattern of patterns) {
    const rating = normalizeStarRating(chunk.match(pattern)?.[1] || '');
    if (rating) return rating;
  }
  return '';
}

async function fetchGoogleBooksStarRating(url = '') {
  const targetUrl = String(url || '').trim();
  if (!/^https?:\/\//i.test(targetUrl)) return '';
  if (googleBooksRatingCache.has(targetUrl)) return googleBooksRatingCache.get(targetUrl);
  const headers = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
    'Accept-Language': 'ko-KR,ko;q=0.9,en-US;q=0.8',
    'Referer': 'https://books.google.com/',
  };
  let html = '';
  try {
    html = await requestTextWithElectronNet(targetUrl, headers, 10000);
  } catch {
    try {
      html = await requestTextGeneric(targetUrl, headers, 10000);
    } catch {
      googleBooksRatingCache.set(targetUrl, '');
      return '';
    }
  }
  const rating = extractGoogleBooksStarRating(html);
  if (googleBooksRatingCache.size > 300) googleBooksRatingCache.clear();
  googleBooksRatingCache.set(targetUrl, rating);
  return rating;
}

async function enrichGoogleBooksRatings(results = []) {
  if (!Array.isArray(results) || results.length === 0) return results;
  const next = results.map(item => ({ ...item }));
  let cursor = 0;
  const worker = async () => {
    while (cursor < next.length) {
      const index = cursor;
      cursor += 1;
      const item = next[index];
      if (item?.metadata?.CommunityRating || item?.CommunityRating || item?.rating) continue;
      const urls = [
        ...(Array.isArray(item.GoogleDetailUrls) ? item.GoogleDetailUrls : []),
        item.link,
        item.Web,
      ].filter((url, urlIndex, values) => url && values.indexOf(url) === urlIndex);
      let rating = '';
      for (const url of urls) {
        rating = await fetchGoogleBooksStarRating(url);
        if (rating) break;
      }
      if (!rating) continue;
      next[index] = {
        ...item,
        Rating: `${rating} / 5.0`,
        RatingScore: rating,
        CommunityRating: rating,
        rating,
        metadata: {
          ...(item.metadata || {}),
          CommunityRating: rating,
        },
      };
    }
  };
  await Promise.all(Array.from({ length: Math.min(4, next.length) }, worker));
  return next;
}

async function searchGoogleBooks(query, apiKey = '', page = 1, bookType = 'comic') {
  const startIndex = Math.max(0, (Number(page) || 1) - 1) * 20;
  const params = new URLSearchParams({
    q: query,
    startIndex: String(startIndex),
    maxResults: '20',
  });
  if (apiKey) params.set('key', apiKey);
  let data;
  try {
    data = await requestJsonGeneric(`https://www.googleapis.com/books/v1/volumes?${params.toString()}`);
  } catch (error) {
    if (/api key expired/i.test(String(error?.message || ''))) {
      throw new Error(i18nT('api_google_books_key_expired'));
    }
    throw error;
  }
  const results = (data.items || []).map(item => {
    const info = item.volumeInfo || {};
    const date = parseDateParts(info.publishedDate || '');
    const categories = (info.categories || []).join(', ');
    const isbn = pickBookIsbn(info.industryIdentifiers || []);
    const ratingScore = info.averageRating ? String(info.averageRating) : '';
    const raw = {
      Title: info.title || '',
      Writer: (info.authors || []).join(', '),
      Publisher: info.publisher || '',
      ISBN: isbn,
      Summary: stripHtml(info.description || ''),
      Series: info.title || '',
      Web: info.infoLink || '',
      GoogleDetailUrls: [`https://books.google.com/books?id=${encodeURIComponent(item.id || '')}`, info.infoLink, info.previewLink, info.canonicalVolumeLink].filter(Boolean),
      CoverUrl: (info.imageLinks?.thumbnail || info.imageLinks?.smallThumbnail || '').replace(/^http:/, 'https:'),
      Tags: categories,
      Genre: categories,
      LocalizedSeries: info.title || '',
      Count: '',
      Rating: ratingScore ? `${ratingScore} / 5.0` : '-',
      RatingScore: ratingScore,
      CommunityRating: ratingScore,
      AgeRating: '',
      PubDate: info.publishedDate || '',
      Format: metadataFormatForBookType(bookType),
      Manga: mangaValueForBookType(bookType),
      LanguageISO: info.language || '',
      ...date,
      Volume: '',
      Number: '',
      Characters: '',
      PageCount: info.pageCount ? String(info.pageCount) : '',
    };
    return normalizeSearchResult(raw, item.id);
  });
  return enrichGoogleBooksRatings(results);
}

async function searchAnilist(query, page = 1) {
  const graphql = `query ($page: Int, $perPage: Int, $search: String) {
    Page(page: $page, perPage: $perPage) {
      media(search: $search, type: MANGA) {
        id
        title { romaji english native }
        description(asHtml: false)
        coverImage { extraLarge large }
        genres
        tags { name }
        volumes
        chapters
        averageScore
        startDate { year month day }
        staff { edges { role node { name { full } } } }
        siteUrl
      }
    }
  }`;
  const data = await requestJsonPost('https://graphql.anilist.co', {
    query: graphql,
    variables: { search: query, page: Number(page) || 1, perPage: 20 },
  });
  return (data.data?.Page?.media || []).map(item => {
    const title = item.title?.english || item.title?.romaji || item.title?.native || '';
    const writers = [];
    const artists = [];
    for (const edge of item.staff?.edges || []) {
      const role = String(edge.role || '').toLowerCase();
      const name = edge.node?.name?.full;
      if (!name) continue;
      if (role.includes('story') || role.includes('writer')) writers.push(name);
      if (role.includes('art') || role.includes('illustrator')) artists.push(name);
    }
    const tags = [...(item.genres || []), ...(item.tags || []).slice(0, 8).map(tag => tag.name)].filter(Boolean);
    const ratingScore = item.averageScore ? String(item.averageScore / 10) : '-';
    const raw = {
      Title: title,
      Writer: writers.join(', '),
      Penciller: artists.join(', '),
      Publisher: '',
      Summary: stripHtml(item.description || ''),
      Series: title,
      Web: item.siteUrl || '',
      CoverUrl: item.coverImage?.extraLarge || item.coverImage?.large || '',
      Tags: (item.tags || []).map(tag => tag.name).filter(Boolean).join(', '),
      Genre: (item.genres || []).join(', '),
      LocalizedSeries: item.title?.native || title,
      Count: item.volumes ? String(item.volumes) : (item.chapters ? String(item.chapters) : ''),
      Rating: item.averageScore ? `${ratingScore} / 10.0` : '-',
      RatingScore: ratingScore,
      CommunityRating: item.averageScore ? String(item.averageScore / 10) : '',
      AgeRating: '',
      PubDate: item.startDate?.year ? (item.startDate.month && item.startDate.day ? `${item.startDate.year}-${String(item.startDate.month).padStart(2, '0')}-${String(item.startDate.day).padStart(2, '0')}` : String(item.startDate.year)) : '',
      Year: item.startDate?.year ? String(item.startDate.year) : '',
      Month: item.startDate?.month ? String(item.startDate.month) : '',
      Day: item.startDate?.day ? String(item.startDate.day) : '',
      Volume: '',
      Number: '',
      Characters: '',
    };
    return normalizeSearchResult(raw, item.id);
  });
}

function parseAladinCreators(authorRaw = '') {
  const writers = [];
  const pencillers = [];
  for (const rawPart of String(authorRaw).split(',')) {
    const part = rawPart.trim();
    if (!part) continue;
    const name = (part.match(/^([^(]+)/)?.[1] || part).trim();
    if (part.includes('(옮긴이)') || part.includes('(번역)')) continue;
    if (part.includes('(그림)') || part.includes('(일러스트)') || part.includes('(작화)')) {
      pencillers.push(name);
    } else if (part.includes('(지은이)') || part.includes('(글)') || part.includes('(원작)') || part.includes('(저자)') || !part.includes('(')) {
      writers.push(name);
    }
  }
  return { writer: writers.join(', '), penciller: pencillers.join(', ') };
}

async function searchAladin(query, ttbKey = '', page = 1, bookType = 'comic') {
  if (!ttbKey) return [];
  const params = new URLSearchParams({
    ttbkey: ttbKey,
    Query: query,
    QueryType: 'Keyword',
    MaxResults: '20',
    start: String(page || 1),
    SearchTarget: 'Book',
    output: 'js',
    Version: '20131101',
    Cover: 'Big',
    OptResult: 'categoryId,Story',
  });
  const headers = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
    'Accept': 'application/json,text/javascript,*/*;q=0.8',
    'Accept-Language': 'ko-KR,ko;q=0.9,en-US;q=0.8',
    'Referer': 'https://www.aladin.co.kr/',
  };
  let body;
  try {
    body = await requestTextGeneric(`http://www.aladin.co.kr/ttb/api/ItemSearch.aspx?${params.toString()}`, headers, 12000);
  } catch (error) {
    body = await requestTextGeneric(`https://www.aladin.co.kr/ttb/api/ItemSearch.aspx?${params.toString()}`, headers, 12000);
  }
  const cleanBody = body.replace(/^\uFEFF/, '').trim();
  let data;
  try {
    data = JSON.parse(cleanBody);
  } catch (error) {
    throw new Error(i18nT('api_aladin_parse_failed', { msg: cleanBody.slice(0, 120) }));
  }
  return (data.item || []).map(item => {
    const { writer, penciller } = parseAladinCreators(item.author || '');
    const date = parseDateParts(item.pubDate || '');
    const genre = String(item.categoryName || '').split('>').pop() || '';
    const rating = item.customerReviewRank ? String(item.customerReviewRank) : '';
    const isbn = normalizeIsbn(item.isbn13 || item.isbn || '');
    const raw = {
      Title: item.title || '',
      Series: item.title || '',
      Writer: writer,
      Penciller: penciller,
      Publisher: item.publisher || '',
      ISBN: isbn,
      Summary: stripHtml(item.description || ''),
      Genre: genre,
      Tags: genre,
      Web: item.link || '',
      CoverUrl: item.cover || '',
      LocalizedSeries: item.title || '',
      Count: '',
      Rating: rating ? `${rating} / 10.0` : '-',
      RatingScore: rating || '-',
      CommunityRating: rating,
      AgeRating: '',
      PubDate: item.pubDate || '',
      Format: metadataFormatForBookType(bookType),
      Manga: mangaValueForBookType(bookType),
      ...date,
      Volume: '',
      Number: '',
      Characters: '',
    };
    return normalizeSearchResult(raw, item.itemId || item.isbn13 || item.isbn || item.link);
  });
}

async function searchVine(query, apiKey = '', page = 1) {
  if (!apiKey) return [];
  const params = new URLSearchParams({
    api_key: apiKey,
    format: 'json',
    resources: 'volume',
    query,
    limit: '20',
    page: String(page || 1),
  });
  const data = await requestJsonGeneric(`https://comicvine.gamespot.com/api/search/?${params.toString()}`, {
    'User-Agent': 'BookManager_App/1.0',
  }, 15000);
  return (data.results || []).map(item => {
    const publisher = typeof item.publisher === 'object' && item.publisher ? item.publisher.name || '' : '';
    const coverUrl = typeof item.image === 'object' && item.image ? item.image.medium_url || item.image.original_url || '' : '';
    const year = item.start_year ? String(item.start_year) : '';
    const raw = {
      Title: item.name || '',
      Series: item.name || '',
      Writer: '',
      Publisher: publisher,
      Summary: stripHtml(item.description || ''),
      Web: item.site_detail_url || '',
      CoverUrl: coverUrl,
      Tags: '',
      Genre: '',
      LocalizedSeries: item.name || '',
      Count: item.count_of_issues ? String(item.count_of_issues) : '',
      Format: 'Comic',
      Rating: '-',
      RatingScore: '-',
      CommunityRating: '',
      AgeRating: '',
      PubDate: year,
      Year: year,
      Month: '',
      Day: '',
      Volume: '',
      Number: '',
      Characters: '',
    };
    return normalizeSearchResult(raw, item.id || item.api_detail_url || item.site_detail_url);
  });
}

function escapeRegExp(value = '') {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function cleanAmazonText(value = '') {
  return stripHtml(decodeHtmlEntities(value))
    .replace(/[\u200e\u200f]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function amazonUrlFromPath(value = '') {
  const raw = decodeHtmlEntities(value || '').trim();
  if (!raw) return '';
  if (/^https?:\/\//i.test(raw)) return raw;
  if (raw.startsWith('//')) return `https:${raw}`;
  try {
    return new URL(raw, 'https://www.amazon.com').toString();
  } catch {
    return '';
  }
}

function amazonImageUrl(value = '') {
  const raw = decodeHtmlEntities(value || '').trim();
  if (!raw) return '';
  if (/^https?:\/\//i.test(raw)) return raw;
  if (raw.startsWith('//')) return `https:${raw}`;
  return '';
}

function amazonSearchHeaders() {
  return {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36',
    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
    'Accept-Language': 'en-US,en;q=0.9,ko;q=0.8',
    'Referer': 'https://www.amazon.com/',
  };
}

function parseAmazonRating(value = '') {
  const text = decodeHtmlEntities(value);
  const match =
    text.match(/(\d+(?:\.\d+)?)\s+out\s+of\s+5/i)
    || text.match(/(\d+(?:\.\d+)?)\s*\/\s*5/i);
  return match ? String(match[1]) : '';
}

function extractAmazonSearchAuthor(chunk = '') {
  const byline = chunk.match(/(?:by|저자|작성자)\s*(?:<[^>]+>|\s)*<a\b[^>]*>([\s\S]{1,200}?)<\/a>/i)?.[1];
  if (byline) return cleanAmazonText(byline);

  const names = [];
  const linkPattern = /<a\b[^>]*class=["'][^"']*a-size-base[^"']*a-link-normal[^"']*["'][^>]*>([\s\S]{1,180}?)<\/a>/gi;
  let match;
  while ((match = linkPattern.exec(chunk)) !== null) {
    const name = cleanAmazonText(match[1]);
    if (!name || /^(paperback|hardcover|kindle|audio|mass market|spiral-bound)$/i.test(name)) continue;
    if (!names.includes(name)) names.push(name);
  }
  return names.slice(0, 3).join(', ');
}

function parseAmazonSearchHtml(html = '', bookType = 'book') {
  const entries = [];
  const chunks = String(html || '').split(/<div\b[^>]*data-component-type=["']s-search-result["'][^>]*>/i).slice(1);

  for (const chunk of chunks) {
    const asin =
      chunk.match(/\bdata-asin=["']([^"']{8,16})["']/i)?.[1]
      || chunk.match(/\/(?:dp|gp\/product)\/([A-Z0-9]{10})/i)?.[1]
      || '';
    if (!asin || entries.some(item => item.AmazonAsin === asin)) continue;

    const title = cleanAmazonText(
      chunk.match(/<h2\b[\s\S]{0,1400}?<span\b[^>]*>([\s\S]{1,500}?)<\/span>/i)?.[1]
      || chunk.match(/\baria-label=["']([^"']{2,260})["']/i)?.[1]
      || chunk.match(/\balt=["']([^"']{2,260})["']/i)?.[1]
      || '',
    );
    if (!title) continue;

    const linkPattern = new RegExp(`href=["']([^"']*(?:/(?:dp|gp/product)/${escapeRegExp(asin)}|/dp/${escapeRegExp(asin)})[^"']*)["']`, 'i');
    const link = amazonUrlFromPath(chunk.match(linkPattern)?.[1] || `/dp/${asin}`);
    const cover = amazonImageUrl(
      chunk.match(/<img\b[^>]*class=["'][^"']*s-image[^"']*["'][^>]*\bsrc=["']([^"']+)["']/i)?.[1]
      || chunk.match(/\bdata-image-source-density=["']([^"']+)["']/i)?.[1]
      || '',
    );
    const rating = parseAmazonRating(chunk);
    const writer = extractAmazonSearchAuthor(chunk);

    entries.push({
      AmazonAsin: asin,
      Title: title,
      Series: title,
      Writer: writer,
      Publisher: '',
      ISBN: '',
      Summary: '',
      Web: link,
      CoverUrl: cover,
      Genre: '',
      Tags: '',
      Count: '',
      Rating: rating ? `${rating} / 5.0` : '-',
      RatingScore: rating,
      CommunityRating: rating,
      AgeRating: '',
      PubDate: '',
      Format: metadataFormatForBookType(bookType),
      Manga: mangaValueForBookType(bookType),
      LocalizedSeries: title,
      Year: '',
      Month: '',
      Day: '',
      Volume: '',
      Number: '',
      Characters: '',
    });
  }

  return entries;
}

function normalizeAmazonJsonAuthor(author) {
  if (Array.isArray(author)) {
    return author.map(item => (
      typeof item === 'object' && item ? item.name || '' : String(item || '')
    )).filter(Boolean).join(', ');
  }
  if (typeof author === 'object' && author) return author.name || '';
  return String(author || '');
}

function extractAmazonJsonLdMetadata(html = '') {
  const objects = [];
  for (const json of extractJsonLdObjects(html)) {
    objects.push(...(Array.isArray(json?.['@graph']) ? json['@graph'] : [json]));
  }
  const entry = objects.find(item => {
    const type = Array.isArray(item?.['@type']) ? item['@type'].join(',') : String(item?.['@type'] || '');
    return /book|product/i.test(type) && (item?.name || item?.isbn);
  });
  if (!entry) return {};
  const image = Array.isArray(entry.image) ? entry.image[0] : entry.image || '';
  return {
    Title: cleanAmazonText(entry.name || ''),
    Writer: cleanAmazonText(normalizeAmazonJsonAuthor(entry.author)),
    ISBN: normalizeIsbn(entry.isbn || ''),
    Summary: cleanAmazonText(entry.description || ''),
    CoverUrl: amazonImageUrl(image),
  };
}

function extractAmazonDetailField(html = '', labels = []) {
  const cleanHtml = decodeHtmlEntities(html).replace(/[\u200e\u200f]/g, ' ');
  for (const label of labels) {
    const escaped = escapeRegExp(label);
    const patterns = [
      new RegExp(`<th\\b[^>]*>\\s*${escaped}\\s*[:：]?\\s*<\\/th>\\s*<td\\b[^>]*>([\\s\\S]{0,700}?)<\\/td>`, 'i'),
      new RegExp(`<span\\b[^>]*class=["'][^"']*a-text-bold[^"']*["'][^>]*>\\s*${escaped}\\s*[:：]?\\s*<\\/span>\\s*([\\s\\S]{0,260}?)(?:<br|<\\/li|<\\/span|<\\/div)`, 'i'),
      new RegExp(`<span\\b[^>]*>\\s*${escaped}\\s*[:：]?\\s*<\\/span>\\s*<span\\b[^>]*>([\\s\\S]{0,500}?)<\\/span>`, 'i'),
    ];
    for (const pattern of patterns) {
      const value = cleanAmazonText(cleanHtml.match(pattern)?.[1] || '');
      if (value) return value;
    }
  }

  const text = cleanAmazonText(cleanHtml);
  const knownLabels = [
    'Publisher',
    'Publication date',
    'Language',
    'Print length',
    'ISBN-10',
    'ISBN-13',
    'ASIN',
    'Dimensions',
    'Item Weight',
    'Best Sellers Rank',
    'Customer Reviews',
  ].map(escapeRegExp).join('|');
  for (const label of labels) {
    const pattern = new RegExp(`${escapeRegExp(label)}\\s*[:：]?\\s*(.{1,220}?)(?=\\s+(?:${knownLabels})\\s*[:：]?|$)`, 'i');
    const value = cleanAmazonText(text.match(pattern)?.[1] || '');
    if (value) return value;
  }
  return '';
}

function languageIsoFromAmazon(value = '') {
  const text = String(value || '').trim().toLowerCase();
  if (!text) return '';
  if (text.includes('korean') || text.includes('한국')) return 'ko';
  if (text.includes('japanese') || text.includes('日本')) return 'ja';
  if (text.includes('english')) return 'en';
  if (text.includes('chinese') || text.includes('中文')) return 'zh';
  if (text.includes('french')) return 'fr';
  if (text.includes('german')) return 'de';
  if (text.includes('spanish')) return 'es';
  return '';
}

async function fetchAmazonBookDetail(url = '') {
  if (!url) return {};
  const headers = amazonSearchHeaders();
  let html = '';
  try {
    html = await requestTextWithElectronNet(url, headers, 7000);
  } catch {
    try {
      html = await requestTextGeneric(url, headers, 7000);
    } catch {
      return {};
    }
  }

  const jsonMetadata = extractAmazonJsonLdMetadata(html);
  const productTitle = cleanAmazonText(html.match(/id=["']productTitle["'][^>]*>([\s\S]{1,600}?)<\/span>/i)?.[1] || '');
  const byline = cleanAmazonText(html.match(/id=["']bylineInfo["'][^>]*>([\s\S]{1,500}?)<\/(?:div|span)>/i)?.[1] || '');
  const publisherRaw = extractAmazonDetailField(html, ['Publisher']);
  const publisher = publisherRaw.replace(/\s*\([^)]*\)\s*$/, '').trim();
  const pubDate = extractAmazonDetailField(html, ['Publication date']);
  const date = parseDateParts(pubDate);
  const language = extractAmazonDetailField(html, ['Language']);
  const isbn13 = normalizeIsbn(extractAmazonDetailField(html, ['ISBN-13']));
  const isbn10 = normalizeIsbn(extractAmazonDetailField(html, ['ISBN-10']));
  const summary = cleanAmazonText(
    html.match(/id=["']bookDescription_feature_div["'][^>]*>([\s\S]{1,3000}?)<\/div>\s*<\/div>/i)?.[1]
    || html.match(/id=["']productDescription["'][^>]*>([\s\S]{1,3000}?)<\/div>/i)?.[1]
    || '',
  );

  return {
    ...jsonMetadata,
    Title: productTitle || jsonMetadata.Title || '',
    Writer: byline.replace(/^(by|저자|작성자)\s+/i, '').trim() || jsonMetadata.Writer || '',
    Publisher: publisher,
    ISBN: isbn13 || isbn10 || jsonMetadata.ISBN || '',
    Summary: summary || jsonMetadata.Summary || '',
    PubDate: pubDate,
    LanguageISO: languageIsoFromAmazon(language),
    ...date,
  };
}

async function searchAmazon(query, page = 1, bookType = 'book') {
  const params = new URLSearchParams({
    k: query,
    i: 'stripbooks',
  });
  if ((Number(page) || 1) > 1) params.set('page', String(Number(page) || 1));
  const url = `https://www.amazon.com/s?${params.toString()}&i=stripbooks`;
  const headers = amazonSearchHeaders();

  let html = '';
  try {
    html = await requestTextWithElectronNet(url, headers, 12000);
  } catch {
    html = await requestTextGeneric(url, headers, 12000);
  }

  const rawResults = parseAmazonSearchHtml(html, bookType).slice(0, 20);
  let cursor = 0;
  const worker = async () => {
    while (cursor < rawResults.length) {
      const index = cursor;
      cursor += 1;
      const item = rawResults[index];
      const details = await fetchAmazonBookDetail(item.Web);
      rawResults[index] = {
        ...item,
        ...Object.fromEntries(Object.entries(details).filter(([, value]) => (
          value !== undefined && value !== null && String(value).trim() !== ''
        ))),
        Title: details.Title || item.Title,
        Series: details.Title || item.Series || item.Title,
        CoverUrl: details.CoverUrl || item.CoverUrl,
        Web: item.Web,
      };
    }
  };
  await Promise.all(Array.from({ length: Math.min(3, rawResults.length) }, worker));

  return rawResults.map(item => normalizeSearchResult(item, item.AmazonAsin || item.Web || item.Title));
}

function decodeHtmlEntities(value = '') {
  return String(value)
    .replace(/&#(\d+);/g, (_, code) => String.fromCharCode(Number(code)))
    .replace(/&#x([0-9a-f]+);/gi, (_, code) => String.fromCharCode(parseInt(code, 16)))
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&nbsp;/g, ' ')
    .trim();
}

function extractJsonLdObjects(html = '') {
  const blocks = [];
  const pattern = /<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
  let match;
  while ((match = pattern.exec(html)) !== null) {
    try {
      const parsed = JSON.parse(decodeHtmlEntities(match[1]).trim());
      blocks.push(...(Array.isArray(parsed) ? parsed : [parsed]));
    } catch {
      // Ignore malformed embedded data.
    }
  }
  return blocks;
}

function normalizeRidiImageUrl(value = '') {
  const url = decodeHtmlEntities(value);
  if (!url) return '';
  if (url.startsWith('//')) return `https:${url}`;
  if (url.startsWith('/')) return `https://ridibooks.com${url}`;
  return url;
}

function parseRidibooksSearchHtml(html = '', page = 1, bookType = 'comic') {
  const byId = new Map();
  const pushBook = (book) => {
    const id = String(book.id || '').trim();
    const title = decodeHtmlEntities(book.title || '');
    if (!id || !title || byId.has(id)) return;
    const pubDate = book.pubDate || '';
    const date = parseDateParts(pubDate);
    const raw = {
      b_id: id,
      Title: title,
      Series: title,
      Writer: decodeHtmlEntities(book.author || ''),
      Publisher: decodeHtmlEntities(book.publisher || ''),
      Summary: stripHtml(decodeHtmlEntities(book.summary || '')),
      Web: `https://ridibooks.com/books/${id}`,
      CoverUrl: normalizeRidiImageUrl(book.cover || ''),
      Genre: decodeHtmlEntities(book.genre || ''),
      Tags: decodeHtmlEntities(book.tags || ''),
      Count: '',
      Rating: book.rating ? `${book.rating} / 10.0` : '-',
      RatingScore: book.rating || '-',
      CommunityRating: book.rating || '',
      AgeRating: '',
      Format: metadataFormatForBookType(bookType),
      Manga: mangaValueForBookType(bookType),
      LocalizedSeries: title,
      PubDate: pubDate,
      ...date,
      Volume: '',
      Number: '',
      Characters: '',
    };
    byId.set(id, normalizeSearchResult(raw, id));
  };

  for (const json of extractJsonLdObjects(html)) {
    const graph = Array.isArray(json['@graph']) ? json['@graph'] : [json];
    for (const entry of graph) {
      const url = String(entry?.url || entry?.['@id'] || '');
      const id = url.match(/\/books\/(\d+)/)?.[1];
      if (!id) continue;
      const author = Array.isArray(entry.author)
        ? entry.author.map(item => item?.name || item).filter(Boolean).join(', ')
        : entry.author?.name || entry.author || '';
      pushBook({
        id,
        title: entry.name || entry.headline || '',
        author,
        publisher: entry.publisher?.name || entry.publisher || '',
        summary: entry.description || '',
        cover: Array.isArray(entry.image) ? entry.image[0] : entry.image || '',
        pubDate: entry.datePublished || '',
      });
    }
  }

  const linkPattern = /<a\b[^>]*href=["']\/books\/(\d+)["'][^>]*>[\s\S]*?<\/a>/gi;
  let match;
  while ((match = linkPattern.exec(html)) !== null) {
    const chunkStart = Math.max(0, match.index - 2500);
    const chunkEnd = Math.min(html.length, linkPattern.lastIndex + 2500);
    const chunk = html.slice(chunkStart, chunkEnd);
    const id = match[1];
    const image =
      chunk.match(/https?:\/\/[^"'\s<>]+ridicdn\.net\/cover\/[^"'\s<>]+/i)?.[0] ||
      chunk.match(/(?:src|data-src|content)=["']([^"']*(?:ridicdn|cover)[^"']*)["']/i)?.[1] ||
      '';
    const title =
      chunk.match(/(?:alt|title|aria-label)=["']([^"']{2,160})["']/i)?.[1] ||
      stripHtml(match[0]).replace(/\s+/g, ' ').trim();
    const author =
      chunk.match(/(?:author|metadata|book_metadata)[^>]*>\s*([^<]{2,120})</i)?.[1] ||
      '';
    pushBook({ id, title, author, cover: image });
  }

  const start = (Math.max(1, Number(page) || 1) - 1) * 20;
  return [...byId.values()].slice(start, start + 20);
}

async function searchRidibooks(query, page = 1, bookType = 'comic') {
  const encodedQuery = new URLSearchParams({ q: query }).toString().slice(2);
  const params = new URLSearchParams();
  params.append('keyword', query);
  params.append('adult_exclude', 'n');
  params.append('where', 'book');
  params.append('where', 'author');
  params.append('what', 'instant');
  params.append('size', '200');
  params.append('site', 'ridi-store');

  const referer = `https://ridibooks.com/search?q=${encodedQuery}&adult_exclude=n&tab=COMIC&page=${page || 1}`;
  const headers = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
    'Accept': 'application/json, text/plain, */*',
    'Accept-Language': 'ko-KR,ko;q=0.9,en-US;q=0.8',
    'Referer': referer,
    'Origin': 'https://ridibooks.com',
    'X-Requested-With': 'XMLHttpRequest',
    'Sec-Fetch-Dest': 'empty',
    'Sec-Fetch-Mode': 'cors',
    'Sec-Fetch-Site': 'same-origin',
  };

  let data;
  const apiUrl = `https://ridibooks.com/apps/search/search?${params.toString()}`;
  try {
    data = await requestJsonWithElectronNet(apiUrl, headers, 12000);
  } catch (error) {
    // Chromium 세션에 검색 페이지를 먼저 태운 뒤 한 번 더 시도합니다.
    await new Promise(resolve => {
      const warmup = net.request({ method: 'GET', url: referer, useSessionCookies: true });
      warmup.setHeader('User-Agent', headers['User-Agent']);
      warmup.setHeader('Accept-Language', headers['Accept-Language']);
      warmup.on('response', response => {
        response.on('data', () => {});
        response.on('end', resolve);
      });
      warmup.on('error', resolve);
      warmup.end();
    });
    try {
      data = await requestJsonWithElectronNet(apiUrl, headers, 12000);
    } catch (retryError) {
      const htmlHeaders = {
        ...headers,
        Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
      };
      try {
        const html = await requestTextWithElectronNet(referer, htmlHeaders, 12000);
        return parseRidibooksSearchHtml(html, page, bookType);
      } catch {
        const html = await requestTextGeneric(referer, htmlHeaders, 12000);
        return parseRidibooksSearchHtml(html, page, bookType);
      }
    }
  }
  const allBooks = data.book?.books || [];
  const start = (Math.max(1, Number(page) || 1) - 1) * 20;
  return allBooks.slice(start, start + 20).map(book => {
    const id = book.b_id || '';
    const author = Array.isArray(book.author)
      ? book.author.map(item => typeof item === 'object' ? item.name || '' : String(item)).filter(Boolean).join(', ')
      : String(book.author || '');
    const tags = (book.tags_info || [])
      .map(tag => typeof tag === 'object' ? tag.tag_name || '' : '')
      .filter(Boolean)
      .join(', ');
    const genre = [book.category_name, book.category_name2].filter(Boolean).join(', ');
    const ratingScore = book.buyer_rating_score !== undefined && book.buyer_rating_score !== null
      ? String(Math.round(Number(book.buyer_rating_score) * 20) / 10)
      : '';
    const pubDate = book.web_title_pub_date || book.publication_date || '';
    const date = parseDateParts(pubDate);
    const cover = typeof book.cover === 'object' && book.cover
      ? book.cover.xxlarge || book.cover.xlarge || book.cover.large || ''
      : String(book.cover || '');
    const raw = {
      b_id: id,
      Title: book.title || '',
      Series: book.title || '',
      Writer: author,
      Publisher: book.publisher || '',
      Summary: stripHtml(book.desc || book.synopsis || ''),
      Web: id ? `https://ridibooks.com/books/${id}` : '',
      CoverUrl: cover,
      Genre: genre,
      Tags: tags,
      Count: book.book_count ? String(book.book_count) : '',
      Rating: ratingScore ? `${ratingScore} / 10.0${book.buyer_rating_count !== undefined && book.buyer_rating_count !== null ? ` (${book.buyer_rating_count})` : ''}` : '-',
      RatingScore: ratingScore || '-',
      CommunityRating: ratingScore,
      AgeRating: book.is_adult_only ? '19세 이상' : String(book.age_limit || '전체 이용가'),
      Format: metadataFormatForBookType(bookType),
      Manga: mangaValueForBookType(bookType),
      LocalizedSeries: book.title || '',
      PubDate: pubDate,
      ...date,
      Volume: '',
      Number: '',
      Characters: '',
    };
    return normalizeSearchResult(raw, id);
  });
}

const INDEX_EXTENSIONS = new Set(SCAN_TARGET_EXTENSIONS);
const LIBRARY_SCAN_VISUAL_EXTENSIONS = new Set(['.zip', '.cbz', '.rar', '.cbr', '.7z', '.cb7']);
const LIBRARY_SCAN_PROGRESS_INTERVAL_MS = 500;
const LIBRARY_SCAN_PROGRESS_MATCH_DELTA = 250;
const LIBRARY_SCAN_STAT_CONCURRENCY = 16;
const CPU_COUNT = os.cpus()?.length || 1;
const DEFAULT_LIBRARY_METADATA_CONCURRENCY = Math.max(1, Math.min(Math.ceil(CPU_COUNT * 0.75), CPU_COUNT));
const MAX_LIBRARY_METADATA_CONCURRENCY = Math.max(8, Math.min(32, Math.max(1, CPU_COUNT - 1)));
const THUMBNAIL_TARGET_WIDTH = 500;
const THUMBNAIL_WEBP_QUALITY = 82;
const JPEG2000_THUMBNAIL_EXTENSIONS = new Set(['.jp2', '.jpx', '.j2k', '.jpf']);
const JPEG_THUMBNAIL_EXTENSIONS = new Set(['.jpg', '.jpeg']);
const imageDataUrlCache = new Map();
const apiCoverUrlCache = new Map();
const execFileAsync = promisify(execFile);

async function decodeJpeg2000ThumbnailWithFfmpeg(imageBuffer, sourceExt, ffmpegExe) {
  if (!ffmpegExe) return null;
  const tempDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'bookmanager-thumbnail-jpx-'));
  const inputExt = JPEG2000_THUMBNAIL_EXTENSIONS.has(sourceExt) ? sourceExt : '.jp2';
  const inputPath = path.join(tempDir, `input${inputExt}`);
  const outputPath = path.join(tempDir, 'output.png');
  try {
    await fs.promises.writeFile(inputPath, imageBuffer);
    await execFileAsync(ffmpegExe, [
      '-hide_banner',
      '-loglevel',
      'error',
      '-y',
      '-i',
      inputPath,
      '-frames:v',
      '1',
      outputPath,
    ], {
      windowsHide: true,
      maxBuffer: 2 * 1024 * 1024,
    });
    return await fs.promises.readFile(outputPath);
  } finally {
    await fs.promises.rm(tempDir, { recursive: true, force: true }).catch(() => {});
  }
}

async function runJpegtran(inputPath, outputPath, args, jpegtranExe) {
  await execFileAsync(jpegtranExe, [
    '-copy',
    'none',
    ...args,
    '-outfile',
    outputPath,
    inputPath,
  ], {
    windowsHide: true,
    maxBuffer: 2 * 1024 * 1024,
  });
}

async function transformPdfJpegThumbnail(imageBuffer, sourceExt, imageTransform, jpegtranExe) {
  if (!jpegtranExe || !JPEG_THUMBNAIL_EXTENSIONS.has(sourceExt) || !imageTransform) return imageBuffer;
  const crop = imageTransform.crop;
  const rotate = Number(imageTransform.rotate) || 0;
  if ((!crop || !crop.width || !crop.height) && !rotate) return imageBuffer;

  const tempDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'bookmanager-thumbnail-jpegtran-'));
  let currentPath = path.join(tempDir, `input${sourceExt}`);
  try {
    await fs.promises.writeFile(currentPath, imageBuffer);
    if (crop?.width > 0 && crop?.height > 0) {
      const croppedPath = path.join(tempDir, 'cropped.jpg');
      await runJpegtran(currentPath, croppedPath, [
        '-crop',
        `${Math.floor(crop.width)}x${Math.floor(crop.height)}+${Math.floor(crop.x || 0)}+${Math.floor(crop.y || 0)}`,
      ], jpegtranExe);
      currentPath = croppedPath;
    }
    if ([90, 180, 270].includes(rotate)) {
      const rotatedPath = path.join(tempDir, 'rotated.jpg');
      await runJpegtran(currentPath, rotatedPath, ['-rotate', String(rotate)], jpegtranExe);
      currentPath = rotatedPath;
    }
    return await fs.promises.readFile(currentPath);
  } finally {
    await fs.promises.rm(tempDir, { recursive: true, force: true }).catch(() => {});
  }
}

function resolveLibraryMetadataConcurrency(options = {}) {
  const requested = Number(options.metadataConcurrency ?? options.maxThreads ?? options.max_threads);
  if (!Number.isFinite(requested)) return DEFAULT_LIBRARY_METADATA_CONCURRENCY;
  return Math.max(1, Math.min(MAX_LIBRARY_METADATA_CONCURRENCY, Math.floor(requested)));
}

function mimeFromUrl(url = '', contentType = '') {
  const cleanType = String(contentType || '').split(';')[0].trim();
  if (cleanType.startsWith('image/')) return cleanType;
  const ext = path.extname(new URL(url).pathname).toLowerCase();
  if (ext === '.png') return 'image/png';
  if (ext === '.webp') return 'image/webp';
  if (ext === '.gif') return 'image/gif';
  if (ext === '.svg') return 'image/svg+xml';
  return 'image/jpeg';
}

function imageExtensionFromMime(mimeType = '') {
  const cleanType = String(mimeType || '').split(';')[0].trim().toLowerCase();
  if (cleanType === 'image/png') return '.png';
  if (cleanType === 'image/webp') return '.webp';
  if (cleanType === 'image/gif') return '.gif';
  if (cleanType === 'image/svg+xml') return '.svg';
  return '.jpg';
}

function isEpubCoverCompatibleImage(filePath = '') {
  return ['.jpg', '.jpeg', '.png'].includes(path.extname(filePath).toLowerCase());
}

function normalizeApiCoverImageBuffer(buffer, mimeType = '') {
  const cleanType = String(mimeType || '').split(';')[0].trim().toLowerCase();
  if (cleanType === 'image/jpeg' || cleanType === 'image/png') {
    return { buffer, mimeType: cleanType };
  }

  try {
    const image = nativeImage.createFromBuffer(buffer);
    if (!image.isEmpty()) {
      const pngBuffer = image.toPNG();
      if (Buffer.isBuffer(pngBuffer) && pngBuffer.length > 0) {
        return { buffer: pngBuffer, mimeType: 'image/png' };
      }
    }
  } catch {
    // 원본 버퍼를 유지합니다.
  }

  return { buffer, mimeType };
}

function normalizeEpubCoverImageBuffer(buffer, sourcePath = '', mediaType = '') {
  const normalized = normalizeApiCoverImageBuffer(
    buffer,
    mediaType || imageMimeTypeFromPath(sourcePath),
  );
  return {
    ...normalized,
    extension: imageExtensionFromMime(normalized.mimeType),
  };
}

function stripTransientApiImageFields(result = {}) {
  const { coverDataUrl, coverCacheUrl, ...rest } = result || {};
  return rest;
}

function stripTransientApiImageFieldsFromResults(results = []) {
  return (results || []).map(stripTransientApiImageFields);
}

function apiCoverCacheUrlForFile(filePath) {
  if (!filePath || !fs.existsSync(filePath)) return '';
  let version = '';
  try {
    version = `?v=${Math.round(fs.statSync(filePath).mtimeMs)}`;
  } catch {
    version = '';
  }
  return `bookmanager-thumbnail://api-cover/${encodeURIComponent(path.basename(filePath))}${version}`;
}

function apiCoverCacheFileFromProtocolUrl(imageUrl = '', cacheDir = '') {
  if (!cacheDir) return '';
  try {
    const requestUrl = new URL(String(imageUrl || '').trim());
    if (requestUrl.protocol !== 'bookmanager-thumbnail:' || requestUrl.hostname !== 'api-cover') return '';
    const fileName = decodeURIComponent(requestUrl.pathname.slice(1));
    if (!fileName || path.basename(fileName) !== fileName) return '';
    const filePath = path.join(cacheDir, fileName);
    return fs.existsSync(filePath) ? filePath : '';
  } catch {
    return '';
  }
}

async function findApiCoverCacheFile(cacheDir, hash) {
  try {
    const entries = await fs.promises.readdir(cacheDir, { withFileTypes: true });
    const files = entries.filter(entry => entry.isFile() && entry.name.startsWith(`${hash}.`));
    const match = files.find(entry => isEpubCoverCompatibleImage(entry.name)) || files[0];
    return match ? path.join(cacheDir, match.name) : '';
  } catch {
    return '';
  }
}

async function ensureApiCoverCompatibleCacheFile(filePath = '', cacheDir = '', hash = '') {
  if (!filePath || isEpubCoverCompatibleImage(filePath)) return filePath;
  try {
    const sourceBuffer = await fs.promises.readFile(filePath);
    const normalized = normalizeApiCoverImageBuffer(sourceBuffer, imageMimeTypeFromPath(filePath));
    if (!Buffer.isBuffer(normalized.buffer) || normalized.mimeType !== 'image/png') return filePath;
    const outputPath = path.join(cacheDir, `${hash}.png`);
    await fs.promises.writeFile(outputPath, normalized.buffer);
    return outputPath;
  } catch {
    return filePath;
  }
}

function imageMimeTypeFromPath(filePath = '') {
  const ext = path.extname(filePath).toLowerCase();
  if (ext === '.png') return 'image/png';
  if (ext === '.webp') return 'image/webp';
  if (ext === '.gif') return 'image/gif';
  if (ext === '.svg') return 'image/svg+xml';
  if (ext === '.jpg' || ext === '.jpeg') return 'image/jpeg';
  return '';
}

function rememberApiCoverUrl(url, cacheUrl) {
  if (!cacheUrl) return cacheUrl;
  if (apiCoverUrlCache.size > 300) apiCoverUrlCache.clear();
  apiCoverUrlCache.set(url, cacheUrl);
  return cacheUrl;
}

async function fetchImageCacheFileFromUrl(imageUrl = '', cacheDir = '') {
  const url = String(imageUrl || '').trim();
  if (!url) return '';
  const protocolFile = apiCoverCacheFileFromProtocolUrl(url, cacheDir);
  if (protocolFile) return protocolFile;
  if (!/^https?:\/\//i.test(url)) return '';
  if (!cacheDir) return '';

  const hash = crypto.createHash('sha1').update(url).digest('hex');
  const cachedPath = await findApiCoverCacheFile(cacheDir, hash);
  if (cachedPath) return ensureApiCoverCompatibleCacheFile(cachedPath, cacheDir, hash);

  const imageOrigin = new URL(url).origin;
  const isRidiImage = /ridicdn\.net|ridibooks\.com/i.test(url);
  const { buffer, contentType } = await requestBufferGeneric(url, {
    Referer: isRidiImage ? 'https://ridibooks.com/' : imageOrigin,
    Accept: 'image/jpeg,image/png,image/*;q=0.8,*/*;q=0.5',
    'Accept-Language': 'ko-KR,ko;q=0.9,en-US;q=0.8',
  }, 12000);
  const mimeType = mimeFromUrl(url, contentType);
  const normalized = normalizeApiCoverImageBuffer(buffer, mimeType);
  const filePath = path.join(cacheDir, `${hash}${imageExtensionFromMime(normalized.mimeType)}`);
  await fs.promises.mkdir(cacheDir, { recursive: true });
  await fs.promises.writeFile(filePath, normalized.buffer);
  return filePath;
}

async function fetchImageCacheUrlFromUrl(imageUrl = '', cacheDir = '') {
  const url = String(imageUrl || '').trim();
  if (!url) return '';
  if (!/^https?:\/\//i.test(url)) return url;
  if (apiCoverUrlCache.has(url)) return apiCoverUrlCache.get(url);
  const filePath = await fetchImageCacheFileFromUrl(url, cacheDir);
  return rememberApiCoverUrl(url, apiCoverCacheUrlForFile(filePath));
}

function normalizeOpenAiTtsOptions(options = {}) {
  const input = String(options.text || options.input || '')
    .replace(/\u00a0/g, ' ')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
  if (!input) {
    throw Object.assign(new Error('No text to read.'), { code: 'OPENAI_TTS_NO_TEXT' });
  }
  if (input.length > OPENAI_TTS_INPUT_MAX_LENGTH) {
    throw Object.assign(new Error('OpenAI TTS input is too long.'), { code: 'OPENAI_TTS_TEXT_TOO_LONG' });
  }
  const voice = String(options.voice || 'marin').trim().toLowerCase();
  const speed = Number(options.speed);
  return {
    model: OPENAI_TTS_MODEL,
    input,
    voice: OPENAI_TTS_VOICES.has(voice) ? voice : 'marin',
    response_format: 'mp3',
    speed: Number.isFinite(speed) ? Math.max(0.25, Math.min(4, speed)) : 1,
  };
}

function audioMimeFromContentType(contentType = '') {
  const cleanType = String(contentType || '').split(';')[0].trim().toLowerCase();
  return cleanType.startsWith('audio/') ? cleanType : 'audio/mpeg';
}

async function createOpenAiTtsDataUrl(options = {}, apiKeys = {}) {
  const apiKey = String(apiKeys.tts_openai_key || '').trim();
  if (!apiKey) {
    throw Object.assign(new Error('OpenAI TTS API key is missing.'), { code: 'OPENAI_TTS_KEY_MISSING' });
  }
  const payload = normalizeOpenAiTtsOptions(options);
  const headers = { Authorization: `Bearer ${apiKey}` };
  let response;
  let usedPayload = payload;
  try {
    response = await requestBufferPost('https://api.openai.com/v1/audio/speech', payload, headers);
  } catch (error) {
    const message = String(error.message || '').toLowerCase();
    const canRetryWithFallback = [400, 404].includes(error.statusCode)
      && /model|voice|unsupported|not found|invalid/.test(message);
    if (!canRetryWithFallback) throw error;
    usedPayload = {
      ...payload,
      model: OPENAI_TTS_FALLBACK_MODEL,
      voice: OPENAI_TTS_FALLBACK_VOICES.has(payload.voice) ? payload.voice : 'alloy',
    };
    response = await requestBufferPost('https://api.openai.com/v1/audio/speech', usedPayload, headers);
  }
  const { buffer, contentType } = response;
  const mimeType = audioMimeFromContentType(contentType);
  return {
    success: true,
    model: usedPayload.model,
    voice: usedPayload.voice,
    mimeType,
    dataUrl: `data:${mimeType};base64,${buffer.toString('base64')}`,
  };
}

function sanitizeOpenAiTtsErrorMessage(message = '') {
  const text = String(message || '').replace(/\s+/g, ' ').trim();
  if (!text) return '';
  return text
    .replace(/sk-[A-Za-z0-9_-]+/g, 'sk-***')
    .slice(0, 240);
}

function normalizeOpenAiTtsError(error = {}) {
  if (error.code === 'OPENAI_TTS_KEY_MISSING' || error.code === 'OPENAI_TTS_NO_TEXT' || error.code === 'OPENAI_TTS_TEXT_TOO_LONG') {
    return {
      code: error.code,
      error: sanitizeOpenAiTtsErrorMessage(error.message),
    };
  }
  if (error.statusCode === 401 || error.statusCode === 403) {
    return {
      code: 'OPENAI_TTS_INVALID_KEY',
      error: 'OpenAI TTS API key is invalid or does not have access.',
    };
  }
  if (error.statusCode === 429) {
    return {
      code: 'OPENAI_TTS_QUOTA',
      error: sanitizeOpenAiTtsErrorMessage(error.message) || 'OpenAI TTS quota or rate limit reached.',
    };
  }
  return {
    code: error.code || 'OPENAI_TTS_ERROR',
    error: sanitizeOpenAiTtsErrorMessage(error.message || String(error)),
  };
}

function normalizeGoogleTtsOptions(options = {}) {
  const input = String(options.text || options.input || '')
    .replace(/\u00a0/g, ' ')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
  if (!input) {
    throw Object.assign(new Error('No text to read.'), { code: 'GOOGLE_TTS_NO_TEXT' });
  }
  if (input.length > GOOGLE_TTS_INPUT_MAX_LENGTH) {
    throw Object.assign(new Error('Google TTS input is too long.'), { code: 'GOOGLE_TTS_TEXT_TOO_LONG' });
  }
  const voiceId = String(options.voice || GOOGLE_TTS_DEFAULT_VOICE).trim();
  const voice = GOOGLE_TTS_VOICES.get(voiceId) || GOOGLE_TTS_VOICES.get(GOOGLE_TTS_DEFAULT_VOICE);
  const speed = Number(options.speed);
  return {
    input: { text: input },
    voice,
    audioConfig: {
      audioEncoding: 'MP3',
      speakingRate: Number.isFinite(speed) ? Math.max(0.25, Math.min(4, speed)) : 1,
    },
  };
}

function base64UrlEncode(value) {
  const source = Buffer.isBuffer(value) ? value : (typeof value === 'string' ? value : JSON.stringify(value));
  return Buffer.from(source)
    .toString('base64')
    .replace(/=/g, '')
    .replace(/\+/g, '-')
    .replace(/\//g, '_');
}

function parseGoogleTtsCredentialJson(jsonText = '') {
  try {
    return JSON.parse(jsonText);
  } catch {
    throw Object.assign(new Error('Google TTS credential JSON is invalid.'), { code: 'GOOGLE_TTS_CREDENTIAL_INVALID' });
  }
}

function readGoogleTtsCredentialFile(filePath = '') {
  const normalizedPath = String(filePath || '').trim().replace(/^["']|["']$/g, '');
  if (!normalizedPath) return '';
  try {
    if (fs.existsSync(normalizedPath) && fs.statSync(normalizedPath).isFile()) {
      return fs.readFileSync(normalizedPath, 'utf8');
    }
  } catch {
    return '';
  }
  return '';
}

function decodeGoogleTtsCredentialJson(value = '') {
  const text = String(value || '').trim();
  if (text.startsWith('{')) return text;

  try {
    const decoded = Buffer.from(text, 'base64').toString('utf8').trim();
    if (decoded.startsWith('{')) return decoded;
  } catch {
    // Ignore non-base64 API key strings and continue with file path handling.
  }

  return readGoogleTtsCredentialFile(text);
}

function resolveGoogleTtsCredential(value = '') {
  const text = String(value || '').trim();
  if (!text) {
    throw Object.assign(new Error('Google TTS credential is missing.'), { code: 'GOOGLE_TTS_KEY_MISSING' });
  }

  const jsonText = decodeGoogleTtsCredentialJson(text);
  if (!jsonText) {
    throw Object.assign(new Error('Google Cloud TTS requires OAuth credentials. Paste service account JSON or a JSON file path.'), {
      code: 'GOOGLE_TTS_OAUTH_REQUIRED',
    });
  }

  const credential = parseGoogleTtsCredentialJson(jsonText);
  const clientEmail = String(credential?.client_email || '').trim();
  const privateKey = String(credential?.private_key || '').replace(/\\n/g, '\n').trim();
  const tokenUri = String(credential?.token_uri || GOOGLE_TTS_TOKEN_URI).trim();
  if (!clientEmail || !privateKey) {
    throw Object.assign(new Error('Google TTS service account JSON must include client_email and private_key.'), {
      code: 'GOOGLE_TTS_CREDENTIAL_INVALID',
    });
  }
  return {
    clientEmail,
    privateKey,
    privateKeyId: String(credential?.private_key_id || '').trim(),
    tokenUri: tokenUri || GOOGLE_TTS_TOKEN_URI,
  };
}

function createGoogleServiceAccountJwt(credential = {}) {
  const now = Math.floor(Date.now() / 1000);
  const header = {
    alg: 'RS256',
    typ: 'JWT',
    ...(credential.privateKeyId ? { kid: credential.privateKeyId } : {}),
  };
  const claim = {
    iss: credential.clientEmail,
    scope: GOOGLE_TTS_OAUTH_SCOPE,
    aud: credential.tokenUri,
    iat: now,
    exp: now + 3600,
  };
  const signingInput = `${base64UrlEncode(header)}.${base64UrlEncode(claim)}`;
  try {
    const signer = crypto.createSign('RSA-SHA256');
    signer.update(signingInput);
    signer.end();
    return `${signingInput}.${base64UrlEncode(signer.sign(credential.privateKey))}`;
  } catch {
    throw Object.assign(new Error('Google TTS service account private key is invalid.'), {
      code: 'GOOGLE_TTS_CREDENTIAL_INVALID',
    });
  }
}

async function getGoogleServiceAccountAccessToken(credential = {}) {
  const keyFingerprint = crypto
    .createHash('sha256')
    .update(credential.privateKey)
    .digest('hex')
    .slice(0, 16);
  const cacheKey = `${credential.clientEmail}:${credential.privateKeyId}:${keyFingerprint}`;
  const cached = googleTtsAccessTokenCache.get(cacheKey);
  if (cached?.accessToken && cached.expiresAt > Date.now() + 60000) {
    return cached.accessToken;
  }

  let tokenData;
  try {
    tokenData = await requestFormPost(credential.tokenUri, {
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion: createGoogleServiceAccountJwt(credential),
    });
  } catch (error) {
    error.code = error.code || 'GOOGLE_TTS_AUTH_FAILED';
    throw error;
  }
  const accessToken = String(tokenData?.access_token || '').trim();
  if (!accessToken) {
    throw Object.assign(new Error('Google TTS access token response did not include an access token.'), {
      code: 'GOOGLE_TTS_AUTH_FAILED',
    });
  }

  const expiresIn = Number(tokenData?.expires_in);
  googleTtsAccessTokenCache.set(cacheKey, {
    accessToken,
    expiresAt: Date.now() + (Number.isFinite(expiresIn) ? expiresIn : 3600) * 1000,
  });
  return accessToken;
}

async function createGoogleTtsDataUrl(options = {}, apiKeys = {}) {
  const credential = resolveGoogleTtsCredential(apiKeys.tts_google_key);
  const payload = normalizeGoogleTtsOptions(options);
  const accessToken = await getGoogleServiceAccountAccessToken(credential);
  const data = await requestJsonPost('https://texttospeech.googleapis.com/v1/text:synthesize', payload, {
    Authorization: `Bearer ${accessToken}`,
  });
  const audioContent = String(data?.audioContent || '').trim();
  if (!audioContent) {
    throw Object.assign(new Error('Google TTS response did not include audio content.'), { code: 'GOOGLE_TTS_EMPTY_AUDIO' });
  }
  return {
    success: true,
    voice: payload.voice.languageCode,
    mimeType: 'audio/mpeg',
    dataUrl: `data:audio/mpeg;base64,${audioContent}`,
  };
}

function sanitizeGoogleTtsErrorMessage(message = '') {
  const text = String(message || '')
    .replace(/-----BEGIN PRIVATE KEY-----[\s\S]*?-----END PRIVATE KEY-----/g, 'PRIVATE_KEY***')
    .replace(/\s+/g, ' ')
    .trim();
  if (!text) return '';
  return text
    .replace(/AIza[0-9A-Za-z_-]+/g, 'AIza***')
    .replace(/ya29\.[0-9A-Za-z._-]+/g, 'ya29.***')
    .slice(0, 240);
}

function normalizeGoogleTtsError(error = {}) {
  if (
    error.code === 'GOOGLE_TTS_KEY_MISSING'
    || error.code === 'GOOGLE_TTS_NO_TEXT'
    || error.code === 'GOOGLE_TTS_TEXT_TOO_LONG'
    || error.code === 'GOOGLE_TTS_OAUTH_REQUIRED'
    || error.code === 'GOOGLE_TTS_CREDENTIAL_INVALID'
    || error.code === 'GOOGLE_TTS_AUTH_FAILED'
  ) {
    return {
      code: error.code,
      error: sanitizeGoogleTtsErrorMessage(error.message),
    };
  }
  if (error.statusCode === 401 || error.statusCode === 403) {
    return {
      code: 'GOOGLE_TTS_AUTH_FAILED',
      error: sanitizeGoogleTtsErrorMessage(error.message) || 'Google TTS credentials are invalid or Cloud Text-to-Speech access is not enabled.',
    };
  }
  if (error.statusCode === 429) {
    return {
      code: 'GOOGLE_TTS_QUOTA',
      error: sanitizeGoogleTtsErrorMessage(error.message) || 'Google TTS quota or rate limit reached.',
    };
  }
  return {
    code: error.code || 'GOOGLE_TTS_ERROR',
    error: sanitizeGoogleTtsErrorMessage(error.message || String(error)),
  };
}

async function fetchImageDataUrlFromUrl(imageUrl = '') {
  const url = String(imageUrl || '').trim();
  if (!url) return '';
  if (!/^https?:\/\//i.test(url)) return url;
  if (imageDataUrlCache.has(url)) return imageDataUrlCache.get(url);

  const imageOrigin = new URL(url).origin;
  const isRidiImage = /ridicdn\.net|ridibooks\.com/i.test(url);
  const { buffer, contentType } = await requestBufferGeneric(url, {
    Referer: isRidiImage ? 'https://ridibooks.com/' : imageOrigin,
    'Accept-Language': 'ko-KR,ko;q=0.9,en-US;q=0.8',
  }, 12000);
  const dataUrl = `data:${mimeFromUrl(url, contentType)};base64,${buffer.toString('base64')}`;
  if (imageDataUrlCache.size > 300) imageDataUrlCache.clear();
  imageDataUrlCache.set(url, dataUrl);
  return dataUrl;
}

async function enrichResultImages(results = [], cacheDir = '') {
  if (!Array.isArray(results) || results.length === 0) return results;
  const next = stripTransientApiImageFieldsFromResults(results);
  let cursor = 0;
  const worker = async () => {
    while (cursor < next.length) {
      const index = cursor;
      cursor += 1;
      const coverUrl = next[index].coverUrl || next[index].CoverUrl || '';
      if (!coverUrl || next[index].coverCacheUrl) continue;
      try {
        next[index].coverCacheUrl = await fetchImageCacheUrlFromUrl(coverUrl, cacheDir);
      } catch {
        next[index].coverCacheUrl = '';
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(4, next.length) }, worker));
  return next;
}

function isPathInsideOrEqual(childPath, parentPath) {
  const relative = path.relative(parentPath, childPath);
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
}

function findContainingLibraryPath(filePath, libraryPaths = []) {
  if (!filePath) return '';
  const normalizedPath = path.resolve(filePath);
  return libraryPaths
    .filter(libraryPath => isPathInsideOrEqual(normalizedPath, libraryPath))
    .sort((left, right) => right.length - left.length)[0] || '';
}

function thumbnailUrlForSearchResult(thumbnailPath, sourceMtime = 0, sourceSize = 0) {
  if (!thumbnailPath) return '';
  const baseUrl = `bookmanager-thumbnail://cache/${encodeURIComponent(path.basename(thumbnailPath))}`;
  const versionMtime = Math.round(fileMtimeToMs(sourceMtime));
  const versionSize = Math.max(0, Number(sourceSize) || 0);
  return versionMtime ? `${baseUrl}?v=${versionMtime}-${versionSize}` : baseUrl;
}

function fileMtimeToMs(value) {
  const numeric = Number(value) || 0;
  if (!numeric) return 0;
  return numeric > 100000000000 ? numeric : numeric * 1000;
}

function normalizeLibrarySearchFileForRenderer(row = {}) {
  const filePath = row.path || '';
  const mtimeMs = fileMtimeToMs(row.mtime);
  const thumbnailPath = row.thumb_path || '';
  const inferredHasMetadata = [
    row.title,
    row.series,
    row.series_group,
    row.volume,
    row.number,
    row.writer,
    row.publisher,
    row.summary,
    row.characters,
    row.tags,
  ].some(Boolean);
  const hasMetadata = row.has_metadata === null || row.has_metadata === undefined || row.has_metadata === ''
    ? inferredHasMetadata
    : Boolean(Number(row.has_metadata));
  return {
    ...row,
    name: path.basename(filePath),
    path: filePath,
    full_path: filePath,
    folder_path: filePath ? path.dirname(filePath) : '',
    ext: row.ext || path.extname(filePath).toLowerCase(),
    size: Number(row.size) || 0,
    mtime: mtimeMs,
    ctime: mtimeMs,
    created: '',
    modified: mtimeMs ? new Date(mtimeMs).toISOString() : '',
    title: row.title || path.parse(filePath).name,
    volume: row.volume || '',
    chapter: row.number || '',
    author: row.writer || row.creators || '',
    producer: row.creators || row.writer || '',
    total_volume: row.volume_count || '',
    page_count: row.page_count || '',
    description: row.summary || '',
    link: row.web || '',
    thumb_path: thumbnailPath,
    cover: thumbnailUrlForSearchResult(thumbnailPath, row.mtime, row.size),
    has_metadata: hasMetadata,
    duplicate_matches: [],
    dup_count: 0,
    max_ratio: 0,
  };
}

function createTaskCancelledError() {
  const error = new Error(i18nT('msg_cancelled'));
  error.code = 'TASK_CANCELLED';
  return error;
}

function throwIfTaskCancelled(shouldCancel) {
  if (typeof shouldCancel === 'function' && shouldCancel()) throw createTaskCancelledError();
}

function nowIsoString() {
  return new Date().toISOString();
}

function safeStatMtime(filePath) {
  try {
    return fs.statSync(filePath).mtimeMs;
  } catch {
    return 0;
  }
}

async function createArchiveIndexEntry(filePath, targetFolder) {
  const stat = await fs.promises.stat(filePath);
  return {
    full_path: path.resolve(filePath),
    target_folder: path.resolve(targetFolder),
    name: path.basename(filePath),
    size: stat.size,
    mtime: stat.mtimeMs,
  };
}

async function buildArchiveIndexEntries(filePaths = [], targetFolder, options = {}) {
  const {
    shouldCancel = null,
    onProgress = null,
    concurrency = LIBRARY_SCAN_STAT_CONCURRENCY,
  } = options;
  const entries = new Array(filePaths.length);
  let nextIndex = 0;
  let completedCount = 0;
  let lastProgressAt = 0;
  const workerCount = Math.max(1, Math.min(concurrency, filePaths.length || 1));

  function reportProgress(currentPath = '', force = false) {
    if (typeof onProgress !== 'function') return;
    const now = Date.now();
    if (!force && now - lastProgressAt < LIBRARY_SCAN_PROGRESS_INTERVAL_MS) return;
    lastProgressAt = now;
    onProgress({
      completedCount,
      totalCount: filePaths.length,
      currentPath,
    });
  }

  async function worker() {
    while (nextIndex < filePaths.length) {
      throwIfTaskCancelled(shouldCancel);
      const currentIndex = nextIndex;
      nextIndex += 1;
      const filePath = filePaths[currentIndex];
      try {
        entries[currentIndex] = await createArchiveIndexEntry(filePath, targetFolder);
      } catch {
        // 파일이 수집 직후 삭제되었거나 접근 불가하면 이번 인덱스 대상에서 제외합니다.
      } finally {
        completedCount += 1;
        reportProgress(filePath);
      }
    }
  }

  reportProgress(targetFolder, true);
  await Promise.all(Array.from({ length: workerCount }, () => worker()));
  reportProgress(targetFolder, true);
  return entries.filter(Boolean);
}

function createArchiveFingerprint(entries = []) {
  const hash = crypto.createHash('sha1');
  for (const entry of entries) {
    hash
      .update(entry.full_path)
      .update('\u001f')
      .update(String(entry.size))
      .update('\u001f')
      .update(String(entry.mtime))
      .update('\u001e');
  }
  return `sha1:${entries.length}:${hash.digest('hex')}`;
}

export function normalizeLibraryScanStateForRenderer(folderPath, state = {}, exists = false) {
  const libraryPath = path.resolve(folderPath);
  const rootMtime = exists ? safeStatMtime(libraryPath) : 0;
  const lastRootMtime = Number(state.root_mtime || 0);
  const status = state.status || 'idle';
  const neverScanned = !state.last_scanned_at;
  const changedSinceScan = exists && !state.fingerprint && state.last_scanned_at && rootMtime > lastRootMtime + 2;
  return {
    libraryPath,
    status,
    exists,
    needsScan: neverScanned || status === 'error' || status === 'cancelled' || changedSinceScan,
    changedSinceScan,
    fileCount: Number(state.file_count || 0),
    indexedCount: Number(state.indexed_count || 0),
    addedCount: Number(state.added_count || 0),
    updatedCount: Number(state.updated_count || 0),
    removedCount: Number(state.removed_count || 0),
    lastScannedAt: state.last_scanned_at || '',
    lastCheckedAt: state.last_checked_at || '',
    lastChangedAt: state.last_changed_at || '',
    lastError: state.last_error || '',
    scanReason: state.scan_reason || '',
    rootMtime,
    storedRootMtime: lastRootMtime,
  };
}

export async function scanArchivePaths(rootPath, priorityFolder = '', onProgress = null, shouldCancel = null, onMatch = null, onFolder = null) {
  const results = [];
  const visitedDirs = new Set();
  let scannedCount = 0;
  let lastProgressAt = 0;
  let lastProgressMatchedCount = -1;
  const startedAt = Date.now();
  let lastCurrentPath = rootPath;
  let progressTimer = null;

  function reportProgress(currentPath, force = false) {
    if (typeof onProgress !== 'function') return;
    if (currentPath) lastCurrentPath = currentPath;
    const now = Date.now();
    const matchedDelta = Math.abs(results.length - lastProgressMatchedCount);
    if (
      !force
      && now - lastProgressAt < LIBRARY_SCAN_PROGRESS_INTERVAL_MS
      && matchedDelta < LIBRARY_SCAN_PROGRESS_MATCH_DELTA
    ) return;
    lastProgressAt = now;
    lastProgressMatchedCount = results.length;
    onProgress({
      scannedCount,
      matchedCount: results.length,
      currentPath: currentPath || lastCurrentPath,
      elapsedSeconds: Math.max(0, Math.floor((now - startedAt) / 1000)),
    });
  }

  async function walk(currentPath) {
    throwIfTaskCancelled(shouldCancel);
    const normalizedCurrentPath = path.resolve(currentPath);
    if (visitedDirs.has(normalizedCurrentPath)) return;
    visitedDirs.add(normalizedCurrentPath);
    if (typeof onFolder === 'function') onFolder(normalizedCurrentPath);
    reportProgress(currentPath);
    let entries;
    try {
      entries = await fs.promises.readdir(currentPath, { withFileTypes: true });
    } catch {
      return;
    }
    const sortedEntries = [...entries].sort((left, right) => {
      if (left.isFile() !== right.isFile()) return left.isFile() ? -1 : 1;
      return left.name.localeCompare(right.name, 'ko', { numeric: true });
    });
    for (const entry of sortedEntries) {
      throwIfTaskCancelled(shouldCancel);
      if (shouldSkipScanDirectoryEntry(entry)) continue;
      const fullPath = path.join(currentPath, entry.name);
      if (entry.isDirectory()) {
        await walk(fullPath);
      } else if (entry.isFile()) {
        scannedCount += 1;
        if (INDEX_EXTENSIONS.has(path.extname(entry.name).toLowerCase())) {
          results.push(fullPath);
          if (typeof onMatch === 'function') await onMatch(fullPath);
          reportProgress(fullPath);
        } else {
          reportProgress(fullPath);
        }
      }
    }
  }
  try {
    if (typeof onProgress === 'function') {
      reportProgress(rootPath, true);
      progressTimer = setInterval(() => {
        reportProgress(lastCurrentPath || rootPath, true);
      }, 1000);
    }
    const resolvedRoot = path.resolve(rootPath);
    const resolvedPriority = priorityFolder ? path.resolve(priorityFolder) : '';
    if (
      resolvedPriority
      && fs.existsSync(resolvedPriority)
      && isPathInsideOrEqual(resolvedPriority, resolvedRoot)
      && !pathHasHiddenDirectorySegment(resolvedPriority, resolvedRoot)
    ) {
      await walk(resolvedPriority);
    }
    await walk(rootPath);
    reportProgress(rootPath, true);
  } finally {
    if (progressTimer) clearInterval(progressTimer);
  }
  return results;
}

export async function extractLibraryScanVisualItem(filePath, options = {}) {
  const {
    libraryDb,
    thumbnailDir,
    sevenZExe = '',
    thumbnailEncoder = null,
    allowArchiveExtraction = false,
    force = false,
    lang = 'ko',
    shouldCancel = null,
  } = options;
  throwIfTaskCancelled(shouldCancel);
  if (!filePath || !fs.existsSync(filePath)) return null;
  if (!LIBRARY_SCAN_VISUAL_EXTENSIONS.has(path.extname(filePath).toLowerCase())) return null;

  const file = await inspectFolderFile(filePath, {
    libraryDb,
    thumbnailDir,
    sevenZExe,
    thumbnailEncoder,
    force,
    skipArchiveExtraction: allowArchiveExtraction !== true,
    lang,
    shouldCancel,
  });
  throwIfTaskCancelled(shouldCancel);
  return file?.cover ? file : null;
}

// IPC 핸들러 설정
export function setupIPCHandlers(configManager, getExecutableDir, getResourcePath, getBinPath, getFontPath) {
  const cancellationRegistry = new TaskCancellationRegistry();
  const runtimeStates = new Map();
  const appDataDir = () => getExecutableDir();
  const apiCacheDbPath = () => resolveApiCacheDbPath(appDataDir());
  const libraryDbPath = () => resolveLibraryDbPath(appDataDir());
  const contentIndexDbPath = () => resolveContentIndexDbPath(appDataDir());
  const renameHistoryPath = () => resolveRenameHistoryPath(appDataDir());
  const apiCoverCacheDir = () => resolveApiCoverCacheDir(appDataDir());
  const thumbnailDir = () => resolveThumbnailDir(appDataDir());
  const librarySearchService = new LibrarySearchService(libraryDbPath());
  const contentIndexService = new ContentIndexService(contentIndexDbPath());
  const removeContentIndexProgressListener = contentIndexService.onProgress(progress => {
    for (const window of BrowserWindow.getAllWindows()) {
      if (!window.isDestroyed()) window.webContents.send('folder:contentIndexProgress', progress);
    }
  });
  void librarySearchService.prepare().catch(error => {
    console.warn(`[LibrarySearch] Background index preparation failed: ${error.message}`);
  });
  let cwebpExePromise = null;
  let ffmpegExePromise = null;
  let jpegtranExePromise = null;
  const clearApiCacheSafe = (dbPath, imageDirectories = []) => {
    try {
      return clearApiCache(dbPath, imageDirectories);
    } catch (error) {
      console.warn(`[ApiCache] clearApiCache failed: ${error.message}`);
      return { deletedRows: 0, deletedFiles: 0 };
    }
  };
  const openApiCacheDbSafe = () => {
    try {
      return openApiCacheDb(apiCacheDbPath());
    } catch (error) {
      console.warn(`[ApiCache] Could not open API cache DB; continuing without cache: ${error.message}`);
      return null;
    }
  };
  const getCwebpExe = () => {
    if (!cwebpExePromise) cwebpExePromise = getBinPath('cwebp');
    return cwebpExePromise;
  };
  const getFfmpegExe = () => {
    if (!ffmpegExePromise) ffmpegExePromise = getBinPath('ffmpeg');
    return ffmpegExePromise;
  };
  const getJpegtranExe = () => {
    if (!jpegtranExePromise) jpegtranExePromise = getBinPath('jpegtran');
    return jpegtranExePromise;
  };
  const encodeThumbnail = async (imageBuffer, thumbnailOptions = {}) => {
    const cwebpExe = await getCwebpExe();
    let sourceExt = path.extname(thumbnailOptions.imageName || '').toLowerCase();
    if (JPEG2000_THUMBNAIL_EXTENSIONS.has(sourceExt)) {
      try {
        const pngBuffer = await decodeJpeg2000ThumbnailWithFfmpeg(imageBuffer, sourceExt, await getFfmpegExe());
        if (pngBuffer?.length) {
          imageBuffer = pngBuffer;
          sourceExt = '.png';
        }
      } catch (error) {
        console.warn(`[Thumbnail] ffmpeg JPEG 2000 decode failed; using fallback: ${error.message}`);
      }
    }
    if (JPEG_THUMBNAIL_EXTENSIONS.has(sourceExt) && thumbnailOptions.imageTransform) {
      try {
        imageBuffer = await transformPdfJpegThumbnail(imageBuffer, sourceExt, thumbnailOptions.imageTransform, await getJpegtranExe());
      } catch (error) {
        console.warn(`[Thumbnail] PDF JPEG transform failed; using original image: ${error.message}`);
      }
    }
    const directCwebpExts = new Set(['.jpg', '.jpeg', '.png', '.webp', '.tif', '.tiff']);
    if (cwebpExe && directCwebpExts.has(sourceExt)) {
      const tempDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'bookmanager-thumbnail-'));
      const inputPath = path.join(tempDir, `input${sourceExt}`);
      const outputPath = path.join(tempDir, 'output.webp');
      try {
        await fs.promises.writeFile(inputPath, imageBuffer);
        await execFileAsync(cwebpExe, [
          inputPath,
          '-resize',
          String(THUMBNAIL_TARGET_WIDTH),
          '0',
          '-q',
          String(THUMBNAIL_WEBP_QUALITY),
          '-metadata',
          'none',
          '-mt',
          '-quiet',
          '-o',
          outputPath,
        ], {
          windowsHide: true,
          maxBuffer: 2 * 1024 * 1024,
        });
        return {
          buffer: await fs.promises.readFile(outputPath),
          extension: '.webp',
        };
      } catch (error) {
        console.warn(`[Thumbnail] direct cwebp failed; using fallback: ${error.message}`);
      } finally {
        await fs.promises.rm(tempDir, { recursive: true, force: true }).catch(() => {});
      }
    }

    const image = nativeImage.createFromBuffer(imageBuffer);
    if (image.isEmpty()) return null;
    const size = image.getSize();
    if (!size.width || !size.height) return null;
    const targetHeight = Math.max(1, Math.round(size.height * (THUMBNAIL_TARGET_WIDTH / size.width)));
    const thumbnail = image.resize({
      width: THUMBNAIL_TARGET_WIDTH,
      height: targetHeight,
      quality: 'best',
    });
    const pngBuffer = thumbnail.toPNG();
    if (!cwebpExe) {
      console.warn('[Thumbnail] cwebp executable not found; saving PNG fallback.');
      return {
        buffer: pngBuffer,
        extension: '.png',
      };
    }

    const tempDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'bookmanager-thumbnail-'));
    const inputPath = path.join(tempDir, 'input.png');
    const outputPath = path.join(tempDir, 'output.webp');
    try {
      await fs.promises.writeFile(inputPath, pngBuffer);
      try {
        await execFileAsync(cwebpExe, [
          inputPath,
          '-q',
          String(THUMBNAIL_WEBP_QUALITY),
          '-metadata',
          'none',
          '-mt',
          '-quiet',
          '-o',
          outputPath,
        ], {
          windowsHide: true,
          maxBuffer: 2 * 1024 * 1024,
        });
        return {
          buffer: await fs.promises.readFile(outputPath),
          extension: '.webp',
        };
      } catch (error) {
        console.warn(`[Thumbnail] cwebp failed; saving PNG fallback: ${error.message}`);
        return {
          buffer: pngBuffer,
          extension: '.png',
        };
      }
    } finally {
      await fs.promises.rm(tempDir, { recursive: true, force: true }).catch(() => {});
    }
  };
  const optimizeMetadataForPaths = async (folder, filePaths, options = {}, event) => {
    const {
      libraryDb,
      sevenZExe,
      shouldCancel,
      force = false,
      lang = 'ko',
      skipCoverExtraction = false,
      touchHeartbeat = null,
    } = options;
    const cacheKey = JSON.stringify({
      folderPath: folder,
      includeSubfolders: true,
      enableDupCheck: false,
      dupFolders: [],
      skipArchiveExtraction: false,
    });
    const files = [];
    const metadataConcurrency = resolveLibraryMetadataConcurrency(options);
    const metadataStartedAt = Date.now();
    let nextIndex = 0;
    let completedCount = 0;
    let lastProgressAt = 0;

    function emitProgress(index, filePath = '', forceProgress = false) {
      if (event.sender.isDestroyed()) return;
      const now = Date.now();
      if (!forceProgress && now - lastProgressAt < LIBRARY_SCAN_PROGRESS_INTERVAL_MS) return;
      lastProgressAt = now;
      event.sender.send('task:progress', {
        task: 'folder:updateIndex',
        progress: Math.min(95, Math.round((index / Math.max(filePaths.length, 1)) * 100)),
        message: i18nT('folder_optimizing', [index, filePaths.length]),
        libraryPhase: 'metadata',
        currentFile: filePath,
        currentFileName: path.basename(filePath || ''),
      });
    }

    async function processMetadataFile(index, filePath) {
      throwIfTaskCancelled(shouldCancel);
      if (typeof touchHeartbeat === 'function') touchHeartbeat();
      emitProgress(completedCount, filePath, index === 0);
      let file = null;
      try {
        file = await inspectFolderFile(filePath, {
          libraryDb,
          thumbnailDir: thumbnailDir(),
          sevenZExe,
          thumbnailEncoder: encodeThumbnail,
          force,
          skipArchiveExtraction: false,
          skipCoverExtraction,
          lang,
          shouldCancel,
        });
      } catch (error) {
        if (error?.code === 'TASK_CANCELLED') throw error;
        console.warn(`[LibraryIndex] metadata extraction skipped: ${filePath}`, error.message);
        completedCount += 1;
        emitProgress(completedCount, filePath);
        return;
      }
      throwIfTaskCancelled(shouldCancel);
      if (file) files.push(file);
      if (file && !event.sender.isDestroyed()) {
        event.sender.send('folder:fileReady', {
          folderPath: folder,
          cacheKey,
          file,
          libraryPhase: 'metadata',
        });
      }
      completedCount += 1;
      emitProgress(completedCount, filePath);
    }

    async function runMetadataWorker() {
      while (nextIndex < filePaths.length) {
        const index = nextIndex;
        nextIndex += 1;
        await processMetadataFile(index, filePaths[index]);
      }
    }

    await Promise.all(
      Array.from(
        { length: Math.min(metadataConcurrency, filePaths.length) },
        () => runMetadataWorker(),
      ),
    );
    emitProgress(filePaths.length, '', true);
    const elapsedMs = Math.max(0, Date.now() - metadataStartedAt);
    console.log(
      `[LibraryIndex] metadata summary files=${filePaths.length} extracted=${files.length} `
      + `force=${force} skipCover=${skipCoverExtraction} concurrency=${metadataConcurrency} `
      + `elapsedMs=${elapsedMs} avgMs=${filePaths.length ? Math.round(elapsedMs / filePaths.length) : 0}`,
    );

    return files;
  };
  ipcMain.on('app:setRuntimeState', (event, state) => {
    runtimeStates.set(event.sender.id, normalizeRuntimeState(state));
  });

  // ========== 폴더 스캔 ==========
  ipcMain.handle('folder:scan', async (event, folderPath, options) => {
    const taskId = 'folder:scan';
    cancellationRegistry.cancel(event.sender.id, taskId);
    const controller = cancellationRegistry.start(event.sender.id, taskId);
    try {
      const config = configManager.getConfig() || {};
      const sevenZExe = await getBinPath('7za') || await getBinPath('7z');
      return await scanFolder(folderPath, {
        ...(options || {}),
        lang: options?.lang || config.language || config.lang || 'ko',
        dbPath: libraryDbPath(),
        thumbnailDir: thumbnailDir(),
        sevenZExe,
        thumbnailEncoder: encodeThumbnail,
        shouldCancel: () => controller.shouldCancel(),
      }, event);
    } catch (error) {
      if (error?.code === 'TASK_CANCELLED') {
        if (!event.sender.isDestroyed()) {
          event.sender.send('task:progress', {
            task: 'folder:scan',
            progress: 0,
            message: i18nT('msg_cancelled'),
            phase: 'idle',
          });
        }
        return [];
      }
      console.error('Folder scan error:', error);
      event.sender.send('scan-error', { message: error.message });
      throw error;
    } finally {
      cancellationRegistry.finish(event.sender.id, taskId, controller);
    }
  });

  // ========== 압축 파일 구조 정리 ==========
  ipcMain.handle('organizer:analyze', async (event, paths, options = {}) => {
    const sevenZExe = options.sevenZExe || await getBinPath('7za') || await getBinPath('7z');
    return analyzeOrganizerInputs(paths, {
      ...options,
      sevenZExe,
      lang: options.lang || configManager.getConfig()?.language || configManager.getConfig()?.lang || 'ko',
    }, (progress) => {
      event.sender.send('task:progress', { task: 'organizer:analyze', ...progress });
    });
  });

  ipcMain.handle('organizer:execute', async (event, items, options = {}) => {
    const taskId = 'organizer';
    const controller = cancellationRegistry.start(event.sender.id, taskId);
    const config = configManager.getConfig() || {};
    const sevenZExe = options.sevenZExe || await getBinPath('7za') || await getBinPath('7z');
    const cwebpExe = options.cwebpExe || await getBinPath('cwebp');
    const pngquantExe = options.pngquantExe || await getBinPath('pngquant');
    const jpegtranExe = options.jpegtranExe || await getBinPath('jpegtran');
    try {
      return await executeOrganizer(items, {
        ...config,
        ...options,
        sevenZExe,
        cwebpExe,
        pngquantExe,
        jpegtranExe,
        shouldCancel: () => controller.shouldCancel(),
        lang: options.lang || config.language || config.lang || 'ko',
        target_format: options.target_format ?? config.target_format ?? 'none',
        backup_on: options.backup_on ?? config.backup_on ?? false,
        flatten_folders: options.flatten_folders ?? options.flattenFolders ?? config.flatten_folders ?? false,
        webp_conversion: options.webp_conversion ?? options.webpConversion ?? config.webp_conversion ?? false,
        img_quality: options.img_quality ?? config.img_quality ?? config.jpg_quality ?? 100,
        max_threads: options.max_threads ?? config.max_threads ?? 1,
      }, (progress) => {
        event.sender.send('task:progress', { task: 'organizer:execute', ...progress });
      });
    } finally {
      cancellationRegistry.finish(event.sender.id, taskId, controller);
    }
  });

  // ========== 내부 파일명 변경 ==========
  ipcMain.handle('renamer:analyze', async (event, paths, options = {}) => {
    const taskId = 'renamer';
    const controller = cancellationRegistry.start(event.sender.id, taskId);
    const sevenZExe = options.sevenZExe || await getBinPath('7za') || await getBinPath('7z');
    try {
      return await analyzeRenamerInputs(paths, {
        ...options,
        sevenZExe,
        shouldCancel: () => controller.shouldCancel(),
        lang: options.lang || configManager.getConfig()?.language || configManager.getConfig()?.lang || 'ko',
      }, (progress) => {
        event.sender.send('task:progress', { task: 'renamer:analyze', ...progress });
      });
    } finally {
      cancellationRegistry.finish(event.sender.id, taskId, controller);
    }
  });

  ipcMain.handle('renamer:extractImage', async (_event, filePath, entryPath) => {
    const sevenZExe = await getBinPath('7za') || await getBinPath('7z');
    return extractRenamerImage(filePath, entryPath, sevenZExe, {
      transformBuffer: createRenamerPreviewBuffer,
    });
  });

  ipcMain.handle('renamer:execute', async (event, items, options = {}) => {
    const taskId = 'renamer';
    const controller = cancellationRegistry.start(event.sender.id, taskId);
    const config = configManager.getConfig() || {};
    const sevenZExe = options.sevenZExe || await getBinPath('7za') || await getBinPath('7z');
    const cwebpExe = options.cwebpExe || await getBinPath('cwebp');
    const cjpegExe = options.cjpegExe || await getBinPath('cjpeg');
    const djpegExe = options.djpegExe || await getBinPath('djpeg');
    const pngquantExe = options.pngquantExe || await getBinPath('pngquant');
    const jpegtranExe = options.jpegtranExe || await getBinPath('jpegtran');
    try {
      return await executeRenamer(items, {
        ...config,
        ...options,
        sevenZExe,
        cwebpExe,
        cjpegExe,
        djpegExe,
        pngquantExe,
        jpegtranExe,
        shouldCancel: () => controller.shouldCancel(),
        lang: options.lang || config.language || config.lang || 'ko',
        target_format: options.target_format ?? config.target_format ?? 'none',
        backup_on: options.backup_on ?? config.backup_on ?? false,
        flattenFolders: options.flattenFolders ?? config.flatten_folders ?? false,
        webp_conversion: options.webp_conversion ?? options.webpConversion ?? config.webp_conversion ?? false,
        webpConversion: options.webpConversion ?? options.webp_conversion ?? config.webp_conversion ?? false,
        img_quality: options.img_quality ?? config.img_quality ?? config.jpg_quality ?? 100,
        max_threads: options.max_threads ?? config.max_threads ?? 1,
      }, (progress) => {
        event.sender.send('task:progress', { task: 'renamer:execute', ...progress });
      });
    } finally {
      cancellationRegistry.finish(event.sender.id, taskId, controller);
    }
  });

  // ========== 메타데이터 관리 ==========
  ipcMain.handle('metadata:analyze', async (event, paths, options = {}) => {
    const sevenZExe = options.sevenZExe || await getBinPath('7za') || await getBinPath('7z');
    return analyzeMetadataInputs(paths, {
      ...options,
      sevenZExe,
      dbPath: libraryDbPath(),
      lang: options.lang || configManager.getConfig()?.language || configManager.getConfig()?.lang || 'ko',
    }, (progress) => {
      event.sender.send('task:progress', { task: 'metadata:analyze', ...progress });
    });
  });

  ipcMain.handle('metadata:latest', async (_event, criteria = {}) => {
    const sevenZExe = await getBinPath('7za') || await getBinPath('7z');
    return loadLatestSeriesMetadata(criteria, {
      sevenZExe,
      dbPath: libraryDbPath(),
      lang: configManager.getConfig()?.language || configManager.getConfig()?.lang || 'ko',
    });
  });

  ipcMain.handle('metadata:cover', async (_event, filePath, options = {}) => {
    const sevenZExe = options.sevenZExe || await getBinPath('7za') || await getBinPath('7z');
    return loadMetadataCover(filePath, {
      ...options,
      sevenZExe,
      dbPath: libraryDbPath(),
    });
  });

  ipcMain.handle('api:identifyCoverTitles', async (_event, options = {}) => {
    const config = configManager.getConfig() || {};
    const apiKeys = config.api_keys || {};
    const provider = apiKeys.ai_provider === 'OpenAI' ? 'OpenAI' : 'Gemini';
    try {
      let coverDataUrl = String(options.coverDataUrl || '');
      if (!parseImageDataUrl(coverDataUrl) && options.filePath) {
        const sevenZExe = await getBinPath('7za') || await getBinPath('7z');
        coverDataUrl = await loadMetadataCover(options.filePath, { sevenZExe }) || '';
      }
      const result = await identifyCoverTitlesFromImage(
        coverDataUrl,
        apiKeys,
      );
      metadataSearchLog('Cover title identification completed', {
        provider: result.provider,
        model: result.model,
        candidateCount: result.candidates.length,
        confidence: result.confidence,
        verified: result.verified,
        sourceCount: result.sources.length,
      });
      return { success: true, ...result };
    } catch (error) {
      metadataSearchLog('Cover title identification failed', {
        provider,
        error: error.message || String(error),
      });
      return {
        success: false,
        error: error.userFacing ? error.message : aiProviderError(provider, error),
      };
    }
  });

  ipcMain.handle('metadata:epubImages', async (_event, filePath) => {
    return listMetadataEpubImages(filePath);
  });

  ipcMain.handle('metadata:epubImage', async (_event, filePath, entryName) => {
    return loadMetadataEpubImage(filePath, entryName);
  });

  ipcMain.handle('metadata:imageFile', async (_event, filePath) => {
    return loadMetadataImageFile(filePath);
  });

  ipcMain.handle('metadata:exportCover', async (event, options = {}) => {
    const filePath = String(options.filePath || '');
    const sevenZExe = await getBinPath('7za') || await getBinPath('7z');
    const coverDataUrl = String(options.coverDataUrl || '') || await loadMetadataCover(filePath, {
      sevenZExe,
      dbPath: libraryDbPath(),
    });
    const cover = decodeMetadataCoverDataUrl(coverDataUrl);
    if (!cover) return { success: false, reason: 'no_cover' };

    const window = BrowserWindow.fromWebContents(event.sender);
    const result = await dialog.showSaveDialog(window, {
      title: options.title || i18nT('audio_cover_export'),
      defaultPath: filePath
        ? path.join(path.dirname(filePath), defaultMetadataCoverName(filePath, cover.extension))
        : defaultMetadataCoverName('', cover.extension),
      filters: [{ name: 'Image', extensions: [cover.extension.slice(1)] }],
    });
    const destinationPath = normalizeSaveDialogResult(result);
    if (!destinationPath) return { success: false, cancelled: true };
    await fs.promises.writeFile(destinationPath, cover.buffer);
    return { success: true, filePath: destinationPath };
  });

  ipcMain.handle('metadata:cacheRemoteCover', async (_event, imageUrl) => {
    const filePath = await fetchImageCacheFileFromUrl(imageUrl, apiCoverCacheDir());
    return {
      filePath,
      coverCacheUrl: apiCoverCacheUrlForFile(filePath),
    };
  });

  ipcMain.handle('metadata:save', async (event, items, options = {}) => {
    const taskId = 'metadata';
    const controller = cancellationRegistry.start(event.sender.id, taskId);
    const config = configManager.getConfig() || {};
    const sevenZExe = options.sevenZExe || await getBinPath('7za') || await getBinPath('7z');
    try {
      return await saveMetadataItems(items, {
        ...config,
        ...options,
        sevenZExe,
        dbPath: libraryDbPath(),
        thumbnailDir: thumbnailDir(),
        thumbnailEncoder: encodeThumbnail,
        normalizeEpubCoverImage: normalizeEpubCoverImageBuffer,
        refreshFilePreview: filePath => inspectFolderFile(filePath, {
          dbPath: libraryDbPath(),
          thumbnailDir: thumbnailDir(),
          sevenZExe,
          force: true,
          thumbnailEncoder: encodeThumbnail,
        }),
        shouldCancel: () => controller.shouldCancel(),
        lang: options.lang || config.language || config.lang || 'ko',
      }, (progress) => {
        event.sender.send('task:progress', { task: 'metadata:save', ...progress });
      });
    } finally {
      cancellationRegistry.finish(event.sender.id, taskId, controller);
    }
  });

  ipcMain.handle('api:fetch', async (_event, options = {}) => {
    const config = configManager.getConfig() || {};
    const apiKeys = { ...(config.api_keys || {}), ...(options.apiKeys || {}) };
    const apiName = normalizeApiSource(options.api || options.apiName || options.source || options.apiSource);
    const bookType = normalizeSearchBookType(options.bookType || options.mediaType || options.type);
    const query = String(options.query || '').trim();
    const page = Number(options.page || 1);

    if (!query) return { success: true, api: apiName, actualQuery: query, results: [] };
    if (!isMetadataApiAllowedForBookType(apiName, bookType)) {
      return {
        success: false,
        api: apiName,
        actualQuery: query,
        results: [],
        error: i18nT('api_search_unsupported', { api: apiName }),
        cached: false,
      };
    }
    metadataSearchLog('Search started', { api: apiName, query, page });

    let actualQuery = query;
    metadataSearchLog('Direct search query ready', {
      api: apiName,
      query,
      page,
    });
    const apiCacheDb = openApiCacheDbSafe();
    const cacheQuery = `${bookType}::${query}::p${page}::v17`;
    try {
      if (apiCacheDb) {
        const cachedResults = getCachedApiResults(apiCacheDb, apiName, cacheQuery);
        if (cachedResults) {
          actualQuery = cachedResults[0]?.identifiedSearchQuery || actualQuery;
          metadataSearchLog('Search cache hit', {
            api: apiName,
            query,
            actualQuery,
            page,
            resultCount: cachedResults.length,
          });
          return {
            success: true,
            api: apiName,
            actualQuery,
            results: await enrichResultImages(cachedResults, apiCoverCacheDir()),
            cached: true,
          };
        }
      }
    } finally {
      if (apiCacheDb) apiCacheDb.close();
    }

    let results = [];
    try {
      if (apiName === 'Google Books') {
        results = await searchGoogleBooks(query, apiKeys.google || '', page, bookType);
      } else if (apiName === 'Anilist') {
        results = await searchAnilist(query, page);
      } else if (apiName === '리디북스') {
        results = await searchRidibooks(query, page, bookType);
      } else if (apiName === '알라딘') {
        results = await searchAladin(query, apiKeys.aladin || '', page, bookType);
      } else if (apiName === 'Amazon') {
        results = await searchAmazon(query, page, bookType);
      } else if (apiName === 'Vine') {
        results = await searchVine(query, apiKeys.vine || '', page);
      } else {
        throw new Error(i18nT('api_search_unsupported', { api: apiName }));
      }
    } catch (error) {
      metadataSearchLog('Search failed', { api: apiName, query, actualQuery, page, error: error.message || String(error) });
      return {
        success: false,
        api: apiName,
        actualQuery,
        results: [],
        error: error.message || String(error),
        cached: false,
      };
    }
    if (apiName === 'Anilist' || apiName === 'Vine' || apiName === 'Amazon') {
      results = results.map(result => ({ ...result, identifiedSearchQuery: actualQuery }));
    }
    results = await enrichResultImages(results, apiCoverCacheDir());
    metadataSearchLog('Search completed', {
      api: apiName,
      query,
      actualQuery,
      page,
      resultCount: results.length,
      cached: false,
    });

    const writeCacheDb = openApiCacheDbSafe();
    try {
      if (writeCacheDb && Array.isArray(results) && results.length > 0) {
        await setCachedApiResults(writeCacheDb, apiName, cacheQuery, stripTransientApiImageFieldsFromResults(results));
      }
    } finally {
      if (writeCacheDb) writeCacheDb.close();
    }

    return { success: true, api: apiName, actualQuery, results, cached: false };
  });

  ipcMain.handle('api:ridiBookDetail', async (_event, bookId) => getRidiBookDetail(bookId));
  ipcMain.handle('api:ridiPublishDate', async (_event, bookId) => getRidiPublishDate(bookId));

  ipcMain.handle('api:translateMetadata', async (_event, result = {}) => {
    const config = configManager.getConfig() || {};
    const apiKeys = config.api_keys || {};
    const targetLang = config.language || config.lang || 'ko';
    metadataSearchLog('Metadata translation started', {
      api: result?.identifiedSearchQuery ? 'Foreign metadata' : 'Metadata',
      title: result?.title || result?.Title || result?.metadata?.Title || '',
      targetLang,
      provider: apiKeys.ai_provider || 'Gemini',
      hasAiCredential: Boolean(coverAiCredential(apiKeys, apiKeys.ai_provider)),
    });
    try {
      const translated = await translateMetadataResult(result, apiKeys, targetLang);
      metadataSearchLog('Metadata translation completed', {
        title: result?.title || result?.Title || result?.metadata?.Title || '',
        translatedTitle: translated?.title || translated?.Title || translated?.metadata?.Title || '',
        targetLang,
      });
      return { success: true, result: translated };
    } catch (error) {
      metadataSearchLog('Metadata translation failed', {
        title: result?.title || result?.Title || result?.metadata?.Title || '',
        targetLang,
        error: error.message || String(error),
      });
      return { success: false, error: error.message || String(error) };
    }
  });

  ipcMain.handle('api:openaiTts', async (_event, options = {}) => {
    const config = configManager.getConfig() || {};
    try {
      return await createOpenAiTtsDataUrl(options, config.api_keys || {});
    } catch (error) {
      const normalized = normalizeOpenAiTtsError(error);
      return {
        success: false,
        code: normalized.code,
        error: normalized.error,
      };
    }
  });

  ipcMain.handle('api:googleTts', async (_event, options = {}) => {
    const config = configManager.getConfig() || {};
    try {
      return await createGoogleTtsDataUrl(options, config.api_keys || {});
    } catch (error) {
      const normalized = normalizeGoogleTtsError(error);
      return {
        success: false,
        code: normalized.code,
        error: normalized.error,
      };
    }
  });

  ipcMain.handle('api:imageDataUrl', async (_event, imageUrl) => {
    const url = String(imageUrl || '').trim();
    if (!url) return '';
    return fetchImageDataUrlFromUrl(url);
  });

  // Legacy preload aliases kept for older migrated UI paths.
  ipcMain.handle('task:organize:start', async (event, options = {}) => {
    const paths = options.paths || options.files || [];
    const sevenZExe = options.sevenZExe || await getBinPath('7za') || await getBinPath('7z');
    const items = options.items || (await analyzeOrganizerInputs(paths, { ...options, sevenZExe }, (progress) => {
      event.sender.send('task:progress', { task: 'organizer:analyze', ...progress });
    })).items;
    return executeOrganizer(items, { ...configManager.getConfig(), ...options, sevenZExe }, (progress) => {
      event.sender.send('task:progress', { task: 'organizer:execute', ...progress });
    });
  });

  ipcMain.handle('task:rename:start', async (event, options = {}) => {
    const paths = options.paths || options.files || [];
    const sevenZExe = options.sevenZExe || await getBinPath('7za') || await getBinPath('7z');
    const items = options.items || (await analyzeRenamerInputs(paths, { ...options, sevenZExe }, (progress) => {
      event.sender.send('task:progress', { task: 'renamer:analyze', ...progress });
    })).items;
    return executeRenamer(items, { ...configManager.getConfig(), ...options, sevenZExe }, (progress) => {
      event.sender.send('task:progress', { task: 'renamer:execute', ...progress });
    });
  });

  ipcMain.handle('task:extract:start', async () => {
    return { success: false, message: i18nT('task_extract_integrated') };
  });

  ipcMain.handle('task:stop', async (event, taskId) => {
    const success = cancellationRegistry.cancel(event.sender.id, String(taskId || ''));
    return {
      success,
      message: success ? i18nT('task_cancel_sent') : i18nT('task_cancel_not_found'),
    };
  });

  // ========== 공유 서버 ==========
  ipcMain.handle('server:start', async (event, serverType, options = {}) => {
    const sendServerLog = log => {
        if (!event.sender.isDestroyed()) {
            event.sender.send('server:log', { ...log, status: getSharingServerStatus() });
        }
    };
    const config = configManager.getConfig() || {};
    const normalizedServerType = normalizeSharingServerType(serverType);
    if (!normalizedServerType) {
        throw new Error(i18nT('sharing_invalid_server_type', { server: String(serverType || '') }));
    }
    const sharingHttpsEnabled = Boolean(options.https ?? config.sharing_https_enabled);
    const sharingServerAddress = normalizeSharingServerAddress(options.address ?? config.sharing_server_address);
    let updates = {
        opds_port: Number(options.port) || config.opds_port || 8080,
        sharing_https_enabled: sharingHttpsEnabled,
        sharing_server_address: sharingServerAddress,
    };
    if (normalizedServerType === 'Web') {
        updates = {
            web_port: Number(options.port) || config.web_port || 8082,
            sharing_https_enabled: sharingHttpsEnabled,
            sharing_server_address: sharingServerAddress,
        };
    } else if (normalizedServerType === 'WebDAV') {
        updates = {
            webdav_port: Number(options.port) || config.webdav_port || 8081,
            webdav_username: String(options.username ?? config.webdav_username ?? 'user').trim() || 'user',
            webdav_password: String(options.password ?? config.webdav_password ?? '1234').trim() || '1234',
            sharing_https_enabled: sharingHttpsEnabled,
            sharing_server_address: sharingServerAddress,
        };
    }
    configManager.saveConfig({ ...config, ...updates });
    const sevenZExe = ['OPDS', 'Web'].includes(normalizedServerType)
        ? await getBinPath('7za') || await getBinPath('7z')
        : '';
    return startSharingServer(
        normalizedServerType,
        {
            ...options,
            port: updates.webdav_port || updates.web_port || updates.opds_port,
            address: sharingServerAddress,
            https: sharingHttpsEnabled,
            httpsCertDir: path.join(configManager.userDataPath, 'sharing-cert'),
            dbPath: libraryDbPath(),
            thumbnailDir: thumbnailDir(),
            sevenZExe,
        },
        configManager.getConfig(),
        sendServerLog,
    );
  });

  ipcMain.handle('server:stop', async (event, serverType) => {
    const config = configManager.getConfig() || {};
    return stopSharingServer(serverType, log => {
        if (!event.sender.isDestroyed()) {
            event.sender.send('server:log', { ...log, status: getSharingServerStatus() });
        }
    }, config);
  });

  ipcMain.handle('server:status', () => {
    const config = configManager.getConfig() || {};
    setSharingServerAddress(config.sharing_server_address);
    return getSharingServerStatus();
  });

  ipcMain.handle('server:addresses', () => {
    return getSharingNetworkAddresses();
  });

  ipcMain.handle('server:setAddress', (_event, address) => {
    const nextAddress = setSharingServerAddress(address);
    configManager.saveConfig({
        ...configManager.getConfig(),
        sharing_server_address: nextAddress,
    });
    return {
        address: nextAddress,
        status: getSharingServerStatus(),
    };
  });

  // ========== 캐시/인덱스 관리 ==========
  ipcMain.handle('cache:clearApi', async () => {
    metadataTranslationCache.clear();
    coverTitleIdentificationCache.clear();
    imageDataUrlCache.clear();
    apiCoverUrlCache.clear();
    const legacyTargets = [
      path.join(resolveAppDataDir(getExecutableDir()), '.api_cache.json'),
      path.join(configManager.userDataPath, '.api_cache.json'),
      path.join(getExecutableDir(), '.api_cache.json'),
    ];
    const cacheResults = [
      clearApiCacheSafe(
        apiCacheDbPath(),
        [apiCoverCacheDir()],
      ),
      clearApiCacheSafe(
        path.join(configManager.userDataPath, '.api_cache.db'),
        [path.join(configManager.userDataPath, 'api_cover_cache')],
      ),
      clearApiCacheSafe(
        path.join(getExecutableDir(), '.api_cache.db'),
        [path.join(getExecutableDir(), 'api_cover_cache')],
      ),
    ];
    const cacheResult = cacheResults.reduce((total, result) => ({
      deletedRows: total.deletedRows + result.deletedRows,
      deletedFiles: total.deletedFiles + result.deletedFiles,
    }), { deletedRows: 0, deletedFiles: 0 });
    let deleted = 0;
    for (const target of legacyTargets) {
      if (fs.existsSync(target)) {
        fs.unlinkSync(target);
        deleted += 1;
      }
    }
    return { success: true, deleted, ...cacheResult };
  });

  ipcMain.handle('folder:clearDupCache', async () => {
    const db = new LibraryDB({ dbPath: libraryDbPath() });
    try {
      const result = await db.clearDupCache();
      return { success: true, changes: result.changes };
    } finally {
      await db.close();
    }
  });

  ipcMain.handle('folder:searchLibraryFiles', async (_event, queryOrPayload = '', librariesArg = [], optionsArg = {}) => {
    const payload = queryOrPayload && typeof queryOrPayload === 'object'
      ? queryOrPayload
      : { query: queryOrPayload, libraries: librariesArg, options: optionsArg };
    const config = configManager.getConfig() || {};
    const targetLibraries = [...new Set((payload.libraries?.length > 0
      ? payload.libraries
      : [...(config.libraries || []), ...(config.dup_check_folders || [])])
      .filter(Boolean)
      .map(folder => path.resolve(folder)))];
    const searchInWorker = () => librarySearchService.search(
      payload.query || '',
      targetLibraries,
      payload.options || {},
    );
    let rows;
    try {
      rows = await searchInWorker();
    } catch (error) {
      if (!isRetryableLibrarySearchWorkerError(error)) throw error;
      console.warn(`[LibrarySearch] Worker transport failed; retrying once: ${error.message}`);
      try {
        rows = await searchInWorker();
      } catch (retryError) {
        console.warn(`[LibrarySearch] Worker retry failed: ${retryError.message}`);
        throw retryError;
      }
    }
    return rows.map(normalizeLibrarySearchFileForRenderer);
  });

  ipcMain.handle('folder:getLibraryTagFacets', async (_event, payload = {}) => {
    const config = configManager.getConfig() || {};
    const targetLibraries = [...new Set((payload.libraries?.length > 0
      ? payload.libraries
      : (config.libraries || []))
      .filter(Boolean)
      .map(folder => path.resolve(folder)))];
    const readInWorker = () => librarySearchService.tagFacets(targetLibraries);
    let result;
    try {
      result = await readInWorker();
    } catch (error) {
      if (!isRetryableLibrarySearchWorkerError(error)) throw error;
      console.warn(`[LibraryTagFacets] Worker transport failed; retrying once: ${error.message}`);
      result = await readInWorker();
    }
    return result;
  });

  ipcMain.handle('folder:searchLibraryTags', async (_event, payload = {}) => {
    const config = configManager.getConfig() || {};
    const targetLibraries = [...new Set((payload.libraries?.length > 0
      ? payload.libraries
      : (config.libraries || []))
      .filter(Boolean)
      .map(folder => path.resolve(folder)))];
    const searchInWorker = () => librarySearchService.searchTags(
      targetLibraries,
      payload.selections || [],
      payload.matchMode,
    );
    let rows;
    try {
      rows = await searchInWorker();
    } catch (error) {
      if (!isRetryableLibrarySearchWorkerError(error)) throw error;
      console.warn(`[LibraryTagSearch] Worker transport failed; retrying once: ${error.message}`);
      rows = await searchInWorker();
    }
    return rows.map(normalizeLibrarySearchFileForRenderer);
  });

  ipcMain.handle('folder:searchLibraryContent', async (_event, payload = {}) => {
    const config = configManager.getConfig() || {};
    const targetLibraries = [...new Set((payload.libraries?.length > 0
      ? payload.libraries
      : (config.libraries || []))
      .filter(Boolean)
      .map(folder => path.resolve(folder)))];
    const documents = await contentIndexService.search(
      payload.query || '',
      targetLibraries,
      payload.options || {},
    );
    if (!Array.isArray(documents) || documents.length === 0) return [];

    const db = new LibraryDB({ dbPath: libraryDbPath() });
    try {
      const metadataRows = await db.getFilesByPaths(documents.map(document => document.path));
      const metadataByPath = new Map(metadataRows.map(row => [path.resolve(row.path), row]));
      return documents.map(document => normalizeLibrarySearchFileForRenderer({
        ...document,
        ...(metadataByPath.get(path.resolve(document.path)) || {}),
        path: document.path,
        size: metadataByPath.get(path.resolve(document.path))?.size || document.size,
        mtime: metadataByPath.get(path.resolve(document.path))?.mtime || document.mtime,
      }));
    } finally {
      await db.close();
    }
  });

  ipcMain.handle('folder:getContentIndexStatus', async (_event, payload = {}) => {
    const config = configManager.getConfig() || {};
    const libraries = [...new Set((payload.libraries?.length > 0
      ? payload.libraries
      : (config.libraries || []))
      .filter(Boolean)
      .map(folder => path.resolve(folder)))];
    const status = await contentIndexService.getStatus(libraries);
    return {
      ...status,
      dbPath: contentIndexDbPath(),
    };
  });

  ipcMain.handle('folder:startContentIndex', async (_event, payload = {}) => {
    const config = configManager.getConfig() || {};
    const activeLibraries = [...new Set([
      ...(config.libraries || []),
      ...(config.dup_check_folders || []),
    ].filter(Boolean).map(folder => path.resolve(folder)))];
    const libraries = [...new Set((payload.libraries?.length > 0
      ? payload.libraries
      : activeLibraries)
      .filter(Boolean)
      .map(folder => path.resolve(folder)))];
    const db = new LibraryDB({ dbPath: libraryDbPath() });
    try {
      const entries = [];
      const authoritativeLibraries = [];
      for (const libraryPath of libraries) {
        const targetRows = await db.getTargetIndex(libraryPath);
        entries.push(...targetRows);
        if (targetRows.length > 0) authoritativeLibraries.push(libraryPath);
      }
      return await contentIndexService.startIndex(entries, libraries, {
        ...(payload.options || {}),
        activeLibraries,
        authoritativeLibraries,
      });
    } finally {
      await db.close();
    }
  });

  ipcMain.handle('folder:stopContentIndex', () => contentIndexService.cancelIndex());
  ipcMain.handle('folder:clearContentIndex', () => contentIndexService.clear());

  ipcMain.handle('folder:getLibraryScanStates', async (_event, folders = []) => {
    const targetFolders = [...new Set((folders || []).filter(Boolean).map(folder => path.resolve(folder)))];
    const db = new LibraryDB({ dbPath: libraryDbPath() });
    try {
      const states = await db.getLibraryScanStates(targetFolders);
      const stateByPath = new Map(states.map(state => [path.resolve(state.library_path), state]));
      return targetFolders.map(folder => normalizeLibraryScanStateForRenderer(
        folder,
        stateByPath.get(folder),
        fs.existsSync(folder),
      ));
    } finally {
      await db.close();
    }
  });

  ipcMain.handle('folder:getLibraryFolderChildren', async (_event, libraryPath = '', parentPath = '') => {
    const normalizedLibraryPath = libraryPath ? path.resolve(libraryPath) : '';
    const normalizedParentPath = parentPath ? path.resolve(parentPath) : normalizedLibraryPath;
    if (!normalizedLibraryPath || !normalizedParentPath || !fs.existsSync(normalizedLibraryPath)) {
      return { indexed: false, exists: false, children: [] };
    }
    const db = new LibraryDB({ dbPath: libraryDbPath() });
    try {
      let indexed = await db.hasLibraryFolderIndex(normalizedLibraryPath);
      if (!indexed) {
        const targetRows = await db.getTargetIndex(normalizedLibraryPath);
        const targetPaths = targetRows.map(row => row.full_path || row.file_path || row.path).filter(Boolean);
        if (targetPaths.length > 0) {
          await db.replaceLibraryFolders(
            normalizedLibraryPath,
            buildLibraryFolderIndexRecords(normalizedLibraryPath, [], targetPaths),
          );
          indexed = true;
        }
      }
      if (!indexed) return { indexed: false, exists: true, children: [] };
      const children = await db.getLibraryFolderChildren(normalizedLibraryPath, normalizedParentPath);
      return {
        indexed: true,
        exists: true,
        children: children.map(normalizeLibraryFolderForRenderer),
      };
    } finally {
      await db.close();
    }
  });

  ipcMain.handle('folder:updateIndex', async (event, folders = null, options = {}) => {
    const taskId = 'folder:updateIndex';
    const controller = cancellationRegistry.start(event.sender.id, taskId);
    const shouldCancel = () => controller.shouldCancel();
    const config = configManager.getConfig() || {};
    const lang = options.language || config.language || config.lang || 'ko';
    setLanguage(lang);
    const mode = options.mode === 'smart' ? 'smart' : 'force';
    const shouldOptimizeMetadata = options.optimizeMetadata === true;
    const metadataOnly = shouldOptimizeMetadata && options.metadataOnly === true;
    const forceMetadata = mode === 'force'
      ? true
      : options.forceMetadata === true;
    const skipMetadataCoverExtraction = options.skipCoverExtraction === true;
    const lastMtimes = { ...(config.index_last_mtimes || {}) };
    const priorityFolder = options.priorityFolder
      ? path.resolve(options.priorityFolder)
      : (config.last_selected_library ? path.resolve(config.last_selected_library) : '');
    const targetFolders = (folders || config.dup_check_folders || config.libraries || [])
      .filter(Boolean)
      .map(folder => path.resolve(folder))
      .filter(folder => fs.existsSync(folder))
      .sort((left, right) => {
        if (priorityFolder && isPathInsideOrEqual(priorityFolder, left)) return -1;
        if (priorityFolder && isPathInsideOrEqual(priorityFolder, right)) return 1;
        return 0;
      });

    const db = new LibraryDB({ dbPath: libraryDbPath() });
    let activeFolder = '';
    let activeState = null;
    let scanHeartbeatPromise = Promise.resolve();
    let lastScanHeartbeatAt = 0;
    const queueLibraryScanHeartbeat = (folder, rootMtime, scanReason) => {
      const nowMs = Date.now();
      if (nowMs - lastScanHeartbeatAt < 5000) return;
      lastScanHeartbeatAt = nowMs;
      const checkedAt = new Date(nowMs).toISOString();
      const stateSnapshot = {
        ...(activeState || {}),
        library_path: folder,
        status: 'scanning',
        root_mtime: rootMtime,
        last_checked_at: checkedAt,
        last_error: '',
        scan_reason: scanReason,
      };
      scanHeartbeatPromise = scanHeartbeatPromise
        .catch(() => {})
        .then(() => db.saveLibraryScanState(stateSnapshot).catch(() => {}));
    };
    const flushLibraryScanHeartbeat = async () => {
      await scanHeartbeatPromise.catch(() => {});
    };
    try {
      let total = 0;
      let changedTotal = 0;
      let skippedFolders = 0;
      let metadataTotal = 0;
      let visualTotal = 0;
      const metadataTargetsByFolder = new Map();
      const scanStateByFolder = new Map();
      const sevenZExe = await getBinPath('7za') || await getBinPath('7z');
      console.log(`[LibraryIndex] start folders=${targetFolders.length} mode=${mode} optimizeMetadata=${shouldOptimizeMetadata} metadataOnly=${metadataOnly}`);
      if (metadataOnly) {
        for (const folder of targetFolders) {
          throwIfTaskCancelled(shouldCancel);
          activeFolder = folder;
          activeState = await db.getLibraryScanState(folder);
          const targets = (await db.getTargetIndex(folder))
            .map(row => row.full_path)
            .filter(filePath => filePath && fs.existsSync(filePath));
          total += targets.length;
          metadataTargetsByFolder.set(folder, targets);
          const metadataState = {
            ...(activeState || {}),
            library_path: folder,
            status: 'scanning',
            file_count: Number(activeState?.file_count || targets.length),
            indexed_count: Number(activeState?.indexed_count || targets.length),
            last_checked_at: nowIsoString(),
            last_error: '',
            scan_reason: 'metadata',
          };
          await db.saveLibraryScanState(metadataState);
          scanStateByFolder.set(folder, metadataState);
        }
      } else {
        for (let index = 0; index < targetFolders.length; index += 1) {
          throwIfTaskCancelled(shouldCancel);
          const folder = targetFolders[index];
          activeFolder = folder;
          activeState = await db.getLibraryScanState(folder);
          const checkedAt = nowIsoString();
          const rootMtime = safeStatMtime(folder);
          await db.saveLibraryScanState({
            ...(activeState || {}),
            library_path: folder,
            status: 'scanning',
            root_mtime: rootMtime,
            last_checked_at: checkedAt,
            last_error: '',
            scan_reason: shouldOptimizeMetadata ? 'metadata' : mode,
          });
          lastScanHeartbeatAt = Date.now();
          console.log(`[LibraryIndex] scanning ${index + 1}/${targetFolders.length}: ${folder}`);
          const scannedFolderPaths = new Set();
          const filePaths = await scanArchivePaths(folder, priorityFolder, progress => {
            const message = i18nT('dup_scan_progress_live', [
              progress.scannedCount,
              progress.matchedCount,
              progress.elapsedSeconds || 0,
            ]);
            queueLibraryScanHeartbeat(folder, rootMtime, shouldOptimizeMetadata ? 'metadata' : mode);
            const liveFloor = progress.matchedCount > 0 ? 0.08 : progress.scannedCount > 0 ? 0.02 : 0;
            const folderProgress = Math.min(
              0.95,
              Math.max(liveFloor, progress.scannedCount / (progress.scannedCount + 200)),
            );
            const overallProgress = Math.min(
              95,
              Math.max(
                progress.scannedCount > 0 || progress.elapsedSeconds > 0 ? 1 : 0,
                Math.round(((index + folderProgress) / Math.max(targetFolders.length, 1)) * 100),
              ),
            );
            console.log(`[LibraryIndex] scanning ${index + 1}/${targetFolders.length} scanned=${progress.scannedCount} matched=${progress.matchedCount} current=${progress.currentPath}`);
            if (!event.sender.isDestroyed()) {
              event.sender.send('task:progress', {
                task: 'folder:updateIndex',
                progress: overallProgress,
                message,
                libraryPhase: 'indexing',
                currentFile: progress.currentPath,
                currentFileName: path.basename(progress.currentPath || ''),
              });
            }
          }, shouldCancel, null, folderPath => scannedFolderPaths.add(folderPath));
          await flushLibraryScanHeartbeat();
          throwIfTaskCancelled(shouldCancel);
          const folderIndexRecords = buildLibraryFolderIndexRecords(folder, scannedFolderPaths, filePaths);
          const entries = await buildArchiveIndexEntries(filePaths, folder, {
            shouldCancel,
            onProgress: progress => {
              if (event.sender.isDestroyed()) return;
              event.sender.send('task:progress', {
                task: 'folder:updateIndex',
                progress: Math.min(95, Math.round(((index + 0.96) / Math.max(targetFolders.length, 1)) * 100)),
                message: i18nT('dup_scan_progress', [progress.completedCount, progress.totalCount]),
                libraryPhase: 'indexing',
                currentFile: progress.currentPath,
                currentFileName: path.basename(progress.currentPath || ''),
              });
            }
          });
          const fingerprint = createArchiveFingerprint(entries);
          const previousFingerprint = activeState?.fingerprint || lastMtimes[folder] || '';
          if (mode === 'smart' && previousFingerprint === fingerprint) {
            const scannedAt = nowIsoString();
            skippedFolders += 1;
            total += entries.length;
            await db.replaceLibraryFolders(folder, folderIndexRecords);
            metadataTargetsByFolder.set(
              folder,
              shouldOptimizeMetadata ? entries.map(entry => entry.full_path) : [],
            );
            lastMtimes[folder] = fingerprint;
            const readyState = {
              ...(activeState || {}),
              library_path: folder,
              status: 'ready',
              fingerprint,
              root_mtime: safeStatMtime(folder),
              file_count: entries.length,
              indexed_count: Number(activeState?.indexed_count || entries.length),
              added_count: 0,
              updated_count: 0,
              removed_count: 0,
              last_checked_at: scannedAt,
              last_scanned_at: scannedAt,
              last_changed_at: activeState?.last_changed_at || '',
              last_error: '',
              scan_reason: shouldOptimizeMetadata ? 'metadata' : mode,
            };
            await db.saveLibraryScanState(readyState);
            scanStateByFolder.set(folder, readyState);
            console.log(`[LibraryIndex] skipped unchanged ${index + 1}/${targetFolders.length}: ${folder} matched=${entries.length}`);
            continue;
          }
          throwIfTaskCancelled(shouldCancel);
          console.log(`[LibraryIndex] writing index ${index + 1}/${targetFolders.length}: ${folder} matched=${entries.length}`);
          if (!event.sender.isDestroyed()) {
            event.sender.send('task:progress', {
              task: 'folder:updateIndex',
              progress: Math.round((index / Math.max(targetFolders.length, 1)) * 100),
              message: i18nT('dup_scan_progress', [total, entries.length]),
              libraryPhase: 'indexing',
              currentFile: folder,
              currentFileName: path.basename(folder),
            });
          }
          const syncResult = await db.syncTargetIndex(folder, entries);
          await db.replaceLibraryFolders(folder, folderIndexRecords);
          const changedCount = syncResult.addedCount + syncResult.updatedCount + syncResult.removedCount;
          changedTotal += changedCount;
          total += syncResult.indexedCount;
          metadataTargetsByFolder.set(
            folder,
            (shouldOptimizeMetadata || mode === 'force')
              ? entries.map(entry => entry.full_path)
              : [...syncResult.added, ...syncResult.updated],
          );
          const scannedAt = nowIsoString();
          const indexedState = {
            library_path: folder,
            status: 'scanning',
            fingerprint,
            root_mtime: safeStatMtime(folder),
            file_count: entries.length,
            indexed_count: syncResult.indexedCount,
            added_count: syncResult.addedCount,
            updated_count: syncResult.updatedCount,
            removed_count: syncResult.removedCount,
            last_scanned_at: scannedAt,
            last_checked_at: scannedAt,
            last_changed_at: changedCount > 0 ? scannedAt : (activeState?.last_changed_at || ''),
            last_error: '',
            scan_reason: shouldOptimizeMetadata ? 'metadata' : mode,
          };
          await db.saveLibraryScanState(indexedState);
          scanStateByFolder.set(folder, indexedState);
          lastMtimes[folder] = fingerprint;
        }
        configManager.updateConfig({ index_last_mtimes: lastMtimes });
      }

      const foldersWithMetadataTargets = targetFolders
        .filter(folder => {
          if (!metadataTargetsByFolder.has(folder)) return false;
          const targets = metadataTargetsByFolder.get(folder);
          return targets === null || targets.length > 0;
        });
      const metadataTargetFolderSet = new Set(foldersWithMetadataTargets);
      if (foldersWithMetadataTargets.length > 0) {
        console.log(`[LibraryIndex] metadata extraction start folders=${foldersWithMetadataTargets.length} optimizeMetadata=${shouldOptimizeMetadata}`);
        for (let index = 0; index < targetFolders.length; index += 1) {
          throwIfTaskCancelled(shouldCancel);
          const folder = targetFolders[index];
          if (!metadataTargetFolderSet.has(folder)) continue;
          activeFolder = folder;
          activeState = await db.getLibraryScanState(folder);
          console.log(`[LibraryIndex] metadata extraction ${index + 1}/${targetFolders.length}: ${folder}`);
          if (!event.sender.isDestroyed()) {
            event.sender.send('task:progress', {
              task: 'folder:updateIndex',
              progress: Math.round((index / Math.max(targetFolders.length, 1)) * 100),
              message: i18nT('folder_optimizing', [index, targetFolders.length]),
              libraryPhase: 'metadata',
              currentFile: folder,
              currentFileName: path.basename(folder),
            });
          }
          const metadataTargets = metadataTargetsByFolder.get(folder);
          const files = await optimizeMetadataForPaths(folder, metadataTargets || [], {
            libraryDb: db,
            sevenZExe,
            shouldCancel,
            force: forceMetadata,
            skipCoverExtraction: skipMetadataCoverExtraction,
            metadataConcurrency: options.metadataConcurrency ?? options.max_threads ?? config.max_threads,
            lang,
            touchHeartbeat: () => queueLibraryScanHeartbeat(
              folder,
              safeStatMtime(folder),
              shouldOptimizeMetadata ? 'metadata' : mode,
            ),
          }, event);
          throwIfTaskCancelled(shouldCancel);
          if (shouldOptimizeMetadata) metadataTotal += files.length;
          else visualTotal += files.length;
          await flushLibraryScanHeartbeat();
          const state = scanStateByFolder.get(folder) || activeState || {};
          const readyState = {
            ...state,
            library_path: folder,
            status: 'ready',
            last_checked_at: nowIsoString(),
            last_error: '',
            scan_reason: shouldOptimizeMetadata ? 'metadata' : mode,
          };
          await db.saveLibraryScanState(readyState);
          scanStateByFolder.set(folder, readyState);
          console.log(`[LibraryIndex] metadata extraction done ${index + 1}/${targetFolders.length}: ${folder} files=${files.length}`);
        }
      }
      for (const [folder, state] of scanStateByFolder.entries()) {
        if (state.status === 'ready') continue;
        const readyState = {
          ...state,
          library_path: folder,
          status: 'ready',
          last_checked_at: nowIsoString(),
          last_error: '',
          scan_reason: shouldOptimizeMetadata ? 'metadata' : mode,
        };
        await db.saveLibraryScanState(readyState);
        scanStateByFolder.set(folder, readyState);
      }

      console.log(`[LibraryIndex] complete folders=${targetFolders.length} indexed=${total} skipped=${skippedFolders} metadata=${metadataTotal}`);
      event.sender.send('task:progress', {
        task: 'folder:updateIndex',
        progress: 100,
        phase: 'idle',
        libraryPhase: 'idle',
        message: shouldOptimizeMetadata
          ? i18nT('folder_optimizing', [metadataTotal, metadataTotal])
          : i18nT('dup_scan_complete', [total]),
      });
      return {
        success: true,
        folderCount: targetFolders.length,
        skippedFolders,
        total,
        changedTotal,
        metadataTotal,
        visualTotal,
        mode,
      };
    } catch (error) {
      await flushLibraryScanHeartbeat();
      if (error?.code === 'TASK_CANCELLED') {
        console.log(`[LibraryIndex] cancelled folders=${targetFolders.length}`);
        if (activeFolder) {
          await db.saveLibraryScanState({
            ...(activeState || {}),
            library_path: activeFolder,
            status: 'cancelled',
            last_checked_at: nowIsoString(),
            last_error: '',
            scan_reason: shouldOptimizeMetadata ? 'metadata' : mode,
          });
        }
        if (!event.sender.isDestroyed()) {
          event.sender.send('task:progress', {
            task: 'folder:updateIndex',
            progress: 0,
            message: i18nT('msg_cancelled'),
            phase: 'idle',
            libraryPhase: 'idle',
          });
        }
        return {
          success: true,
          cancelled: true,
          folderCount: targetFolders.length,
          mode,
        };
      }
      if (activeFolder) {
        await db.saveLibraryScanState({
          ...(activeState || {}),
          library_path: activeFolder,
          status: 'error',
          last_checked_at: nowIsoString(),
          last_error: error.message || String(error),
          scan_reason: shouldOptimizeMetadata ? 'metadata' : mode,
        });
      }
      throw error;
    } finally {
      await db.close();
      cancellationRegistry.finish(event.sender.id, taskId, controller);
    }
  });

  // ========== 릴리즈 노트 ==========
  ipcMain.handle('releases:list', async () => {
      try {
          const releases = await requestJson('https://api.github.com/repos/dongkkase/BookManager/releases?per_page=10');
          return releases
              .map(item => ({
                  id: item.id || item.tag_name,
                  name: item.name || item.tag_name,
                  tag: item.tag_name,
                  date: item.published_at ? item.published_at.slice(0, 10) : '',
                  publishedAt: item.published_at || '',
                  body: item.body || i18nT('release_no_body'),
                  url: item.html_url,
                  draft: Boolean(item.draft),
                  prerelease: Boolean(item.prerelease),
                  assets: Array.isArray(item.assets)
                      ? item.assets.map(asset => ({
                          name: asset.name || '',
                          downloadUrl: asset.browser_download_url || '',
                          size: asset.size || 0,
                      }))
                      : [],
              }))
              .sort((left, right) => Date.parse(right.publishedAt) - Date.parse(left.publishedAt));
      } catch (error) {
          return {
              error: error.message,
              releases: [],
          };
      }
  });

  // ========== 설정 관련 ==========
  ipcMain.handle('config:get', () => {
    return configManager.getConfig();
  });

  ipcMain.handle('config:save', (_, config) => {
    const currentConfig = configManager.getConfig() || {};
    const updates = config || {};
    const nextLang = updates.language || updates.lang || currentConfig.language || currentConfig.lang || 'ko';
    const nextConfig = {
      ...currentConfig,
      ...updates,
      lang: nextLang,
      language: nextLang,
      api_keys: {
        ...(currentConfig.api_keys || {}),
        ...(updates.api_keys || {}),
      },
    };
    configManager.saveConfig(nextConfig);
    setLanguage(nextLang);
    const savedConfig = configManager.getConfig();
    const savedApiKeys = savedConfig.api_keys || {};
    BrowserWindow.getAllWindows().forEach(window => {
      if (!window.isDestroyed()) {
        window.webContents.send('viewer:config-change', {
          lang: savedConfig.lang,
          language: savedConfig.language,
          hasTtsOpenAiKey: Boolean(String(savedApiKeys.tts_openai_key || '').trim()),
          hasTtsGoogleKey: Boolean(String(savedApiKeys.tts_google_key || '').trim()),
        });
      }
    });
    return savedConfig;
  });

  // ========== 폰트 관련 ==========
  ipcMain.handle('font:getPath', (_, fontFilename) => {
    return getFontPath(fontFilename);
  });

  ipcMain.handle('font:listBundled', () => {
    return listBundledFontFaces([
      getResourcePath('src', 'fonts'),
      path.join(getExecutableDir(), 'fonts'),
    ]);
  });

  ipcMain.handle('font:listSystem', async () => {
    return await listSystemFontFamilies(process.platform);
  });

  // ========== 바이너리 도구 관련 ==========
  ipcMain.handle('bin:getPath', async (_, toolName) => {
    return await getBinPath(toolName);
  });

  // ========== 사운드 재생 ==========
  ipcMain.handle('sound:play', async (_, soundFilename) => {
    try {
      const safeFilename = normalizeSoundFilename(soundFilename);
      if (!safeFilename) return false;
      let soundPath = getResourcePath('src', 'sounds', safeFilename);
      if (!fs.existsSync(soundPath)) {
        soundPath = path.join(getExecutableDir(), 'sounds', safeFilename);
      }
      if (fs.existsSync(soundPath)) {
        const soundCommand = createSoundCommand(process.platform, soundPath);
        const child = spawn(soundCommand.command, soundCommand.args, {
          detached: false,
          env: { ...process.env, ...soundCommand.env },
          stdio: 'ignore',
          windowsHide: true,
        });
        child.on('error', error => console.error('사운드 재생 실패:', error));
        child.unref();
        return true;
      }
      return false;
    } catch (error) {
      console.error('사운드 재생 실패:', error);
      return false;
    }
  });

  ipcMain.handle('sound:list', () => {
    const directories = [
      getResourcePath('src', 'sounds'),
      path.join(getExecutableDir(), 'sounds'),
    ];
    const files = new Set();
    for (const directory of directories) {
      if (!fs.existsSync(directory)) continue;
      for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
        if (entry.isFile() && /\.(mp3|wav)$/i.test(entry.name)) files.add(entry.name);
      }
    }
    const sorted = [...files].filter(name => name !== 'Default.wav').sort((a, b) => a.localeCompare(b));
    return ['Default.wav', ...sorted];
  });

  // ========== 파일/폴더 선택 ==========
  ipcMain.handle('dialog:selectFolder', async (event, title) => {
    const window = BrowserWindow.fromWebContents(event.sender);
    const result = await dialog.showOpenDialog(window, createFolderDialogOptions(title));
    return normalizeFolderDialogResult(result);
  });

  ipcMain.handle('dialog:selectArchives', async (event, title) => {
    const window = BrowserWindow.fromWebContents(event.sender);
    const result = await dialog.showOpenDialog(window, createArchiveDialogOptions(title));
    return normalizeArchiveDialogResult(result);
  });

  ipcMain.handle('dialog:metadataDropChoice', async (event, options = {}) => {
    const window = BrowserWindow.fromWebContents(event.sender);
    const dialogOptions = {
      type: 'question',
      title: options.title || i18nT('dialog_add_mode_title'),
      message: options.message || '',
      buttons: 'yes-no-cancel',
      defaultChoice: 'yes',
      language: options.language,
    };
    const result = await dialog.showMessageBox(window, createMessageDialogOptions(dialogOptions));
    return resolveMessageDialogResponse(dialogOptions, result.response);
  });

  ipcMain.handle('dialog:message', async (event, options = {}) => {
    const window = BrowserWindow.fromWebContents(event.sender);
    const result = await dialog.showMessageBox(window, createMessageDialogOptions(options));
    return resolveMessageDialogResponse(options, result.response);
  });

  ipcMain.handle('dialog:librarySyncChoice', async (event, options = {}) => {
    const window = BrowserWindow.fromWebContents(event.sender);
    const result = await dialog.showMessageBox(
      window,
      createLibrarySyncDialogOptions(options),
    );
    return resolveLibrarySyncChoice(result.response);
  });

  ipcMain.handle('dialog:selectFile', async (event, title, filters) => {
    const window = BrowserWindow.fromWebContents(event.sender);
    const result = await dialog.showOpenDialog(window, {
      properties: ['openFile'],
      title: title || i18nT('dialog_select_file'),
      filters: filters || [],
    });
    return normalizeFileDialogResult(result);
  });

  ipcMain.handle('dialog:selectFiles', async (event, title, filters) => {
    const window = BrowserWindow.fromWebContents(event.sender);
    const result = await dialog.showOpenDialog(window, {
      properties: ['openFile', 'multiSelections'],
      title: title || i18nT('dialog_select_file'),
      filters: filters || [],
    });
    return normalizeFilesDialogResult(result);
  });

  ipcMain.handle('dialog:saveFile', async (event, title, filters, defaultPath) => {
    const window = BrowserWindow.fromWebContents(event.sender);
    const result = await dialog.showSaveDialog(window, {
      title: title || i18nT('dialog_save_file'),
      filters: filters || [],
      defaultPath: defaultPath || undefined,
    });
    return normalizeSaveDialogResult(result);
  });

  // ========== 파일 시스템 ==========
  ipcMain.handle('fs:getRoots', async () => {
    if (process.platform === 'win32') {
      const drives = listWindowsDriveRoots();
      return drives.length > 0 ? drives : [getDefaultWindowsDriveRoot()];
    } else {
      return ['/'];
    }
  });

  ipcMain.handle('fs:getSpecialPaths', () => ({
    desktop: app.getPath('desktop'),
    documents: app.getPath('documents'),
    downloads: app.getPath('downloads'),
    home: app.getPath('home'),
  }));

  ipcMain.handle('fs:readDir', async (_, dirPath) => {
    try {
      const safeDirPath = normalizeDirectoryPathForRead(dirPath);
      const items = await fs.promises.readdir(safeDirPath, { withFileTypes: true });
      return items.map(item => ({
        name: item.name,
        isDirectory: item.isDirectory(),
        isFile: item.isFile(),
      }));
    } catch (error) {
      console.error('디렉토리 읽기 실패:', error);
      return [];
    }
  });

  ipcMain.handle('fs:stat', async (_, filePath) => {
    try {
      const stats = await fs.promises.stat(filePath);
      return {
        isFile: stats.isFile(),
        isDirectory: stats.isDirectory(),
        size: stats.size,
        mtime: stats.mtimeMs,
        birthtime: stats.birthtimeMs,
      };
    } catch (error) {
      return null;
    }
  });

  ipcMain.handle('fs:exists', async (_, filePath) => {
    try {
      await fs.promises.access(filePath);
      return true;
    } catch {
      return false;
    }
  });

  // ========== 파일/폴더 작업 확장 (FolderTab 지원) ==========
  const historyPath = renameHistoryPath();

  function loadRenameHistory() {
    try {
      if (fs.existsSync(historyPath)) {
        const history = JSON.parse(fs.readFileSync(historyPath, 'utf-8'));
        return Array.isArray(history) ? history : [];
      }
    } catch (e) {
      console.error('Failed to load rename history', e);
    }
    return [];
  }

  function saveRenameHistory(history) {
    try {
      saveRenameHistoryFile(historyPath, history);
    } catch (e) {
      console.error('Failed to save rename history', e);
      throw e;
    }
  }

  async function syncFileInfoPathChanges(completedMoves = [], fileInfoDeletes = []) {
    if (completedMoves.length === 0 && fileInfoDeletes.length === 0) return null;
    const config = configManager.getConfig() || {};
    const libraryPaths = [...new Set([
      ...(config.libraries || []),
      ...(config.dup_check_folders || []),
    ]
      .filter(Boolean)
      .map(folderPath => path.resolve(folderPath)))];
    const touchedLibraries = new Set();
    const includeContainingLibrary = filePath => {
      const libraryPath = findContainingLibraryPath(filePath, libraryPaths);
      if (libraryPath) touchedLibraries.add(libraryPath);
      return libraryPath;
    };
    for (const move of completedMoves) {
      const sourceLibrary = includeContainingLibrary(move.src);
      includeContainingLibrary(move.dest);
      if (move.recursive && sourceLibrary && path.resolve(move.src) === sourceLibrary) {
        touchedLibraries.add(path.resolve(move.dest));
      }
    }
    for (const entry of fileInfoDeletes) includeContainingLibrary(entry.path);

    const db = new LibraryDB({ dbPath: libraryDbPath() });
    try {
      return await db.applyLibraryMoveIndexChanges({
        fileInfoMoves: completedMoves,
        targetIndexMoves: completedMoves,
        fileInfoDeletes,
        sourcePaths: fileInfoDeletes.filter(entry => !entry.recursive).map(entry => entry.path),
        sourcePrefixes: fileInfoDeletes.filter(entry => entry.recursive).map(entry => entry.path),
        touchedLibraries: [...touchedLibraries],
      });
    } finally {
      await db.close();
    }
  }

  function renameRollbackRecord(completedMoves = []) {
    return {
      timestamp: Date.now(),
      mapping: Object.fromEntries(completedMoves.map(move => [move.dest, move.src])),
    };
  }

  // 1. 단일 파일/폴더 이름 변경
  ipcMain.handle('fs:rename', async (_, oldPath, newPath) => {
    try {
      if (fs.existsSync(newPath) && oldPath.toLowerCase() !== newPath.toLowerCase()) {
        return { success: false, message: i18nT('fs_path_exists') };
      }
      const recursive = fs.statSync(oldPath).isDirectory();
      const originalHistory = loadRenameHistory();
      const nextHistory = [
        ...originalHistory,
        {
          timestamp: Date.now(),
          mapping: { [newPath]: oldPath },
        },
      ];
      if (nextHistory.length > 10) nextHistory.splice(0, nextHistory.length - 10);
      const completedMoves = [{ src: oldPath, dest: newPath, recursive }];
      fs.renameSync(oldPath, newPath);
      const committed = await commitRenameOperation({
        completedMoves,
        previousHistory: originalHistory,
        nextHistory,
        saveHistory: saveRenameHistory,
        syncPathChanges: syncFileInfoPathChanges,
        rollbackPathChanges: moves => undoRename([renameRollbackRecord(moves)]),
      });
      if (!committed.success) {
        return {
          success: false,
          message: committed.error.message,
          errors: [
            committed.error.message,
            ...(committed.rollback?.errors || []),
            ...(committed.historyRestoreError ? [committed.historyRestoreError.message] : []),
          ],
        };
      }

      return { success: true };
    } catch (error) {
      return { success: false, code: error.code || '', message: error.message };
    }
  });

  ipcMain.handle('fs:openWithViewer', async (_, viewerPath, filePath) => {
    try {
      if (!viewerPath || !fs.existsSync(viewerPath)) {
        return { success: false, code: 'VIEWER_NOT_FOUND', message: i18nT('viewer_not_found') };
      }
      if (!filePath || !fs.existsSync(filePath)) {
        return { success: false, code: 'FILE_NOT_FOUND', message: i18nT('fs_file_not_found') };
      }
      const child = spawn(viewerPath, [filePath], {
        detached: true,
        stdio: 'ignore',
      });
      child.unref();
      return { success: true };
    } catch (error) {
      return { success: false, code: error.code || '', message: error.message };
    }
  });

  // 2. 다중 파일 이름 변경 (Multi-rename)
  ipcMain.handle('fs:multiRename', async (_, renameMap) => {
    const originalHistory = loadRenameHistory();
    const result = executeMultiRename(renameMap, originalHistory);
    const committed = await commitRenameOperation({
      completedMoves: result.completedMoves,
      previousHistory: originalHistory,
      nextHistory: result.history,
      saveHistory: saveRenameHistory,
      syncPathChanges: syncFileInfoPathChanges,
      rollbackPathChanges: moves => undoRename([renameRollbackRecord(moves)]),
    });
    if (!committed.success) {
      return {
        success: false,
        successCount: Math.max(0, result.completedMoves.length - committed.rollback.successCount),
        errors: [
          ...result.errors,
          committed.error.message,
          ...(committed.rollback?.errors || []),
          ...(committed.historyRestoreError ? [committed.historyRestoreError.message] : []),
        ],
      };
    }
    return {
      success: result.success,
      successCount: result.successCount,
      errors: result.errors
    };
  });

  // 3. 파일 이름 변경 Undo
  ipcMain.handle('fs:undoRename', async () => {
    const originalHistory = loadRenameHistory();
    const result = undoRename(originalHistory);
    const committed = await commitRenameOperation({
      completedMoves: result.completedMoves,
      previousHistory: originalHistory,
      nextHistory: result.history,
      saveHistory: saveRenameHistory,
      syncPathChanges: syncFileInfoPathChanges,
      rollbackPathChanges: moves => executeMultiRename(
        reverseRenameMapForCompletedMoves(moves),
      ),
    });
    if (!committed.success) {
      return {
        success: false,
        successCount: Math.max(0, result.completedMoves.length - committed.rollback.successCount),
        errors: [
          ...result.errors,
          committed.error.message,
          ...(committed.rollback?.errors || []),
          ...(committed.historyRestoreError ? [committed.historyRestoreError.message] : []),
        ],
        message: committed.error.message,
      };
    }
    return {
      success: result.success,
      successCount: result.successCount,
      errors: result.errors,
      message: result.message
    };
  });

  // 4. 휴지통으로 이동
  ipcMain.handle('fs:delete', async (_, filePaths) => {
    const deleted = [];
    const fileInfoDeletes = [];
    const errors = [];
    for (const filePath of filePaths) {
      try {
        if (fs.existsSync(filePath)) {
          const recursive = fs.statSync(filePath).isDirectory();
          await shell.trashItem(filePath);
          deleted.push(filePath);
          fileInfoDeletes.push({ path: filePath, recursive });
        }
      } catch (err) {
        errors.push(i18nT('fs_delete_failed', [path.basename(filePath), err.message]));
      }
    }
    try {
      await syncFileInfoPathChanges([], fileInfoDeletes);
    } catch (error) {
      errors.push(error.message);
    }
    return {
      success: errors.length === 0,
      deleted,
      errors
    };
  });

  // 5. 파일 탐색기에서 열기
  ipcMain.handle('fs:openInExplorer', async (_, folderPath) => {
    try {
      if (fs.existsSync(folderPath)) {
        await shell.openPath(folderPath);
        return { success: true };
      }
      return { success: false, message: i18nT('fs_path_not_found') };
    } catch (error) {
      return { success: false, message: error.message };
    }
  });

  // 6. 파일 위치 탐색기에서 열고 선택하기
  ipcMain.handle('fs:showInFolder', async (_, filePath) => {
    try {
      if (fs.existsSync(filePath)) {
        shell.showItemInFolder(filePath);
        return { success: true };
      }
      return { success: false, message: i18nT('fs_path_not_found') };
    } catch (error) {
      return { success: false, message: error.message };
    }
  });

  // 7. CSV 파일로 내보내기
  ipcMain.handle('fs:exportCsv', async (_, { filePath, headers, rows }) => {
    try {
      const targetPath = resolveCsvExportPath(filePath);
      const csvContent = buildCsvContent(headers, rows);
      fs.writeFileSync(targetPath, csvContent, 'utf8');
      return { success: true, filePath: targetPath };
    } catch (error) {
      return { success: false, message: error.message };
    }
  });

  ipcMain.handle('fs:filePreview', async (_, filePath, options = {}) => {
    try {
      if (!filePath || !fs.existsSync(filePath)) {
        return { success: false, message: 'File not found.' };
      }
      const sevenZExe = await getBinPath('7za') || await getBinPath('7z');
      return {
        success: true,
        file: await inspectFolderFile(filePath, {
          dbPath: libraryDbPath(),
          thumbnailDir: thumbnailDir(),
          sevenZExe,
          force: options?.force === true,
          thumbnailEncoder: encodeThumbnail,
        }),
      };
    } catch (error) {
      return { success: false, message: error.message };
    }
  });

  ipcMain.handle('fs:expandFolderMove', async (_, sourceRoot, destinationRoot) => {
    const plans = [];
    async function walk(currentPath) {
      const entries = await fs.promises.readdir(currentPath, { withFileTypes: true });
      for (const entry of entries) {
        const sourcePath = path.join(currentPath, entry.name);
        if (entry.isDirectory()) {
          await walk(sourcePath);
        } else if (entry.isFile()) {
          plans.push({
            src: sourcePath,
            dest: path.join(destinationRoot, path.relative(sourceRoot, sourcePath)),
            cleanupRoot: '',
          });
        }
      }
    }
    try {
      await walk(sourceRoot);
      return { success: true, plans };
    } catch (error) {
      return { success: false, message: error.message, plans: [] };
    }
  });

  ipcMain.handle('fs:removeEmptyTree', async (_, rootPath) => {
    try {
      const removed = await removeTreeIfNoFilesAsync(rootPath);
      return { success: true, removed };
    } catch (error) {
      return { success: false, message: error.message };
    }
  });

  ipcMain.handle('fs:findLibraryMoveConflicts', async (_event, movePlans) => {
    try {
      return await findLibraryMoveConflicts(movePlans);
    } catch (error) {
      return { success: false, message: error.message, conflicts: [] };
    }
  });

  // 8. 라이브러리로 파일 이동 처리 (충돌 해결 지원)
  ipcMain.handle('fs:executeLibraryMove', async (_event, movePlans) => {
    return executeLibraryMoveAsync(movePlans);
  });

  ipcMain.handle('folder:applyLibraryMoveIndex', async (_event, payload = {}) => {
    const completedMoves = Array.isArray(payload.completedMoves) ? payload.completedMoves : [];
    if (completedMoves.length === 0) {
      return { success: true, skipped: true, movedCount: 0 };
    }

    const config = configManager.getConfig() || {};
    const libraryPaths = [...new Set((payload.libraries?.length > 0
      ? payload.libraries
      : [...(config.libraries || []), ...(config.dup_check_folders || [])])
      .filter(Boolean)
      .map(folderPath => path.resolve(folderPath))
      .filter(folderPath => fs.existsSync(folderPath)))];
    if (libraryPaths.length === 0) {
      return { success: true, skipped: true, movedCount: completedMoves.length };
    }

    const sourcePaths = [];
    const sourcePrefixes = [];
    const targetEntries = [];
    const fileInfoMoves = [];
    const touchedLibraries = new Set();

    for (const move of completedMoves) {
      const sourcePath = move?.src ? path.resolve(move.src) : '';
      const destinationPath = move?.dest ? path.resolve(move.dest) : '';
      if (!sourcePath || !destinationPath) continue;

      const sourceLibrary = findContainingLibraryPath(sourcePath, libraryPaths);
      const destinationLibrary = findContainingLibraryPath(destinationPath, libraryPaths);
      let destinationStats = null;
      try {
        destinationStats = fs.statSync(destinationPath);
      } catch {
        destinationStats = null;
      }
      const recursive = destinationStats?.isDirectory?.() === true;

      if (sourceLibrary) {
        touchedLibraries.add(sourceLibrary);
        if (recursive) sourcePrefixes.push(sourcePath);
        else sourcePaths.push(sourcePath);
      }

      if (!destinationLibrary || !destinationStats) continue;
      touchedLibraries.add(destinationLibrary);
      fileInfoMoves.push({ src: sourcePath, dest: destinationPath, recursive });

      const filePaths = recursive
        ? await scanArchivePaths(destinationPath)
        : (
            destinationStats.isFile()
            && INDEX_EXTENSIONS.has(path.extname(destinationPath).toLowerCase())
              ? [destinationPath]
              : []
          );
      if (filePaths.length === 0) continue;
      targetEntries.push(...await buildArchiveIndexEntries(filePaths, destinationLibrary));
    }

    const db = new LibraryDB({ dbPath: libraryDbPath() });
    try {
      const result = await db.applyLibraryMoveIndexChanges({
        sourcePaths,
        sourcePrefixes,
        targetEntries,
        fileInfoMoves,
        touchedLibraries: [...touchedLibraries],
      });
      return {
        success: true,
        movedCount: completedMoves.length,
        indexedCount: targetEntries.length,
        ...result,
      };
    } finally {
      await db.close();
    }
  });

  // 9. 파일명에서 코어 시리즈명 추출
  ipcMain.handle('parser:extractCoreTitle', async (_, filename) => {
    try {
      const folderUtilsUrl = new URL('../src/utils/folderUtils.js', import.meta.url);
      const { extractCoreTitle } = await import(folderUtilsUrl);
      return extractCoreTitle(filename);
    } catch (err) {
      console.warn('Failed to extract core title:', err);
      return filename;
    }
  });

  // ========== 시스템 정보 ==========
  ipcMain.handle('system:info', () => {
    return {
      platform: process.platform,
      arch: process.arch,
      nodeVersion: process.version,
      electronVersion: process.versions.electron,
    };
  });

  ipcMain.handle('system:cpuCores', () => {
    return os.cpus().length;
  });

  // ========== 앱 정보 ==========
  ipcMain.handle('app:version', () => {
    return resolveAppVersion();
  });

  ipcMain.handle('app:openExternal', async (_event, url) => {
    const safeUrl = normalizeExternalUrl(url);
    if (!safeUrl) throw new Error(i18nT('external_url_blocked'));
    await shell.openExternal(safeUrl);
    return true;
  });

  ipcMain.handle('app:relaunch', () => {
    app.relaunch();
    app.quit();
    return true;
  });

  ipcMain.handle('app:installUpdate', async (_event, options = {}) => {
    return installAppUpdate(options, { app });
  });

  // ========== 윈도우 관련 ==========
  ipcMain.handle('window:isMaximized', (event) => {
    const window = BrowserWindow.fromWebContents(event.sender);
    return window?.isMaximized?.() || false;
  });

  // 로그 전송
  ipcMain.on('log', (event, data) => {
    console.log('[Renderer Log]:', data);
  });

  return {
    getRuntimeState(ownerId) {
      return runtimeStates.get(ownerId) || normalizeRuntimeState();
    },
    cancelAll(ownerId) {
      return cancellationRegistry.cancelAll(ownerId);
    },
    waitForIdle(ownerId, timeoutMs) {
      return cancellationRegistry.waitForIdle(ownerId, timeoutMs);
    },
    clear(ownerId) {
      runtimeStates.delete(ownerId);
    },
    dispose() {
      removeContentIndexProgressListener();
      return Promise.all([
        librarySearchService.close(),
        contentIndexService.close(),
      ]).then(() => undefined);
    },
  };
}
