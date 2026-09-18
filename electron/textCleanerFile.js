import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { Worker } from 'node:worker_threads';

export const TEXT_CLEANER_MAX_SOURCE_BYTES = 128 * 1024 * 1024;
export const TEXT_CLEANER_MAX_OUTPUT_BYTES = 256 * 1024 * 1024;

const UTF8_BOM = Buffer.from([0xef, 0xbb, 0xbf]);
const AUTO_ENCODING_SAMPLE_BYTES = 512 * 1024;
const WORKER_LOAD_THRESHOLD_BYTES = 8 * 1024 * 1024;

function textCleanerError(code, message) {
    const error = new Error(message);
    error.code = code;
    return error;
}

function assertTextFilePath(filePath) {
    if (typeof filePath !== 'string' || !filePath.trim()) {
        throw textCleanerError('INVALID_PATH', 'TXT 파일 경로가 필요합니다.');
    }
    if (path.extname(filePath).toLowerCase() !== '.txt') {
        throw textCleanerError('UNSUPPORTED_FILE', 'TXT 파일만 정리할 수 있습니다.');
    }
}

function hashBuffer(buffer) {
    return crypto.createHash('sha256').update(buffer).digest('hex');
}

function scoreDecodedText(text = '') {
    let replacementCount = 0;
    let controlCount = 0;
    let hangulCount = 0;
    let visibleCount = 0;

    for (let index = 0; index < text.length; index += 1) {
        const code = text.charCodeAt(index);
        if (code === 0xfffd) replacementCount += 1;
        if (code <= 0x08 || code === 0x0b || code === 0x0c || (code >= 0x0e && code <= 0x1f)) {
            controlCount += 1;
        }
        if (code >= 0xac00 && code <= 0xd7a3) hangulCount += 1;
        if (!(code === 0x20 || (code >= 0x09 && code <= 0x0d) || code === 0x00a0 || code === 0xfeff)) {
            visibleCount += 1;
        }
    }

    return (replacementCount * 120)
        + (controlCount * 80)
        - ((hangulCount / Math.max(1, visibleCount)) * 30);
}

function decodeCandidate(buffer, encoding, fatal = false) {
    return new TextDecoder(encoding, { fatal }).decode(buffer);
}

export function decodeTextCleanerBuffer(buffer) {
    if (!Buffer.isBuffer(buffer)) buffer = Buffer.from(buffer || []);
    if (buffer.length >= 3 && buffer.subarray(0, 3).equals(UTF8_BOM)) {
        return { text: buffer.subarray(3).toString('utf8'), encoding: 'utf-8-bom' };
    }
    if (buffer.length >= 2 && buffer[0] === 0xff && buffer[1] === 0xfe) {
        return { text: buffer.subarray(2).toString('utf16le'), encoding: 'utf-16le' };
    }
    if (buffer.length >= 2 && buffer[0] === 0xfe && buffer[1] === 0xff) {
        return { text: decodeCandidate(buffer.subarray(2), 'utf-16be'), encoding: 'utf-16be' };
    }

    try {
        return {
            text: decodeCandidate(buffer, 'utf-8', true),
            encoding: 'utf-8',
        };
    } catch {
        // 유효한 UTF-8이 아닐 때만 레거시 인코딩 후보를 비교합니다.
    }

    const sample = buffer.length > AUTO_ENCODING_SAMPLE_BYTES
        ? buffer.subarray(0, AUTO_ENCODING_SAMPLE_BYTES)
        : buffer;
    const candidates = [
        { encoding: 'euc-kr', fatal: false },
        { encoding: 'shift_jis', fatal: false },
    ];
    const scoredCandidates = [];

    for (const candidate of candidates) {
        try {
            const decoded = decodeCandidate(sample, candidate.encoding, candidate.fatal);
            const score = scoreDecodedText(decoded);
            scoredCandidates.push({ ...candidate, score });
        } catch {
            // 현재 런타임에서 해석할 수 없는 후보는 제외합니다.
        }
    }

    scoredCandidates.sort((left, right) => left.score - right.score);
    for (const candidate of scoredCandidates) {
        try {
            return {
                text: decodeCandidate(buffer, candidate.encoding, candidate.fatal),
                encoding: candidate.encoding,
            };
        } catch {
            // 표본 이후에 잘못된 바이트가 있으면 다음 후보로 전체 파일을 다시 해석합니다.
        }
    }
    throw textCleanerError('ENCODING_UNDETECTED', '파일의 문자 인코딩을 판별하지 못했습니다.');
}

function createSnapshot(stat, buffer) {
    return {
        size: stat.size,
        mtimeMs: stat.mtimeMs,
        sha256: hashBuffer(buffer),
    };
}

async function readVerifiedTextFile(filePath) {
    assertTextFilePath(filePath);
    const stat = await fs.promises.lstat(filePath);
    if (stat.isSymbolicLink()) throw textCleanerError('SYMLINK_UNSUPPORTED', '심볼릭 링크 파일은 정리할 수 없습니다.');
    if (!stat.isFile()) throw textCleanerError('NOT_A_FILE', '일반 파일만 정리할 수 있습니다.');
    if (stat.size > TEXT_CLEANER_MAX_SOURCE_BYTES) {
        throw textCleanerError('FILE_TOO_LARGE', '128MB 이하의 TXT 파일만 열 수 있습니다.');
    }
    const buffer = await fs.promises.readFile(filePath);
    return { stat, buffer };
}

export async function loadTextCleanerFileDirect(filePath) {
    const { stat, buffer } = await readVerifiedTextFile(filePath);
    const decoded = decodeTextCleanerBuffer(buffer);
    return {
        filePath,
        fileName: path.basename(filePath),
        text: decoded.text.replace(/\r\n?/g, '\n'),
        encoding: decoded.encoding,
        byteLength: buffer.length,
        snapshot: createSnapshot(stat, buffer),
    };
}

function loadTextCleanerFileInWorker(filePath) {
    return new Promise((resolve, reject) => {
        const worker = new Worker(new URL('./textCleanerLoadWorker.js', import.meta.url), {
            workerData: { filePath },
        });
        let settled = false;
        worker.once('message', message => {
            settled = true;
            if (message?.ok) {
                resolve(message.result);
                return;
            }
            const error = new Error(message?.error?.message || '텍본 파일을 불러오지 못했습니다.');
            error.code = message?.error?.code || 'LOAD_FAILED';
            reject(error);
        });
        worker.once('error', error => {
            settled = true;
            reject(error);
        });
        worker.once('exit', code => {
            if (!settled) {
                const error = new Error(`텍본 파일 로드 워커가 결과를 반환하기 전에 종료되었습니다. (${code})`);
                error.code = 'LOAD_WORKER_EXIT';
                reject(error);
            }
        });
    });
}

export async function loadTextCleanerFile(filePath, options = {}) {
    assertTextFilePath(filePath);
    const stat = await fs.promises.lstat(filePath);
    if (stat.isSymbolicLink()) throw textCleanerError('SYMLINK_UNSUPPORTED', '심볼릭 링크 파일은 정리할 수 없습니다.');
    if (!stat.isFile()) throw textCleanerError('NOT_A_FILE', '일반 파일만 정리할 수 있습니다.');
    if (stat.size > TEXT_CLEANER_MAX_SOURCE_BYTES) {
        throw textCleanerError('FILE_TOO_LARGE', '128MB 이하의 TXT 파일만 열 수 있습니다.');
    }
    const threshold = Number.isFinite(options.workerThresholdBytes)
        ? Math.max(0, options.workerThresholdBytes)
        : WORKER_LOAD_THRESHOLD_BYTES;
    return stat.size >= threshold
        ? loadTextCleanerFileInWorker(filePath)
        : loadTextCleanerFileDirect(filePath);
}

export function textCleanerBackupPath(filePath) {
    const extension = path.extname(filePath);
    return path.join(path.dirname(filePath), `${path.basename(filePath, extension)}.bak.txt`);
}

function timestampForPath(now = new Date()) {
    const value = number => String(number).padStart(2, '0');
    return `${now.getFullYear()}${value(now.getMonth() + 1)}${value(now.getDate())}-${value(now.getHours())}${value(now.getMinutes())}${value(now.getSeconds())}`;
}

async function availableRotatedBackupPath(backupPath, now) {
    const extension = path.extname(backupPath);
    const base = backupPath.slice(0, -extension.length);
    const timestamp = timestampForPath(now);

    for (let index = 0; index < 1000; index += 1) {
        const suffix = index === 0 ? '' : `-${index}`;
        const candidate = `${base}.${timestamp}${suffix}${extension}`;
        try {
            await fs.promises.access(candidate);
        } catch {
            return candidate;
        }
    }
    throw textCleanerError('BACKUP_ROTATION_FAILED', '기존 백업 파일의 보관 이름을 만들지 못했습니다.');
}

async function pathExists(filePath) {
    try {
        await fs.promises.access(filePath);
        return true;
    } catch {
        return false;
    }
}

function snapshotMatches(expected, actual) {
    return expected
        && expected.size === actual.size
        && expected.sha256 === actual.sha256;
}

export async function saveTextCleanerFile(request = {}, options = {}) {
    const filePath = request.filePath;
    const outputText = typeof request.text === 'string' ? request.text : null;
    assertTextFilePath(filePath);
    if (outputText === null) throw textCleanerError('INVALID_CONTENT', '저장할 텍스트가 필요합니다.');

    const outputBuffer = Buffer.concat([UTF8_BOM, Buffer.from(outputText, 'utf8')]);
    if (outputBuffer.length > TEXT_CLEANER_MAX_OUTPUT_BYTES) {
        throw textCleanerError('OUTPUT_TOO_LARGE', '저장 결과가 256MB를 초과합니다.');
    }

    const { stat, buffer } = await readVerifiedTextFile(filePath);
    const currentSnapshot = createSnapshot(stat, buffer);
    if (!snapshotMatches(request.snapshot, currentSnapshot)) {
        throw textCleanerError('SOURCE_CHANGED', '파일을 연 뒤 원본이 변경되었습니다. 다시 열어 확인해 주세요.');
    }

    const backupPath = textCleanerBackupPath(filePath);
    const tempPath = path.join(
        path.dirname(filePath),
        `.${path.basename(filePath)}.bookmanager-${process.pid}-${crypto.randomBytes(6).toString('hex')}.tmp`,
    );
    let rotatedBackupPath = null;
    let sourceMoved = false;
    let tempExists = false;

    try {
        const handle = await fs.promises.open(tempPath, 'wx', stat.mode);
        tempExists = true;
        try {
            await handle.writeFile(outputBuffer);
            await handle.sync();
        } finally {
            await handle.close();
        }

        if (await pathExists(backupPath)) {
            rotatedBackupPath = await availableRotatedBackupPath(backupPath, options.now || new Date());
            await fs.promises.rename(backupPath, rotatedBackupPath);
        }
        await fs.promises.rename(filePath, backupPath);
        sourceMoved = true;
        await fs.promises.rename(tempPath, filePath);
        tempExists = false;

        const savedStat = await fs.promises.stat(filePath);
        return {
            filePath,
            backupPath,
            rotatedBackupPath,
            encoding: 'utf-8-bom',
            byteLength: outputBuffer.length,
            snapshot: createSnapshot(savedStat, outputBuffer),
        };
    } catch (error) {
        if (sourceMoved && !(await pathExists(filePath)) && await pathExists(backupPath)) {
            await fs.promises.rename(backupPath, filePath).catch(() => {});
            sourceMoved = false;
        }
        if (rotatedBackupPath && !(await pathExists(backupPath)) && await pathExists(rotatedBackupPath)) {
            await fs.promises.rename(rotatedBackupPath, backupPath).catch(() => {});
        }
        if (error?.code && String(error.code).startsWith('TEXT_CLEANER_')) throw error;
        throw error;
    } finally {
        if (tempExists) await fs.promises.unlink(tempPath).catch(() => {});
    }
}
