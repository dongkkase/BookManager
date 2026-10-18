import assert from 'node:assert/strict';
import test from 'node:test';
import { classifyArchiveFailure, createArchiveFailureClassifier } from './archiveFailureReason.js';

const DIAGNOSTICS = [
    ['password-required', [
        'ERROR: Wrong password : pages/001.jpg',
        'ERROR: The password is incorrect.',
        'password is incorrect',
        'Can not open encrypted archive. Wrong password?',
        'Cannot open encrypted archive',
        'ERROR: CRC Failed in encrypted file. Wrong password? : pages/001.jpg',
        'ERROR: Data Error in encrypted file. Wrong password? : pages/001.jpg',
        'Headers Error in encrypted archive. Wrong password?',
        'Enter password:',
        'Enter password (will not be echoed):',
    ]],
    ['unsupported-method', [
        'ERROR: Unsupported Method : pages/001.jpg',
        'ERRORS:\nUnsupported method',
    ]],
    ['invalid-archive', [
        'ERROR: /books/example.zip\nCan not open the file as archive',
        'ERROR: /books/example.7z\nCannot open the file as [7z] archive',
        'Cannot open file as [zip] archive',
        'Can not open file as archive',
        'ERROR: Is not archive : example.zip',
    ]],
    ['corrupt-data', [
        'ERROR: CRC Failed : pages/001.jpg',
        'ERROR: Data Error : pages/001.jpg',
        'ERRORS:\nHeaders Error',
        'ERRORS:\nUnexpected end of archive',
    ]],
    ['access-denied', [
        'ERROR: Access is denied. : C:\\books\\example.zip',
        'ERROR: /books/example.zip\nPermission denied',
        'ERROR: 액세스가 거부되었습니다.',
    ]],
    ['disk-full', [
        'System ERROR:\nNo space left on device',
        'System ERROR: There is not enough space on the disk.',
        'System ERROR: The disk is full.',
        'System ERROR: 디스크가 꽉 찼습니다.',
        'System ERROR: 디스크 공간이 부족합니다.',
    ]],
    ['path-too-long', [
        'ERROR: The filename or extension is too long.',
        'ERROR: File name too long : /books/example.zip',
        'ERROR: The file name is too long.',
        'ERROR: 파일 이름이 너무 깁니다.',
        'ERROR: 파일 이름 또는 확장명이 너무 깁니다.',
    ]],
    ['file-in-use', [
        'The process cannot access the file because it is being used by another process.',
        'The process cannot access the file because another process has locked a portion of the file.',
        '다른 프로세스가 파일을 사용 중이기 때문에 프로세스가 액세스할 수 없습니다.',
        '다른 프로세스에서 파일의 부분을 잠갔으므로 이 프로세스에서 해당 파일에 액세스할 수 없습니다.',
    ]],
    ['path-not-found', [
        'The system cannot find the file specified.',
        'The system cannot find the path specified.',
        'The network path was not found.',
        '시스템은 지정된 파일을 찾을 수 없습니다.',
        '지정한 경로를 찾을 수 없습니다.',
        '네트워크 경로를 찾을 수 없습니다.',
    ]],
    ['invalid-path', [
        'The filename, directory name, or volume label syntax is incorrect.',
        'The specified path is invalid.',
        'The directory name is invalid.',
        '파일 이름, 디렉터리 이름 또는 볼륨 레이블 구문이 잘못되었습니다.',
        '지정한 경로가 잘못되었습니다.',
        '디렉터리 이름이 잘못되었습니다.',
    ]],
    ['io-error', [
        'The system cannot write to the specified device.',
        'The system cannot read from the specified device.',
        'A device attached to the system is not functioning.',
        'The request could not be performed because of an I/O device error.',
        '시스템이 지정된 디바이스에 쓸 수 없습니다.',
        '시스템이 지정된 디바이스에서 읽을 수 없습니다.',
        '시스템에 연결된 디바이스가 작동하지 않습니다.',
    ]],
    ['out-of-memory', [
        'Not enough memory resources are available to process this command.',
        'Not enough storage is available to complete this operation.',
        '메모리 리소스가 부족하여 이 명령을 처리할 수 없습니다.',
        '스토리지가 부족하여 이 작업을 완료할 수 없습니다.',
    ]],
    ['file-open-failed', [
        'Error:\ncannot open file\n/books/example.partial',
    ]],
];

for (const [reason, examples] of DIAGNOSTICS) {
    test(`classifies ${reason} using diagnostic lines`, () => {
        for (const output of examples) {
            assert.equal(classifyArchiveFailure(output), reason, output);
            assert.equal(classifyArchiveFailure(`7-Zip\r\n  ${output.toUpperCase().replaceAll('\n', '\r\n')}  \r\nSub items Errors: 1\r\n`), reason, output);
        }
    });
}

test('password diagnostics take precedence over other archive failure lines', () => {
    const diagnostics = 'ERRORS:\nHeaders Error\nCan not open the file as archive';
    assert.equal(classifyArchiveFailure(`${diagnostics}\nERROR: Wrong password`), 'password-required');
    assert.equal(classifyArchiveFailure(`ERROR: Wrong password\n${diagnostics}`), 'password-required');
});

test('does not mistake diagnostic phrases in file paths or names for failure reasons', () => {
    for (const phrase of ['Wrong password', 'password is incorrect', 'Unsupported Method', 'Can not open file as archive', 'Is not archive', 'CRC Failed', 'Data Error', 'Headers Error', 'Unexpected end of archive', 'Access is denied', 'Permission denied', 'No space left on device', 'There is not enough space on the disk', 'The filename or extension is too long', 'File name too long', 'Enter password']) {
        for (const output of [
            `Extracting archive: /books/${phrase}.zip`,
            `Path = ${phrase}.zip`,
            `ERROR: /books/${phrase}.zip`,
            `ERROR: ${phrase}.zip`,
            `${phrase}.zip`,
        ]) {
            assert.equal(classifyArchiveFailure(output), undefined, output);
        }
    }
    assert.equal(classifyArchiveFailure('ERROR: Data Error : Wrong password.zip'), 'corrupt-data');
    assert.equal(classifyArchiveFailure('ERROR: Unsupported Method : Data Error.zip'), 'unsupported-method');
});

test('new diagnostic phrases inside paths and arbitrary message details stay unclassified', () => {
    for (const [, examples] of DIAGNOSTICS.slice(4)) {
        for (const phrase of examples.filter(value => !value.includes('\n') && !value.includes(' : ')).map(value => value.replace(/^ERROR: |^System ERROR: /, ''))) {
            for (const output of [
                `Extracting archive: /books/${phrase}.zip`,
                `ERROR: /books/${phrase}.zip`,
                `ERROR: ${phrase}.zip`,
                `ERROR: private-message ${phrase}`,
                `${phrase} token=secret`,
            ]) {
                assert.equal(classifyArchiveFailure(output), undefined, output);
            }
        }
    }
    for (const output of ['cannot open file.zip', '/books/cannot open file', 'cannot open file : /books/private.zip', 'cannot open file.']) {
        assert.equal(classifyArchiveFailure(output), undefined, output);
    }
});

test('file-open-failed is only a fallback when no more specific diagnostic is present', () => {
    for (const [reason, examples] of DIAGNOSTICS.slice(0, -1)) {
        assert.equal(classifyArchiveFailure(`Error:\ncannot open file\n/books/example.partial\n${examples[0]}`), reason);
        assert.equal(classifyArchiveFailure(`${examples[0]}\nError:\ncannot open file\n/books/example.partial`), reason);
    }
});

test('streaming classification handles split diagnostic lines, CRLF and final lines without a newline', () => {
    for (const [reason, examples] of DIAGNOSTICS) {
        for (const output of examples) {
            for (const width of [1, 7, 31]) {
                const classifier = createArchiveFailureClassifier();
                const text = `7-Zip\r\n${output.replaceAll('\n', '\r\n')}`;
                for (let start = 0; start < text.length; start += width) {
                    classifier.write('stdout', text.slice(start, start + width));
                }
                assert.equal(classifier.finish(), reason, `${reason}, chunk width ${width}`);
            }
        }
    }
});

test('streaming classification retains a reason after it leaves a 16 KiB output tail', () => {
    const classifier = createArchiveFailureClassifier();
    classifier.write('stderr', 'ERROR: 액세스가 거부되었습니다.\n');
    for (let index = 0; index < 100; index += 1) {
        classifier.write('stdout', `+ ${'private-file-'.repeat(100)}.jpg\r\n`);
    }
    assert.equal(classifier.finish(), 'access-denied');
});

test('streaming classification keeps stdout and stderr partial lines separate', () => {
    const classifier = createArchiveFailureClassifier();
    classifier.write('stdout', 'Wrong ');
    classifier.write('stderr', 'password\n');
    assert.equal(classifier.finish(), undefined);

    const interleaved = createArchiveFailureClassifier();
    interleaved.write('stdout', 'ERROR: Unsupported ');
    interleaved.write('stderr', 'Permission denied\r');
    interleaved.write('stdout', 'Method');
    interleaved.write('stderr', '\n');
    assert.equal(interleaved.finish(), 'unsupported-method');
});

test('streaming classification preserves pattern priority across streams and arrival orders', () => {
    for (const lines of [DIAGNOSTICS, [...DIAGNOSTICS].reverse()]) {
        const classifier = createArchiveFailureClassifier();
        for (let index = 0; index < lines.length; index += 1) {
            classifier.write(index % 2 ? 'stdout' : 'stderr', `${lines[index][1][0]}\n`);
        }
        assert.equal(classifier.finish(), 'password-required');
    }
});

test('streaming classification drops an oversized line through its delimiter without recognizing a suffix', () => {
    const classifier = createArchiveFailureClassifier();
    classifier.write('stdout', 'x'.repeat(16 * 1024 + 1));
    classifier.write('stdout', 'Wrong password');
    classifier.write('stdout', '\r');
    classifier.write('stdout', '\nPermission denied');
    assert.equal(classifier.finish(), 'access-denied');

    const unfinished = createArchiveFailureClassifier();
    unfinished.write('stderr', ' '.repeat(16 * 1024));
    unfinished.write('stderr', 'Wrong password');
    assert.equal(unfinished.finish(), undefined);

    const complete = createArchiveFailureClassifier();
    complete.write('stdout', `${' '.repeat(16 * 1024)}Wrong password\nPermission denied\n`);
    assert.equal(complete.finish(), 'access-denied');
});

test('streaming classification accepts a complete diagnostic at the line length limit', () => {
    const diagnostic = 'Permission denied';
    const classifier = createArchiveFailureClassifier();
    classifier.write('stderr', ' '.repeat(16 * 1024 - diagnostic.length));
    classifier.write('stderr', diagnostic);
    assert.equal(classifier.finish(), 'access-denied');
});

test('streaming finish is stable and invalid channels or input cannot contribute a reason', () => {
    const classifier = createArchiveFailureClassifier();
    classifier.write('private-channel', 'Wrong password\n');
    for (const chunk of [undefined, null, 2, {}, []]) classifier.write('stderr', chunk);
    classifier.write('stdout', 'cannot open file');
    assert.equal(classifier.finish(), 'file-open-failed');
    classifier.write('stderr', 'Wrong password\n');
    assert.equal(classifier.finish(), 'file-open-failed');
});

test('leaves missing, unrecognized and successful output unclassified', () => {
    for (const output of [undefined, null, 2, {}, '', 'Everything is Ok', 'ERROR: Error #2', '7-Zip\nArchives with Errors: 1', 'ERROR: Cannot find archive']) {
        assert.equal(classifyArchiveFailure(output), undefined);
    }
});
