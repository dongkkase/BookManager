import crypto from 'crypto';
import fs from 'fs';
import https from 'https';
import path from 'path';
import { execFile } from 'child_process';
import { promisify } from 'util';

import { resolveAppDataDir } from './dataPaths.js';

const execFileAsync = promisify(execFile);

export const SUPERTONIC_MODEL_VERSION = '724fb5abbf5502583fb520898d45929e62f02c0b';
export const SUPERTONIC_RELEASE_TAG = 'supertonic-3-724fb5a';
export const SUPERTONIC_ARCHIVE_NAME = 'bookmanager-supertonic-3-724fb5a.zip';
export const SUPERTONIC_ARCHIVE_SIZE = 371138757;
export const SUPERTONIC_ARCHIVE_SHA256 = '0311e67fdee659e6b2468a6d7af79dabd9d853b2748d1a539f11d394b8c40fd9';
export const SUPERTONIC_DOWNLOAD_URL = `https://github.com/dongkkase/BookManager-Models/releases/download/${SUPERTONIC_RELEASE_TAG}/${SUPERTONIC_ARCHIVE_NAME}`;

export const SUPERTONIC_MODEL_FILES = Object.freeze([
    { path: 'LICENSE.supertonic-openrail.txt', size: 15007, sha256: '0d944a9110fed9a9602d60e0423a272903e7bd21ab060490774efc77c2275e9f' },
    { path: 'onnx/duration_predictor.onnx', size: 3700147, sha256: 'c3eb91414d5ff8a7a239b7fe9e34e7e2bf8a8140d8375ffb14718b1c639325db' },
    { path: 'onnx/text_encoder.onnx', size: 36416150, sha256: 'c7befd5ea8c3119769e8a6c1486c4edc6a3bc8365c67621c881bbb774b9902ff' },
    { path: 'onnx/tts.json', size: 8253, sha256: '42078d3aef1cd43ab43021f3c54f47d2d75ceb4e75f627f118890128b06a0d09' },
    { path: 'onnx/unicode_indexer.json', size: 277676, sha256: '9bf7346e43883a81f8645c81224f786d43c5b57f3641f6e7671a7d6c493cb24f' },
    { path: 'onnx/vector_estimator.onnx', size: 256534781, sha256: '883ac868ea0275ef0e991524dc64f16b3c0376efd7c320af6b53f5b780d7c61c' },
    { path: 'onnx/vocoder.onnx', size: 101424195, sha256: '085de76dd8e8d5836d6ca66826601f615939218f90e519f70ee8a36ed2a4c4ba' },
    { path: 'voice_styles/F1.json', size: 292046, sha256: 'bbdec6ee00231c2c742ad05483df5334cab3b52fda3ba38e6a07059c4563dbc2' },
    { path: 'voice_styles/F2.json', size: 292423, sha256: '7c722c6a72707b1a77f035d67f0d1351ba187738e06f7683e8c72b1df3477fc6' },
    { path: 'voice_styles/F3.json', size: 290794, sha256: '12f6ef2573baa2defa1128069cb59f203e3ab67c92af77b42df8a0e3a2f7c6ab' },
    { path: 'voice_styles/F4.json', size: 291808, sha256: 'c2fa764c1225a76dfc3e2c73e8aa4f70d9ee48793860eb34c295fff01c2e032b' },
    { path: 'voice_styles/F5.json', size: 291479, sha256: '45966e73316415626cf41a7d1c6f3b4c70dbc1ba2bee5c1978ef0ce33244fc8d' },
    { path: 'voice_styles/M1.json', size: 291748, sha256: 'e35604687f5d23694b8e91593a93eec0e4eca6c0b02bb8ed69139ab2ea6b0a5b' },
    { path: 'voice_styles/M2.json', size: 292055, sha256: 'b76cbf62bac707c710cf0ae5aba5e31eea1a6339a9734bfae33ab98499534a50' },
    { path: 'voice_styles/M3.json', size: 290198, sha256: 'ea1ac35ccb91b0d7ecad533a2fbd0eec10c91513d8951e3b25fbba99954e159b' },
    { path: 'voice_styles/M4.json', size: 291522, sha256: 'ca8eefad4fcd989c9379032ff3e50738adc547eeb5e221b82593a6d7b3bac303' },
    { path: 'voice_styles/M5.json', size: 291469, sha256: 'dd22b92740314321f8ae11c5e87f8dd60d060f15dd3a632b5adf77f471f77af2' },
]);

const DOWNLOAD_REDIRECT_HOSTS = new Set([
    'github.com',
    'objects.githubusercontent.com',
    'release-assets.githubusercontent.com',
]);

function supertonicError(code, message) {
    return Object.assign(new Error(message), { code });
}

export function resolveSupertonicModelDir(executableDir = process.cwd(), platform = process.platform, env = process.env) {
    return path.join(resolveAppDataDir(executableDir, platform, env), 'models', 'supertonic-3');
}

export function isAllowedSupertonicDownloadUrl(value, redirect = false) {
    try {
        const url = new URL(value);
        if (url.protocol !== 'https:') return false;
        if (redirect) return DOWNLOAD_REDIRECT_HOSTS.has(url.hostname);
        return url.hostname === 'github.com'
            && decodeURIComponent(url.pathname) === `/dongkkase/BookManager-Models/releases/download/${SUPERTONIC_RELEASE_TAG}/${SUPERTONIC_ARCHIVE_NAME}`;
    } catch {
        return false;
    }
}

export function getSupertonicModelStatus(modelDir) {
    const installed = SUPERTONIC_MODEL_FILES.every(file => {
        try {
            return fs.statSync(path.join(modelDir, file.path)).size === file.size;
        } catch {
            return false;
        }
    });
    return {
        installed,
        modelDir,
        version: SUPERTONIC_MODEL_VERSION,
        archiveSize: SUPERTONIC_ARCHIVE_SIZE,
        downloadUrl: SUPERTONIC_DOWNLOAD_URL,
    };
}

export async function sha256File(filePath) {
    const hash = crypto.createHash('sha256');
    const stream = fs.createReadStream(filePath);
    for await (const chunk of stream) hash.update(chunk);
    return hash.digest('hex');
}

export async function verifySupertonicModelFiles(modelDir, onProgress = () => {}) {
    for (let index = 0; index < SUPERTONIC_MODEL_FILES.length; index += 1) {
        const expected = SUPERTONIC_MODEL_FILES[index];
        const filePath = path.join(modelDir, expected.path);
        let stat;
        try {
            stat = fs.statSync(filePath);
        } catch {
            throw supertonicError('SUPERTONIC_MODEL_INVALID', `Missing model file: ${expected.path}`);
        }
        if (!stat.isFile() || stat.size !== expected.size) {
            throw supertonicError('SUPERTONIC_MODEL_INVALID', `Invalid model file size: ${expected.path}`);
        }
        const actualSha256 = await sha256File(filePath);
        if (actualSha256 !== expected.sha256) {
            throw supertonicError('SUPERTONIC_MODEL_INVALID', `Invalid model file hash: ${expected.path}`);
        }
        onProgress({
            phase: 'verify-files',
            current: index + 1,
            total: SUPERTONIC_MODEL_FILES.length,
            file: expected.path,
            percent: Math.round(((index + 1) / SUPERTONIC_MODEL_FILES.length) * 100),
        });
    }
    return true;
}

export function downloadSupertonicArchive(url, destinationPath, onProgress = () => {}, redirectCount = 0) {
    return new Promise((resolve, reject) => {
        if (redirectCount > 5) {
            reject(supertonicError('SUPERTONIC_DOWNLOAD_FAILED', 'Too many download redirects.'));
            return;
        }
        if (!isAllowedSupertonicDownloadUrl(url, redirectCount > 0)) {
            reject(supertonicError('SUPERTONIC_DOWNLOAD_BLOCKED', 'The model download URL was blocked.'));
            return;
        }

        const request = https.get(url, {
            headers: {
                'User-Agent': 'BookManager',
                Accept: 'application/octet-stream',
            },
        }, response => {
            const statusCode = response.statusCode || 0;
            if ([301, 302, 303, 307, 308].includes(statusCode) && response.headers.location) {
                response.resume();
                const redirectedUrl = new URL(response.headers.location, url).toString();
                downloadSupertonicArchive(redirectedUrl, destinationPath, onProgress, redirectCount + 1).then(resolve, reject);
                return;
            }
            if (statusCode < 200 || statusCode >= 300) {
                response.resume();
                reject(supertonicError('SUPERTONIC_DOWNLOAD_FAILED', `Model download failed with HTTP ${statusCode}.`));
                return;
            }

            const totalBytes = Number(response.headers['content-length']) || SUPERTONIC_ARCHIVE_SIZE;
            let receivedBytes = 0;
            const file = fs.createWriteStream(destinationPath);
            response.on('data', chunk => {
                receivedBytes += chunk.length;
                onProgress({
                    phase: 'download',
                    receivedBytes,
                    totalBytes,
                    percent: totalBytes > 0 ? Math.min(100, Math.round((receivedBytes / totalBytes) * 100)) : 0,
                });
            });
            response.on('error', error => file.destroy(error));
            file.on('error', error => {
                fs.rmSync(destinationPath, { force: true });
                reject(error);
            });
            file.on('finish', () => file.close(() => resolve(destinationPath)));
            response.pipe(file);
        });
        request.setTimeout(60000, () => request.destroy(supertonicError('SUPERTONIC_DOWNLOAD_FAILED', 'Model download timed out.')));
        request.on('error', error => {
            fs.rmSync(destinationPath, { force: true });
            reject(error);
        });
    });
}

export async function extractSupertonicArchive(zipPath, extractDir, sevenZipPath) {
    if (!sevenZipPath) {
        throw supertonicError('SUPERTONIC_EXTRACTOR_MISSING', '7-Zip is required to install the Supertonic model.');
    }
    fs.mkdirSync(extractDir, { recursive: true });
    await execFileAsync(sevenZipPath, ['x', zipPath, `-o${extractDir}`, '-y'], {
        windowsHide: true,
        maxBuffer: 8 * 1024 * 1024,
    });
}

function installVerifiedModel(sourceDir, modelDir) {
    const parentDir = path.dirname(modelDir);
    const backupDir = path.join(parentDir, `.supertonic-3-backup-${Date.now()}`);
    let movedPrevious = false;
    if (fs.existsSync(modelDir)) {
        fs.renameSync(modelDir, backupDir);
        movedPrevious = true;
    }
    try {
        fs.renameSync(sourceDir, modelDir);
        if (movedPrevious) fs.rmSync(backupDir, { recursive: true, force: true });
    } catch (error) {
        if (!fs.existsSync(modelDir) && movedPrevious && fs.existsSync(backupDir)) {
            fs.renameSync(backupDir, modelDir);
        }
        throw error;
    }
}

export function createSupertonicModelManager(options = {}) {
    const getModelDir = options.getModelDir || (() => resolveSupertonicModelDir(options.executableDir));
    const getSevenZipPath = options.getSevenZipPath || (async () => '');
    const downloadArchive = options.downloadArchive || downloadSupertonicArchive;
    const extractArchive = options.extractArchive || extractSupertonicArchive;
    let installPromise = null;

    const status = () => getSupertonicModelStatus(getModelDir());
    const install = async (onProgress = () => {}) => {
        if (status().installed) return status();
        if (installPromise) return installPromise;

        installPromise = (async () => {
            const modelDir = getModelDir();
            const parentDir = path.dirname(modelDir);
            fs.mkdirSync(parentDir, { recursive: true });
            const workDir = fs.mkdtempSync(path.join(parentDir, '.supertonic-install-'));
            const zipPath = path.join(workDir, SUPERTONIC_ARCHIVE_NAME);
            const extractDir = path.join(workDir, 'extracted');
            try {
                onProgress({ phase: 'download', receivedBytes: 0, totalBytes: SUPERTONIC_ARCHIVE_SIZE, percent: 0 });
                await downloadArchive(SUPERTONIC_DOWNLOAD_URL, zipPath, onProgress);
                onProgress({ phase: 'verify-archive', percent: 0 });
                const archiveSha256 = await sha256File(zipPath);
                if (archiveSha256 !== SUPERTONIC_ARCHIVE_SHA256) {
                    throw supertonicError('SUPERTONIC_ARCHIVE_INVALID', 'The downloaded model archive checksum does not match.');
                }
                onProgress({ phase: 'extract', percent: 0 });
                const sevenZipPath = await getSevenZipPath();
                await extractArchive(zipPath, extractDir, sevenZipPath);
                const extractedModelDir = path.join(extractDir, 'supertonic-3');
                await verifySupertonicModelFiles(extractedModelDir, onProgress);
                fs.writeFileSync(path.join(extractedModelDir, '.bookmanager-model.json'), `${JSON.stringify({
                    model: 'Supertonic 3',
                    sourceRevision: SUPERTONIC_MODEL_VERSION,
                    archiveSha256: SUPERTONIC_ARCHIVE_SHA256,
                    installedAt: new Date().toISOString(),
                }, null, 4)}\n`, 'utf8');
                installVerifiedModel(extractedModelDir, modelDir);
                onProgress({ phase: 'complete', percent: 100 });
                return status();
            } finally {
                fs.rmSync(workDir, { recursive: true, force: true });
            }
        })();

        try {
            return await installPromise;
        } finally {
            installPromise = null;
        }
    };

    return { status, install };
}
