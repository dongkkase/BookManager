import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {
    bundledFontFaceFromFile,
    decodeCommandOutput,
    listBundledFontFaces,
    normalizeFontFamilyName,
    parseFontconfigOutput,
    parseMacSystemProfilerOutput,
    parseWindowsFontRegistryOutput,
    uniqueFontFamilies,
} from './fontDiscovery.js';

test('Windows font registry output is normalized to font families', () => {
    const output = [
        'HKEY_LOCAL_MACHINE\\SOFTWARE\\Microsoft\\Windows NT\\CurrentVersion\\Fonts',
        '    Arial (TrueType)    REG_SZ    arial.ttf',
        '    Arial Bold (TrueType)    REG_SZ    arialbd.ttf',
        '    Malgun Gothic & Malgun Gothic Semilight (TrueType)    REG_SZ    malgun.ttf',
    ].join('\n');

    assert.deepEqual(parseWindowsFontRegistryOutput(output), [
        'Arial',
        'Malgun Gothic',
        'Malgun Gothic Semilight',
    ]);
});

test('fontconfig family output handles comma separated families', () => {
    assert.deepEqual(parseFontconfigOutput('Noto Sans,Noto Sans Regular\nDejaVu Sans'), [
        'DejaVu Sans',
        'Noto Sans',
    ]);
});

test('macOS system profiler JSON contributes font names', () => {
    const output = JSON.stringify({
        SPFontsDataType: [
            { _name: 'Apple SD Gothic Neo', family: 'Apple SD Gothic Neo' },
            { _name: 'Helvetica Neue Bold' },
        ],
    });

    assert.deepEqual(parseMacSystemProfilerOutput(output), [
        'Apple SD Gothic Neo',
        'Helvetica Neue',
    ]);
});

test('font family normalization drops paths, extensions, and duplicate styles', () => {
    assert.equal(normalizeFontFamilyName('Arial Bold (TrueType)'), 'Arial');
    assert.equal(normalizeFontFamilyName('C:\\Windows\\Fonts\\arial.ttf'), '');
    assert.equal(normalizeFontFamilyName('HY�׷���M'), '');
    assert.deepEqual(uniqueFontFamilies(['Arial', 'arial regular', 'Noto Sans KR']), [
        'Arial',
        'Noto Sans KR',
    ]);
});

test('command output decoding handles Korean Windows registry text', () => {
    const cp949Text = Buffer.from([72, 89, 177, 215, 183, 161, 199, 200, 77]);
    assert.equal(decodeCommandOutput(cp949Text, ['utf-8', 'euc-kr']), 'HY그래픽M');
});

test('bundled font files are converted to font face descriptors', () => {
    assert.deepEqual(bundledFontFaceFromFile('C:\\Fonts\\NanumGothic-Bold.ttf'), {
        family: 'Nanum Gothic',
        filename: 'NanumGothic-Bold.ttf',
        path: 'C:\\Fonts\\NanumGothic-Bold.ttf',
        weight: 700,
        style: 'normal',
        format: 'truetype',
    });
    assert.equal(
        bundledFontFaceFromFile('/fonts/NotoSansKR-VariableFont_wght.ttf').family,
        'Noto Sans KR',
    );
    assert.equal(bundledFontFaceFromFile('/fonts/readme.txt'), null);
});

test('bundled font directories are scanned and deduplicated', () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'bookmanager-fonts-'));
    try {
        fs.writeFileSync(path.join(tempDir, 'Jua-Regular.ttf'), '');
        fs.writeFileSync(path.join(tempDir, 'Jua-Bold.ttf'), '');
        fs.writeFileSync(path.join(tempDir, 'Jua-Bold.otf'), '');
        fs.writeFileSync(path.join(tempDir, 'readme.txt'), '');

        assert.deepEqual(
            listBundledFontFaces([tempDir]).map(face => `${face.family}:${face.weight}:${face.style}`),
            [
                'Jua:400:normal',
                'Jua:700:normal',
            ],
        );
    } finally {
        fs.rmSync(tempDir, { recursive: true, force: true });
    }
});
