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

test('Windows는 PATH의 구분자와 따옴표 및 환경 변수 이름의 대소문자를 처리한다', () => {
    const candidates = binaryCandidates('7za', {
        platform: 'win32',
        env: {
            Path: '"D:\\Custom Tools";E:\\Tools;',
            programw6432: 'D:\\Program Files',
            ProgramFiles: 'E:\\Programs',
            'ProgramFiles(x86)': 'F:\\Programs (x86)',
        },
    });
    assert.deepEqual(candidates, [
        'D:\\Custom Tools\\7za.exe', 'D:\\Custom Tools\\7z.exe',
        'E:\\Tools\\7za.exe', 'E:\\Tools\\7z.exe',
        'D:\\Program Files\\7-Zip\\7za.exe', 'D:\\Program Files\\7-Zip\\7z.exe',
        'E:\\Programs\\7-Zip\\7za.exe', 'E:\\Programs\\7-Zip\\7z.exe',
        'F:\\Programs (x86)\\7-Zip\\7za.exe', 'F:\\Programs (x86)\\7-Zip\\7z.exe',
    ]);
});

test('Windows 설치 경로 환경 변수가 없으면 시스템 드라이브의 기본 7-Zip 경로를 확인한다', () => {
    for (const [env, drive] of [[{ SystemDrive: 'D:' }, 'D:'], [{}, 'C:']]) {
        assert.deepEqual(binaryCandidates('7z', { platform: 'win32', pathValue: '', env }), [
            `${drive}\\Program Files\\7-Zip\\7z.exe`, `${drive}\\Program Files\\7-Zip\\7za.exe`,
            `${drive}\\Program Files (x86)\\7-Zip\\7z.exe`, `${drive}\\Program Files (x86)\\7-Zip\\7za.exe`,
        ]);
    }
});

test('bundled 도구와 PATH가 없어도 설치된 Windows 7-Zip을 찾는다', t => {
    const installed = 'C:\\Program Files\\7-Zip\\7z.exe';
    t.mock.method(fs, 'accessSync', candidate => {
        if (candidate !== installed) throw new Error('ENOENT');
    });
    for (const tool of ['7za', '7z']) {
        assert.equal(findBinaryPath(tool, {
            platform: 'win32', resourcesPath: 'C:\\BookManager\\resources', pathValue: '', env: {},
        }), installed);
    }
});

test('Windows 7-Zip은 bundled, PATH, 설치 경로 순서로 찾고 모두 없으면 null을 반환한다', t => {
    const bundled = 'C:\\BookManager\\resources\\bin\\win\\7za.exe';
    const onPath = 'D:\\Tools\\7za.exe';
    const installed = 'C:\\Program Files\\7-Zip\\7z.exe';
    const available = new Set([bundled, onPath, installed]);
    t.mock.method(fs, 'accessSync', candidate => {
        if (!available.has(candidate)) throw new Error('ENOENT');
    });
    const options = {
        platform: 'win32', resourcesPath: 'C:\\BookManager\\resources', pathValue: 'D:\\Tools', env: {},
    };
    for (const expected of [bundled, onPath, installed]) {
        assert.equal(findBinaryPath('7za', options), expected);
        available.delete(expected);
    }
    assert.equal(findBinaryPath('7za', options), null);
});

test('7-Zip 기본 설치 경로는 Windows의 7z와 7za에만 적용한다', () => {
    const env = { ProgramFiles: 'D:\\Programs', 'ProgramFiles(x86)': 'E:\\Programs' };
    for (const platform of ['darwin', 'linux']) {
        const candidates = binaryCandidates('7z', { platform, pathValue: '', env });
        assert.equal(candidates.some(candidate => candidate.includes('7-Zip')), false);
    }
    for (const tool of ['ffmpeg', 'cjpeg']) {
        const candidates = binaryCandidates(tool, { platform: 'win32', pathValue: '', env });
        assert.equal(candidates.some(candidate => candidate.includes('7-Zip')), false);
    }
});

test('도구 누락 안내는 플랫폼별 설치 조치를 포함한다', () => {
    assert.match(missingBinaryMessage('7z', 'win32'), /bin\/win\/7za\.exe|7-Zip/);
    assert.match(missingBinaryMessage('7z', 'darwin'), /Homebrew|7-Zip/);
});
