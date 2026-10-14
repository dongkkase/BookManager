import assert from 'node:assert/strict';
import test from 'node:test';
import { classifyArchiveFailure } from './archiveFailureReason.js';

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
    ]],
    ['disk-full', [
        'System ERROR:\nNo space left on device',
        'System ERROR: There is not enough space on the disk.',
    ]],
    ['path-too-long', [
        'ERROR: The filename or extension is too long.',
        'ERROR: File name too long : /books/example.zip',
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

test('leaves missing, unrecognized and successful output unclassified', () => {
    for (const output of [undefined, null, 2, {}, '', 'Everything is Ok', 'ERROR: Error #2', '7-Zip\nArchives with Errors: 1', 'ERROR: Cannot find archive']) {
        assert.equal(classifyArchiveFailure(output), undefined);
    }
});
