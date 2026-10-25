import { useCallback, useEffect, useRef, useState } from 'react';

function pathKey(value) {
    const path = String(value || '');
    const platform = typeof navigator === 'undefined' ? '' : navigator.platform;
    if (/mac|darwin/i.test(platform)) return path.normalize('NFC');
    if (/win/i.test(platform)) return path.replace(/\\/g, '/').toLowerCase();
    return path;
}

export function useAuthorBookDetails({ enabled, scopeKey, revision }) {
    const [snapshot, setSnapshot] = useState(null);
    const contextRef = useRef(null);
    const selectionRef = useRef(null);
    const requestRef = useRef(0);
    const mountedRef = useRef(true);
    contextRef.current = { enabled, scopeKey, revision };

    const load = useCallback(record => {
        const request = ++requestRef.current;
        const requestedRevision = contextRef.current.revision;
        const isCurrent = () => mountedRef.current
            && requestRef.current === request
            && selectionRef.current === record
            && contextRef.current.enabled
            && contextRef.current.scopeKey === record.scopeKey
            && contextRef.current.revision === requestedRevision;
        if (!isCurrent()) return;
        record.patches = {};
        record.loading = true;
        record.error = '';
        setSnapshot({ ...record });
        const merge = update => {
            record.file = { ...record.file, ...update, path: record.path, full_path: record.fullPath };
            setSnapshot({ ...record });
        };
        void Promise.resolve().then(() => isCurrent() ? window.electronAPI?.getFilePreview?.(record.fullPath, { force: false }) : null).then(result => {
            if (!isCurrent()) return;
            record.loading = false;
            if (!result?.success || !result.file) {
                record.error = result?.message || 'unavailable';
                setSnapshot({ ...record });
                return;
            }
            merge({ ...result.file, ...record.patches });
        }).catch(error => {
            if (!isCurrent()) return;
            record.loading = false;
            record.error = error?.message || 'unavailable';
            setSnapshot({ ...record });
        });
        if (window.electronAPI?.getReadingStates) {
            void Promise.resolve().then(() => isCurrent() ? window.electronAPI.getReadingStates([record.fullPath]) : null).then(rows => {
                if (!isCurrent() || !Array.isArray(rows)) return;
                const readingState = rows.find(row => row && !row.deletedAt && pathKey(row.filePath) === pathKey(record.fullPath)) || null;
                merge({ readingState });
            }).catch(() => {});
        }
    }, []);

    const selectFile = useCallback(file => {
        const context = contextRef.current;
        const fullPath = file?.full_path || file?.path;
        const current = selectionRef.current;
        if (context.enabled && mountedRef.current && fullPath && current?.scopeKey === context.scopeKey
            && pathKey(current.fullPath) === pathKey(fullPath) && !current.error) return;
        requestRef.current += 1;
        if (!context.enabled || !fullPath || !mountedRef.current) {
            selectionRef.current = null;
            if (mountedRef.current) setSnapshot(null);
            return;
        }
        const record = {
            file,
            scopeKey: context.scopeKey,
            path: file.path || fullPath,
            fullPath,
            patches: {},
            loading: true,
            error: '',
        };
        selectionRef.current = record;
        load(record);
    }, [load]);

    const patchFiles = useCallback(changes => {
        const record = selectionRef.current;
        const context = contextRef.current;
        if (!record || !mountedRef.current || !context.enabled || context.scopeKey !== record.scopeKey) return;
        const matches = (Array.isArray(changes) ? changes : []).filter(change => (
            change && pathKey(change.full_path || change.path || change.filePath) === pathKey(record.fullPath)
        ));
        if (!matches.length) return;
        for (const change of matches) {
            const { path, full_path, filePath, ...patch } = change;
            Object.assign(record.patches, patch);
            record.file = { ...record.file, ...patch };
        }
        setSnapshot({ ...record });
    }, []);

    useEffect(() => {
        mountedRef.current = true;
        return () => {
            mountedRef.current = false;
            requestRef.current += 1;
        };
    }, []);
    useEffect(() => {
        const record = selectionRef.current;
        if (!enabled || record?.scopeKey !== scopeKey) {
            selectFile(null);
        } else if (record) {
            load(record);
        }
    }, [enabled, scopeKey, revision, load, selectFile]);

    const visible = enabled && snapshot?.scopeKey === scopeKey ? snapshot : null;
    return {
        file: visible?.file || null,
        selectedPath: visible?.fullPath || '',
        selectFile,
        patchFiles,
        loading: Boolean(visible?.loading),
        error: visible?.error || '',
    };
}
