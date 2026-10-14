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
    ]],
    ['disk-full', [
        /^(?:No space left on device|There is not enough space on the disk)[.]?(?:\s*:\s.*)?$/i,
    ]],
    ['path-too-long', [
        /^(?:The filename or extension is too long|File name too long)[.]?(?:\s*:\s.*)?$/i,
    ]],
];

export function classifyArchiveFailure(output) {
    if (typeof output !== 'string' || !output) return undefined;

    const lines = output.split(/\r\n|[\r\n]/).map(line => line.trim().replace(/^(?:System )?ERROR:\s*/i, ''));
    for (const [reason, patterns] of FAILURE_PATTERNS) {
        if (lines.some(line => patterns.some(pattern => pattern.test(line)))) return reason;
    }
    return undefined;
}
