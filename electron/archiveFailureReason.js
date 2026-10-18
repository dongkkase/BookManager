const FAILURE_PATTERNS = [
    ['password-required', [
        /^(?:Wrong password|(?:The )?password is incorrect)[.?]?(?:\s*:\s.*)?$/i,
        /^Can(?: not|not) open encrypted archive(?:\. Wrong password\?)?[.]?(?:\s*:\s.*)?$/i,
        /^(?:CRC Failed|Data Error) in encrypted file\. Wrong password\?(?:\s*:\s.*)?$/i,
        /^Headers Error in encrypted archive\. Wrong password\?(?:\s*:\s.*)?$/i,
        /^Enter password(?: \(will not be echoed\))?:?$/i,
    ]],
    ['unsupported-method', [
        /^Unsupported Method[.]?(?:\s*:\s.*)?$/i,
    ]],
    ['invalid-archive', [
        /^Can(?: not|not) open (?:the )?file as (?:\[[^\]\r\n]+\] )?archive[.]?(?:\s*:\s.*)?$/i,
        /^Is not archive[.]?(?:\s*:\s.*)?$/i,
    ]],
    ['corrupt-data', [
        /^(?:CRC Failed|Data Error|Headers Error|Unexpected end of archive)[.]?(?:\s*:\s.*)?$/i,
    ]],
    ['access-denied', [
        /^(?:Access is denied|Permission denied)[.]?(?:\s*:\s.*)?$/i,
        /^액세스가 거부되었습니다[.]?(?:\s*:\s.*)?$/,
    ]],
    ['disk-full', [
        /^(?:No space left on device|There is not enough space on the disk|The disk is full)[.]?(?:\s*:\s.*)?$/i,
        /^(?:디스크가 꽉 찼습니다|디스크 공간이 부족합니다)[.]?(?:\s*:\s.*)?$/,
    ]],
    ['path-too-long', [
        /^(?:The filename or extension is too long|The file name is too long|File name too long)[.]?(?:\s*:\s.*)?$/i,
        /^(?:파일 이름이 너무 깁니다|파일 이름 또는 확장명이 너무 깁니다)[.]?(?:\s*:\s.*)?$/,
    ]],
    ['file-in-use', [
        /^(?:The process cannot access the file because it is being used by another process|The process cannot access the file because another process has locked a portion of the file)[.]?(?:\s*:\s.*)?$/i,
        /^(?:다른 프로세스가 파일을 사용 중이기 때문에 프로세스가 액세스할 수 없습니다|다른 프로세스에서 파일의 부분을 잠갔으므로 이 프로세스에서 해당 파일에 액세스할 수 없습니다)[.]?(?:\s*:\s.*)?$/,
    ]],
    ['path-not-found', [
        /^(?:The system cannot find the file specified|The system cannot find the path specified|The network path was not found)[.]?(?:\s*:\s.*)?$/i,
        /^(?:시스템은 지정된 파일을 찾을 수 없습니다|지정한 경로를 찾을 수 없습니다|네트워크 경로를 찾을 수 없습니다)[.]?(?:\s*:\s.*)?$/,
    ]],
    ['invalid-path', [
        /^(?:The filename, directory name, or volume label syntax is incorrect|The specified path is invalid|The directory name is invalid)[.]?(?:\s*:\s.*)?$/i,
        /^(?:파일 이름, 디렉터리 이름 또는 볼륨 레이블 구문이 잘못되었습니다|지정한 경로가 잘못되었습니다|디렉터리 이름이 잘못되었습니다)[.]?(?:\s*:\s.*)?$/,
    ]],
    ['io-error', [
        /^(?:The system cannot write to the specified device|The system cannot read from the specified device|A device attached to the system is not functioning|The request could not be performed because of an I\/O device error)[.]?(?:\s*:\s.*)?$/i,
        /^(?:시스템이 지정된 디바이스에 쓸 수 없습니다|시스템이 지정된 디바이스에서 읽을 수 없습니다|시스템에 연결된 디바이스가 작동하지 않습니다)[.]?(?:\s*:\s.*)?$/,
    ]],
    ['out-of-memory', [
        /^(?:Not enough memory resources are available to process this command|Not enough storage is available to complete this operation)[.]?(?:\s*:\s.*)?$/i,
        /^(?:메모리 리소스가 부족하여 이 명령을 처리할 수 없습니다|스토리지가 부족하여 이 작업을 완료할 수 없습니다)[.]?(?:\s*:\s.*)?$/,
    ]],
    ['file-open-failed', [
        /^cannot open file$/i,
    ]],
];
const MAX_LINE_LENGTH = 16 * 1024;

export function createArchiveFailureClassifier() {
    const streams = new Map([
        ['stdout', { line: '', dropping: false }],
        ['stderr', { line: '', dropping: false }],
    ]);
    let reasonIndex = FAILURE_PATTERNS.length;
    let finished = false;

    function classifyLine(line) {
        const diagnostic = line.trim().replace(/^(?:System )?ERROR:\s*/i, '');
        for (let index = 0; index < reasonIndex; index += 1) {
            if (FAILURE_PATTERNS[index][1].some(pattern => pattern.test(diagnostic))) {
                reasonIndex = index;
                return;
            }
        }
    }

    return {
        write(channel, chunk) {
            const stream = streams.get(channel);
            if (finished || !stream || typeof chunk !== 'string' || !chunk) return;
            const separators = /[\r\n]/g;
            let start = 0;
            let separator;
            while ((separator = separators.exec(chunk))) {
                if (!stream.dropping && stream.line.length + separator.index - start <= MAX_LINE_LENGTH) {
                    classifyLine(stream.line + chunk.slice(start, separator.index));
                }
                stream.line = '';
                stream.dropping = false;
                start = separator.index + 1;
            }
            if (!stream.dropping) {
                if (stream.line.length + chunk.length - start > MAX_LINE_LENGTH) {
                    stream.line = '';
                    stream.dropping = true;
                } else {
                    stream.line += chunk.slice(start);
                }
            }
        },
        finish() {
            if (!finished) {
                for (const stream of streams.values()) {
                    if (!stream.dropping) classifyLine(stream.line);
                    stream.line = '';
                }
                finished = true;
            }
            return FAILURE_PATTERNS[reasonIndex]?.[0];
        },
    };
}

export function classifyArchiveFailure(output) {
    if (typeof output !== 'string' || !output) return undefined;
    const classifier = createArchiveFailureClassifier();
    classifier.write('stdout', output);
    return classifier.finish();
}
