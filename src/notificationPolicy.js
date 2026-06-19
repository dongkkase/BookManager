export function partitionSkippedFiles(files = []) {
    const nested = [];
    const unsupported = [];

    for (const file of files.filter(Boolean)) {
        if (/nested archive/i.test(file)) nested.push(file);
        else unsupported.push(file);
    }

    return { nested, unsupported };
}
