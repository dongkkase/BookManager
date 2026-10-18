import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

const EMPTY_FILES = Object.freeze([]);
const EMPTY_MATCHES = Object.freeze([]);
const EMPTY_RESULTS = new Map();

function realFilePath(file) {
    if (!file || file.isDirectory || file.exists === false) return '';
    return [file.full_path, file.path].find(value => typeof value === 'string'
        && (/^\//.test(value) || /^[a-z]:[\\/]/i.test(value) || /^\\\\/.test(value))) || '';
}

function pathKey(value) {
    const path = value.normalize('NFC');
    return /^[a-z]:[\\/]/i.test(path) || /^\\\\/.test(path)
        ? path.replace(/\\/g, '/').toLowerCase()
        : path;
}

function clearDuplicates(file) {
    if (file.dup_count === 0 && file.max_ratio === 0 && Array.isArray(file.duplicate_matches) && file.duplicate_matches.length === 0) return file;
    return { ...file, duplicate_matches: EMPTY_MATCHES, dup_count: 0, max_ratio: 0 };
}

export function useListDuplicateCheck({ files = EMPTY_FILES, enabled = false, scopeKey = '', dupFolders = EMPTY_FILES, onError } = {}) {
    const [refreshVersion, setRefreshVersion] = useState(0);
    const [result, setResult] = useState({ key: '', matches: EMPTY_RESULTS, busy: false });
    const cancellationRef = useRef(Promise.resolve());
    const onErrorRef = useRef(onError);
    onErrorRef.current = onError;

    const input = useMemo(() => {
        const candidates = new Map();
        for (const file of files) {
            const filePath = realFilePath(file);
            if (!filePath) continue;
            candidates.set(pathKey(filePath), {
                full_path: filePath,
                name: file.name || filePath.split(/[\\/]/).pop(),
                mtime: file.mtime ?? file.mtimeMs ?? file.modified ?? null,
                size: file.size ?? null,
            });
        }
        const entries = [...candidates].sort(([left], [right]) => left < right ? -1 : left > right ? 1 : 0);
        const folders = [...new Set(dupFolders.filter(folder => typeof folder === 'string' && folder))].sort();
        return {
            files: entries.map(([, file]) => file),
            folders,
            signature: JSON.stringify([scopeKey, entries.map(([key, file]) => [key, file.name, file.mtime, file.size]), folders]),
        };
    }, [files, dupFolders, scopeKey]);
    const requestKey = JSON.stringify([Boolean(enabled), input.signature, refreshVersion]);
    const requestKeyRef = useRef(requestKey);
    requestKeyRef.current = requestKey;
    const inputRef = useRef(input);
    inputRef.current = input;

    useEffect(() => {
        const request = inputRef.current;
        const shouldRun = enabled && request.files.length > 0 && request.folders.length > 0;
        let active = true;
        let running = false;
        const isCurrent = () => active && requestKeyRef.current === requestKey;
        const api = window.electronAPI;
        setResult({ key: requestKey, matches: EMPTY_RESULTS, busy: shouldRun });

        if (shouldRun) {
            const run = async () => {
                await cancellationRef.current;
                if (!isCurrent()) return;
                try {
                    if (!api?.checkFileDuplicates) throw new Error('Duplicate check unavailable');
                    running = true;
                    const response = await api.checkFileDuplicates(request.files, { dupFolders: request.folders });
                    if (!isCurrent()) return;
                    if (response?.cancelled) {
                        setResult({ key: requestKey, matches: EMPTY_RESULTS, busy: false });
                        return;
                    }
                    if (!Array.isArray(response?.files)) throw new Error(response?.message || 'Duplicate check failed');
                    const matches = new Map();
                    for (const file of response.files) {
                        const filePath = realFilePath(file);
                        if (!filePath) continue;
                        matches.set(pathKey(filePath), {
                            duplicate_matches: Array.isArray(file.duplicate_matches) ? file.duplicate_matches : EMPTY_MATCHES,
                            dup_count: Math.max(0, Number(file.dup_count) || 0),
                            max_ratio: Math.max(0, Number(file.max_ratio) || 0),
                        });
                    }
                    setResult({ key: requestKey, matches, busy: false });
                } catch (error) {
                    if (!isCurrent()) return;
                    setResult({ key: requestKey, matches: EMPTY_RESULTS, busy: false });
                    onErrorRef.current?.(error);
                } finally {
                    running = false;
                }
            };
            void run();
        }

        return () => {
            active = false;
            if (running) {
                cancellationRef.current = Promise.resolve()
                    .then(() => api?.stopTask?.('folder:checkDuplicates'))
                    .catch(() => {});
            }
        };
    }, [enabled, requestKey]);

    const checkedFiles = useMemo(() => files.map(file => {
        const filePath = realFilePath(file);
        const match = enabled && result.key === requestKey && filePath
            ? result.matches.get(pathKey(filePath))
            : null;
        return match ? { ...file, ...match } : clearDuplicates(file);
    }), [files, enabled, result, requestKey]);
    const refresh = useCallback(() => setRefreshVersion(version => version + 1), []);

    return { files: checkedFiles, busy: Boolean(enabled && result.key === requestKey && result.busy), refresh };
}
