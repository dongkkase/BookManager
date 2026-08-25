import assert from 'node:assert/strict';
import test from 'node:test';
import {
    WINDOWS_ASSOCIATION_CHANGE_POWERSHELL_ARGS,
    WINDOWS_10_DEFAULT_APPS_URI,
    bookManagerProgId,
    buildWindows11DefaultAppsUri,
    buildWindowsFileAssociationCommands,
    buildWindowsFileAssociationStatusQueries,
    createWindowsFileAssociationService,
    getWindowsDefaultAppsUri,
    isWindows11Release,
    parseRegQueryDefaultValue,
    parseRegQueryValue,
    validateExtensionSelection,
} from './fileAssociationWindows.js';

const EXECUTABLE_PATH = 'C:\\Program Files\\BookManager\\BookManager.exe';
const EXTENSIONS = ['.cbz', '.epub', '.pdf'];

function createExecFileStub(handler) {
    const calls = [];
    const execFile = (file, args, options, callback) => {
        calls.push({ file, args: [...args], options: { ...options } });
        queueMicrotask(() => {
            try {
                const result = handler(args) || {};
                if (result.error) {
                    callback(result.error, result.stdout || '', result.stderr || '');
                    return;
                }
                callback(null, result.stdout || '', result.stderr || '');
            } catch (error) {
                callback(error, '', '');
            }
        });
    };
    return { calls, execFile };
}

function queryOutput(valueName, value) {
    return `\r\nHKEY_CURRENT_USER\\Software\\Example\r\n    ${valueName}    REG_SZ    ${value}\r\n`;
}

function missingRegistryEntry() {
    return Object.assign(new Error('The system was unable to find the specified registry key or value.'), {
        code: 1,
    });
}

test('확장자는 소문자 점 표기와 옵션 allowlist를 엄격히 따른다', () => {
    assert.deepEqual(validateExtensionSelection(['.cbz', '.pdf'], EXTENSIONS), ['.cbz', '.pdf']);
    assert.equal(bookManagerProgId('.7z'), 'BookManager.7z');

    assert.throws(() => validateExtensionSelection(['cbz'], EXTENSIONS), /canonical extension/);
    assert.throws(() => validateExtensionSelection(['.CBZ'], EXTENSIONS), /canonical extension/);
    assert.throws(() => validateExtensionSelection(['.rar'], EXTENSIONS), /Unsupported/);
    assert.throws(
        () => validateExtensionSelection(['.cbz\\UserChoice'], EXTENSIONS),
        /canonical extension/,
    );
    assert.throws(() => validateExtensionSelection(['.cbz', '.cbz'], EXTENSIONS), /duplicate/);
});

test('등록 명령은 reg.exe 배열 인자로 BookManager HKCU 후보만 변경한다', () => {
    const commands = buildWindowsFileAssociationCommands({
        executablePath: EXECUTABLE_PATH,
        extensions: ['.cbz', '.epub'],
        selectedExtensions: ['.cbz'],
    });

    assert.equal(commands.every(item => Array.isArray(item.args)), true);
    assert.equal(commands.some(item => (
        item.type === 'registerApplication'
        && item.args[1] === 'HKCU\\Software\\RegisteredApplications'
        && item.args.includes('Software\\BookManager\\Capabilities')
    )), true);
    assert.equal(commands.some(item => (
        item.type === 'registerAssociation'
        && item.extension === '.cbz'
        && item.args.includes('BookManager.cbz')
    )), true);

    const iconCommand = commands.find(item => item.type === 'registerDefaultIcon');
    assert.deepEqual(iconCommand.args, [
        'add',
        'HKCU\\Software\\Classes\\BookManager.cbz\\DefaultIcon',
        '/ve',
        '/t',
        'REG_SZ',
        '/d',
        `"${EXECUTABLE_PATH}",0`,
        '/f',
    ]);

    const openCommand = commands.find(item => item.type === 'registerOpenCommand');
    assert.equal(openCommand.args[openCommand.args.indexOf('/d') + 1], `"${EXECUTABLE_PATH}" "%1"`);
    assert.equal(commands.some(item => item.type === 'removeAssociation' && item.extension === '.epub'), true);
    assert.equal(commands.some(item => (
        item.type === 'removeProgId'
        && item.args[1] === 'HKCU\\Software\\Classes\\BookManager.epub'
    )), true);

    const mutatingTargets = commands.map(item => item.args.join(' '));
    assert.equal(mutatingTargets.some(target => target.includes('UserChoice')), false);
    assert.equal(mutatingTargets.some(target => target.includes('HKCR')), false);
});

test('허용되지 않은 확장자와 실행 경로는 레지스트리 명령을 만들지 못한다', () => {
    assert.throws(() => buildWindowsFileAssociationCommands({
        executablePath: EXECUTABLE_PATH,
        extensions: EXTENSIONS,
        selectedExtensions: ['.rar'],
    }), /Unsupported/);
    assert.throws(() => buildWindowsFileAssociationCommands({
        executablePath: 'BookManager.exe',
        extensions: EXTENSIONS,
        selectedExtensions: [],
    }), /absolute Windows file path/);
    assert.throws(() => buildWindowsFileAssociationCommands({
        executablePath: 'C:\\BookManager" /f.exe',
        extensions: EXTENSIONS,
        selectedExtensions: [],
    }), /absolute Windows file path/);
});

test('상태 조회 명령만 UserChoice를 읽고 candidate는 Capabilities에서 읽는다', () => {
    const [query] = buildWindowsFileAssociationStatusQueries({
        extensions: EXTENSIONS,
        requestedExtensions: ['.cbz'],
    });

    assert.deepEqual(query.userChoice, [
        'query',
        'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Explorer\\FileExts\\.cbz\\UserChoice',
        '/v',
        'ProgId',
    ]);
    assert.deepEqual(query.candidate, [
        'query',
        'HKCU\\Software\\BookManager\\Capabilities\\FileAssociations',
        '/v',
        '.cbz',
    ]);
    assert.deepEqual(query.candidateOpenCommand, [
        'query',
        'HKCU\\Software\\Classes\\BookManager.cbz\\shell\\open\\command',
        '/ve',
    ]);
});

test('reg.exe query 결과에서 이름에 맞는 REG_SZ 데이터만 파싱한다', () => {
    const output = [
        'HKEY_CURRENT_USER\\Software\\Example',
        '    OtherValue    REG_SZ    Other.Reader',
        '    ProgId        REG_SZ    BookManager.cbz',
        '',
    ].join('\r\n');

    assert.equal(parseRegQueryValue(output, 'ProgId'), 'BookManager.cbz');
    assert.equal(parseRegQueryValue(output, 'progId'), 'BookManager.cbz');
    assert.equal(parseRegQueryValue(output, '.cbz'), null);
});

test('reg.exe 기본값 조회 결과에서 REG_SZ 실행 명령을 파싱한다', () => {
    const output = [
        'HKEY_CURRENT_USER\\Software\\Classes\\BookManager.cbz\\shell\\open\\command',
        `    (Default)    REG_SZ    "${EXECUTABLE_PATH}" "%1"`,
        '',
    ].join('\r\n');

    assert.equal(
        parseRegQueryDefaultValue(output),
        `"${EXECUTABLE_PATH}" "%1"`,
    );
    assert.equal(parseRegQueryDefaultValue('    (Default)    REG_DWORD    0x1'), null);
    assert.equal(parseRegQueryDefaultValue(''), null);
});

test('상태는 UserChoice 기본값과 BookManager candidate 등록을 별도로 반환한다', async () => {
    const stub = createExecFileStub(args => {
        if (args.includes('/ve') && args[1].includes('BookManager.cbz')) {
            return {
                stdout: queryOutput('(Default)', `"${EXECUTABLE_PATH}" "%1"`),
            };
        }
        const valueName = args[args.indexOf('/v') + 1];
        if (args[1].includes('\\.cbz\\UserChoice') && valueName === 'ProgId') {
            return { stdout: queryOutput('ProgId', 'bookmanager.CBZ') };
        }
        if (valueName === '.cbz') {
            return { stdout: queryOutput('.cbz', 'BookManager.cbz') };
        }
        return { error: missingRegistryEntry() };
    });
    const service = createWindowsFileAssociationService({
        executablePath: EXECUTABLE_PATH,
        extensions: ['.cbz', '.epub'],
        execFile: stub.execFile,
    });

    const status = await service.getStatus();

    assert.deepEqual(status, [
        {
            extension: '.cbz',
            progId: 'BookManager.cbz',
            currentProgId: 'bookmanager.CBZ',
            isDefault: true,
            candidateProgId: 'BookManager.cbz',
            candidateOpenCommand: `"${EXECUTABLE_PATH}" "%1"`,
            candidateRegistered: true,
        },
        {
            extension: '.epub',
            progId: 'BookManager.epub',
            currentProgId: null,
            isDefault: false,
            candidateProgId: null,
            candidateOpenCommand: null,
            candidateRegistered: false,
        },
    ]);
    assert.equal(stub.calls.every(call => call.file === 'reg.exe' && Array.isArray(call.args)), true);
});

test('candidate ProgID가 같아도 실행 경로가 오래됐거나 명령이 없으면 등록되지 않은 상태다', async () => {
    const staleExecutablePath = 'C:\\Old Location\\BookManager.exe';
    const stub = createExecFileStub(args => {
        if (args.includes('/ve')) {
            if (args[1].includes('BookManager.cbz')) {
                return {
                    stdout: queryOutput(
                        '(Default)',
                        `"${staleExecutablePath}" "%1"`,
                    ),
                };
            }
            return { error: missingRegistryEntry() };
        }
        const valueName = args[args.indexOf('/v') + 1];
        if (valueName === '.cbz') {
            return { stdout: queryOutput('.cbz', 'BookManager.cbz') };
        }
        if (valueName === '.epub') {
            return { stdout: queryOutput('.epub', 'BookManager.epub') };
        }
        return { error: missingRegistryEntry() };
    });
    const service = createWindowsFileAssociationService({
        executablePath: EXECUTABLE_PATH,
        extensions: ['.cbz', '.epub'],
        execFile: stub.execFile,
    });

    const status = await service.getStatus();

    assert.equal(status[0].candidateProgId, 'BookManager.cbz');
    assert.equal(status[0].candidateOpenCommand, `"${staleExecutablePath}" "%1"`);
    assert.equal(status[0].candidateRegistered, false);
    assert.equal(status[1].candidateProgId, 'BookManager.epub');
    assert.equal(status[1].candidateOpenCommand, null);
    assert.equal(status[1].candidateRegistered, false);
});

test('체크 해제된 현재 기본 ProgID는 유지하고 다른 BookManager 후보만 제거한다', async () => {
    const stub = createExecFileStub(args => {
        if (args[0] !== 'query') return {};
        const extension = args[1].includes('\\.cbz\\') ? '.cbz' : '.epub';
        if (extension === '.cbz') {
            return { stdout: queryOutput('ProgId', 'BookManager.cbz') };
        }
        return { stdout: queryOutput('ProgId', 'Other.Reader') };
    });
    const service = createWindowsFileAssociationService({
        executablePath: EXECUTABLE_PATH,
        extensions: EXTENSIONS,
        execFile: stub.execFile,
    });

    const result = await service.apply(['.pdf']);
    const mutations = stub.calls.filter(call => call.args[0] !== 'query');

    assert.deepEqual(result, {
        selectedExtensions: ['.pdf'],
        removedExtensions: ['.epub'],
        retainedCurrentDefaults: ['.cbz'],
        notificationSucceeded: true,
        notificationError: null,
    });
    assert.equal(mutations.some(call => (
        call.args[0] === 'delete'
        && call.args.some(argument => argument.includes('BookManager.cbz'))
    )), false);
    assert.equal(mutations.some(call => (
        call.args[0] === 'delete'
        && call.args.some(argument => argument.includes('BookManager.epub'))
    )), true);
    assert.equal(mutations.some(call => call.args.join(' ').includes('UserChoice')), false);
    assert.equal(mutations.some(call => (
        call.args[0] === 'add'
        && call.args.includes('.pdf')
        && call.args.includes('BookManager.pdf')
    )), true);
    const notificationCall = stub.calls.at(-1);
    assert.equal(notificationCall.file, 'powershell.exe');
    assert.deepEqual(notificationCall.args, WINDOWS_ASSOCIATION_CHANGE_POWERSHELL_ARGS);
    assert.match(notificationCall.args.at(-1), /SHChangeNotify\(0x08000000/);
});

test('SHChangeNotify 실패는 레지스트리 적용을 실패시키지 않고 결과로 반환한다', async () => {
    const notificationFailure = Object.assign(new Error('PowerShell is unavailable.'), {
        code: 'ENOENT',
    });
    const stub = createExecFileStub(args => {
        if (args[0] === 'query') return { error: missingRegistryEntry() };
        if (args === WINDOWS_ASSOCIATION_CHANGE_POWERSHELL_ARGS) {
            return { error: notificationFailure };
        }
        return {};
    });
    const service = createWindowsFileAssociationService({
        executablePath: EXECUTABLE_PATH,
        extensions: ['.cbz'],
        execFile: stub.execFile,
    });

    const result = await service.apply(['.cbz']);

    assert.deepEqual(result, {
        selectedExtensions: ['.cbz'],
        removedExtensions: [],
        retainedCurrentDefaults: [],
        notificationSucceeded: false,
        notificationError: 'PowerShell is unavailable.',
    });
    assert.equal(stub.calls.some(call => (
        call.file === 'reg.exe'
        && call.args[0] === 'add'
        && call.args.includes('BookManager.cbz')
    )), true);
    assert.equal(stub.calls.at(-1).file, 'powershell.exe');
});

test('UserChoice 조회에 예상하지 못한 오류가 나면 삭제를 시작하지 않는다', async () => {
    const accessDenied = Object.assign(new Error('Access is denied.'), { code: 5 });
    const stub = createExecFileStub(args => (
        args[0] === 'query' ? { error: accessDenied } : {}
    ));
    const service = createWindowsFileAssociationService({
        executablePath: EXECUTABLE_PATH,
        extensions: ['.cbz'],
        execFile: stub.execFile,
    });

    await assert.rejects(service.apply([]), /Access is denied/);
    assert.equal(stub.calls.some(call => call.args[0] !== 'query'), false);
});

test('Windows 11은 앱별 URI를 사용하고 Windows 10은 일반 기본 앱 URI를 사용한다', () => {
    assert.equal(isWindows11Release('10.0.21999'), false);
    assert.equal(isWindows11Release('10.0.22000'), true);
    assert.equal(isWindows11Release('11.0.1'), true);
    assert.equal(isWindows11Release('invalid'), false);
    assert.equal(
        buildWindows11DefaultAppsUri('Book Manager'),
        'ms-settings:defaultapps?registeredAppUser=Book%20Manager',
    );
    assert.equal(
        getWindowsDefaultAppsUri({ windowsRelease: '10.0.22631' }),
        'ms-settings:defaultapps?registeredAppUser=BookManager',
    );
    assert.equal(
        getWindowsDefaultAppsUri({ windowsRelease: '10.0.19045' }),
        WINDOWS_10_DEFAULT_APPS_URI,
    );
});
