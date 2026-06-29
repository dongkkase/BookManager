import assert from 'node:assert/strict';
import fs from 'fs';
import os from 'os';
import path from 'path';
import test from 'node:test';
import { binaryCandidates, findBinaryPath, missingBinaryMessage } from './binaryPolicy.js';

test('Windows 패키지의 bundled 7za.exe를 우선 탐색한다', () => {
    const candidates = binaryCandidates('7za', {
        platform: 'win32',
        resourcesPath: 'C:\\BookManager\\resources',
        executableDir: 'C:\\BookManager',
        pathValue: '',
    });
    assert.match(candidates[0], /resources[\\/]bin[\\/]win[\\/]7za\.exe$/i);
});

test('macOS는 bundled 경로와 시스템 PATH fallback을 모두 탐색한다', () => {
    const candidates = binaryCandidates('7za', {
        platform: 'darwin',
        arch: 'arm64',
        resourcesPath: '/Applications/BookManager.app/Contents/Resources',
        projectRoot: '/Users/me/BookManager',
        pathValue: '/custom/bin',
    });
    const normalizedCandidates = candidates.map(candidate => candidate.replace(/\\/g, '/'));
    assert.equal(normalizedCandidates.includes('/Applications/BookManager.app/Contents/Resources/bin/mac/arm64/7za'), true);
    assert.equal(normalizedCandidates.includes('/Applications/BookManager.app/Contents/Resources/bin/mac/7za'), true);
    assert.equal(normalizedCandidates.includes('/Users/me/BookManager/node_modules/7zip-bin/mac/arm64/7za'), true);
    assert.equal(normalizedCandidates.includes('/custom/bin/7z'), true);
    assert.equal(normalizedCandidates.includes('/opt/homebrew/bin/7z'), true);
});

test('공백과 한글이 포함된 실행 경로를 그대로 반환한다', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), '북 매니저 binary-'));
    try {
        const binary = path.join(root, 'bin', 'mac', '7z');
        fs.mkdirSync(path.dirname(binary), { recursive: true });
        fs.writeFileSync(binary, '#!/bin/sh\nexit 0\n');
        fs.chmodSync(binary, 0o755);
        assert.equal(findBinaryPath('7z', {
            platform: 'darwin',
            projectRoot: root,
            pathValue: '',
        }), binary);
    } finally {
        fs.rmSync(root, { recursive: true, force: true });
    }
});

test('macOS 아키텍처별 bundled 7za를 우선 반환한다', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), '북 매니저 arch-'));
    try {
        const binary = path.join(root, 'bin', 'mac', 'arm64', '7za');
        fs.mkdirSync(path.dirname(binary), { recursive: true });
        fs.writeFileSync(binary, '#!/bin/sh\nexit 0\n');
        fs.chmodSync(binary, 0o755);
        assert.equal(findBinaryPath('7za', {
            platform: 'darwin',
            arch: 'arm64',
            resourcesPath: root,
            pathValue: '',
        }), binary);
    } finally {
        fs.rmSync(root, { recursive: true, force: true });
    }
});

test('JPEG 품질 재인코딩 도구도 bundled 경로에서 탐색한다', () => {
    const cjpegCandidates = binaryCandidates('cjpeg', {
        platform: 'win32',
        projectRoot: 'C:\\BookManager',
        pathValue: '',
    });
    const djpegCandidates = binaryCandidates('djpeg', {
        platform: 'win32',
        projectRoot: 'C:\\BookManager',
        pathValue: '',
    });
    assert.match(cjpegCandidates[0], /bin[\\/]win[\\/]cjpeg\.exe$/i);
    assert.match(djpegCandidates[0], /bin[\\/]win[\\/]djpeg\.exe$/i);
});

test('Windows ffmpeg는 PATH 이후 기본 설치 경로도 탐색한다', () => {
    const candidates = binaryCandidates('ffmpeg', {
        platform: 'win32',
        projectRoot: 'C:\\BookManager',
        pathValue: 'C:\\Tools',
    });
    assert.equal(candidates.includes('C:\\Tools\\ffmpeg.exe'), true);
    assert.equal(candidates.includes('C:\\ffmpeg\\bin\\ffmpeg.exe'), true);
});

test('도구 누락 안내는 플랫폼별 설치 조치를 포함한다', () => {
    assert.match(missingBinaryMessage('7z', 'win32'), /bin\/win\/7za\.exe|7-Zip/);
    assert.match(missingBinaryMessage('7z', 'darwin'), /Homebrew|7-Zip/);
});
