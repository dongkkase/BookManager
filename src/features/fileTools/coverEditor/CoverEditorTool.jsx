import React, { useCallback, useEffect, useRef, useState } from 'react';
import { CoverEditorDialog } from '../../../components/folder/CoverEditorDialog';
import { droppedPathsFromDataTransfer, isFilePathDrag, normalizeDroppedPaths } from '../../../appShell';
import { runCoverEditorBatch, supportsCoverEditor } from '../../../coverEditorBatch';
import { AUDIO_EXTENSIONS, COMIC_EXTENSIONS } from '../../../metadata/metadataTypes';
import { applyCoverReadingAdjustment } from '../../../../electron/coverReadingState';
import { createToolbarState, emitToolbarState } from '../../../toolbarState';
import { collectCoverEditorFolderPaths } from './coverEditorFolderPaths';
import { FileDropHoverOverlay } from '../../../components/FileDropHoverOverlay';
import { resolveFileDropMode } from '../../../dropPolicy';
import { extractCoverImageTransfer, isCoverImagePath, isCoverImageTransfer } from '../../../coverEditorImageTransfer';
import { isTextEntryTarget } from '../../../interactionPolicy';
import { shouldPlayCompletionSound } from '../../../completionSoundPolicy';

const fileFromPath = path => ({ path, full_path: path, name: path.split(/[\\/]/).pop(), checked: true });
const supportedExtensions = [...COMIC_EXTENSIONS, ...AUDIO_EXTENSIONS, '.epub', '.pdf', '.txt'].map(extension => extension.slice(1));
const isImageDrag = dataTransfer => {
    const paths = droppedPathsFromDataTransfer(dataTransfer);
    if (paths.length) return paths.every(isCoverImagePath);
    return isCoverImageTransfer(dataTransfer);
};

export default function CoverEditorTool({ config, saveConfig, t, showToast, onBack, openRequest, registerBeforeLeave }) {
    const [files, setFiles] = useState([]);
    const [preferences, setPreferences] = useState(null);
    const [session, setSession] = useState(0);
    const [busy, setBusy] = useState(false);
    const [collecting, setCollecting] = useState(false);
    const [choosingAddMode, setChoosingAddMode] = useState(false);
    const [dragging, setDragging] = useState(false);
    const [dropMode, setDropMode] = useState('append');
    const [imageDrag, setImageDrag] = useState(false);
    const [localImageRequest, setLocalImageRequest] = useState(null);
    const containerRef = useRef(null);
    const mountedRef = useRef(true);
    const busyRef = useRef(false);
    const savingRef = useRef(false);
    const collectingRef = useRef(false);
    const choosingAddModeRef = useRef(false);
    const processingRequestsRef = useRef(false);
    const fileRequestRef = useRef(0);
    const pendingRequestsRef = useRef([]);
    const lastOpenRequestRef = useRef(null);
    const imageDropAvailableRef = useRef(false);
    const imageDropRequestRef = useRef(0);

    const handleImageDropAvailabilityChange = useCallback(available => {
        imageDropAvailableRef.current = available;
    }, []);

    const handleBusyChange = useCallback(value => {
        busyRef.current = value;
        setBusy(value);
        if (value) setDragging(false);
    }, []);

    useEffect(() => {
        mountedRef.current = true;
        const beforeUnload = event => {
            if (!savingRef.current) return;
            event.preventDefault();
            event.returnValue = '';
        };
        window.addEventListener('beforeunload', beforeUnload);
        return () => {
            mountedRef.current = false;
            fileRequestRef.current += 1;
            window.removeEventListener('beforeunload', beforeUnload);
            emitToolbarState('tools', { ...createToolbarState(), fileActionsEnabled: false });
        };
    }, []);

    useEffect(() => {
        emitToolbarState('tools', {
            ...createToolbarState(files),
            fileActionsEnabled: true,
            fileActionsBusy: busy || collecting || choosingAddMode,
        });
    }, [files, busy, collecting, choosingAddMode]);

    useEffect(() => registerBeforeLeave?.(() => !savingRef.current && !busyRef.current && !choosingAddModeRef.current), [registerBeforeLeave]);

    const addPaths = useCallback((paths, mode = 'append') => {
        const normalized = normalizeDroppedPaths(paths);
        const supported = normalized.filter(path => supportsCoverEditor(fileFromPath(path)));
        const skipped = normalized.length - supported.length;
        if (skipped) showToast?.({ key: 'cover_editor_tool_unsupported', values: [skipped] });
        if (!supported.length) return;
        fileRequestRef.current += 1;
        setFiles(current => {
            const merged = normalizeDroppedPaths([...(mode === 'replace' ? [] : current.map(file => file.path)), ...supported]);
            if (merged.length === current.length && merged.every((path, index) => current[index].path === path)) return current;
            const previousFiles = new Map(current.map(file => [file.path, file]));
            return merged.map(path => previousFiles.get(path) || fileFromPath(path));
        });
        return true;
    }, [showToast]);

    useEffect(() => {
        if (openRequest && openRequest !== lastOpenRequestRef.current) {
            lastOpenRequestRef.current = openRequest;
            pendingRequestsRef.current.push({ ...openRequest });
        }
        if (busy || busyRef.current || savingRef.current || processingRequestsRef.current) return;
        processingRequestsRef.current = true;
        const processRequests = async () => {
            let hasFiles = files.length > 0;
            try {
                while (mountedRef.current && pendingRequestsRef.current.length && !busyRef.current && !savingRef.current) {
                    const request = pendingRequestsRef.current[0];
                    if (request.source === 'folder' && collectingRef.current) break;
                    if (request.source === 'folder' && !request.addModeResolved && hasFiles
                        && normalizeDroppedPaths(request.paths || []).some(path => supportsCoverEditor(fileFromPath(path)))) {
                        const requestId = ++fileRequestRef.current;
                        choosingAddModeRef.current = true;
                        setChoosingAddMode(true);
                        let choice;
                        try {
                            choice = await window.electronAPI?.showMessage?.({
                                type: 'question',
                                title: t('dialog_add_mode_title'),
                                message: t('cover_editor_tool_existing_files'),
                                buttons: 'append-replace-cancel',
                                defaultChoice: 'append',
                                language: config?.language || config?.lang || 'ko',
                            });
                        } catch (error) {
                            if (mountedRef.current) showToast?.({ key: 'cover_editor_tool_add_failed', values: [error.message] });
                        } finally {
                            choosingAddModeRef.current = false;
                            if (mountedRef.current) setChoosingAddMode(false);
                        }
                        if (!mountedRef.current) return;
                        if (requestId !== fileRequestRef.current || !['append', 'replace'].includes(choice)) {
                            pendingRequestsRef.current.shift();
                            continue;
                        }
                        request.mode = choice;
                        request.addModeResolved = true;
                        if (busyRef.current || savingRef.current) break;
                    }
                    pendingRequestsRef.current.shift();
                    if (addPaths(request.paths || [], request.mode)) hasFiles = true;
                }
            } finally {
                processingRequestsRef.current = false;
            }
        };
        void processRequests();
    }, [openRequest, busy, collecting, choosingAddMode, files.length, addPaths, config?.language, config?.lang, showToast, t]);

    const addFiles = useCallback(async () => {
        if (busyRef.current || savingRef.current || collectingRef.current || choosingAddModeRef.current) return;
        const request = ++fileRequestRef.current;
        try {
            const paths = await window.electronAPI.selectFiles(t('cover_editor_tool_add_files'), [{ name: t('cover_editor_title'), extensions: supportedExtensions }]);
            if (!mountedRef.current || request !== fileRequestRef.current || busyRef.current || savingRef.current || choosingAddModeRef.current) return;
            addPaths(paths || []);
        } catch (error) {
            if (mountedRef.current && request === fileRequestRef.current) showToast?.({ key: 'cover_editor_tool_add_failed', values: [error.message] });
        }
    }, [addPaths, showToast, t]);

    const addFolder = useCallback(async () => {
        if (busyRef.current || savingRef.current || collectingRef.current || choosingAddModeRef.current) return;
        const request = ++fileRequestRef.current;
        const cancelled = () => !mountedRef.current || request !== fileRequestRef.current || busyRef.current || savingRef.current;
        collectingRef.current = true;
        setCollecting(true);
        try {
            const folderPath = await window.electronAPI.selectFolder(t('add_folder'));
            if (!folderPath || cancelled()) return;
            const paths = await collectCoverEditorFolderPaths(folderPath, path => window.electronAPI.readDir(path), cancelled);
            if (!cancelled()) addPaths(paths);
        } catch (error) {
            if (!cancelled()) showToast?.({ key: 'cover_editor_tool_add_failed', values: [error.message] });
        } finally {
            collectingRef.current = false;
            if (mountedRef.current) setCollecting(false);
        }
    }, [addPaths, showToast, t]);

    const toggleFile = useCallback(path => {
        if (busyRef.current || savingRef.current || collectingRef.current || choosingAddModeRef.current) return;
        setFiles(current => current.map(file => file.path === path ? { ...file, checked: !file.checked } : file));
    }, []);

    const removeSelected = useCallback(() => {
        if (busyRef.current || savingRef.current || collectingRef.current || choosingAddModeRef.current) return;
        fileRequestRef.current += 1;
        setFiles(current => current.filter(file => !file.checked));
    }, []);

    const removeFile = useCallback(path => {
        if (busyRef.current || savingRef.current || collectingRef.current || choosingAddModeRef.current) return;
        fileRequestRef.current += 1;
        setFiles(current => current.filter(file => file.path !== path));
    }, []);

    const clearFiles = useCallback(() => {
        if (busyRef.current || savingRef.current || collectingRef.current || choosingAddModeRef.current) return;
        fileRequestRef.current += 1;
        setFiles([]);
    }, []);

    const toggleAll = useCallback(() => {
        if (busyRef.current || savingRef.current || collectingRef.current || choosingAddModeRef.current) return;
        setFiles(current => {
            const checked = !current.every(file => file.checked);
            return current.map(file => ({ ...file, checked }));
        });
    }, []);

    useEffect(() => {
        const handleAction = event => {
            if (event.detail?.activeTab !== 'tools') return;
            switch (event.detail.action) {
                case 'add-folder': void addFolder(); break;
                case 'add-file': void addFiles(); break;
                case 'remove-selected': removeSelected(); break;
                case 'clear-all': clearFiles(); break;
                case 'toggle-all': toggleAll(); break;
                default: break;
            }
        };
        window.addEventListener('bookmanager:action', handleAction);
        return () => window.removeEventListener('bookmanager:action', handleAction);
    }, [addFolder, addFiles, removeSelected, clearFiles, toggleAll]);

    const savePreferences = updates => {
        setPreferences(updates);
        void Promise.resolve().then(() => saveConfig?.({ folder_cover_editor_options: updates })).catch(error => {
            if (mountedRef.current) showToast?.({ key: 'config_save_failed', values: { msg: error.message } });
        });
    };

    const execute = async (request, batchOptions) => {
        if (savingRef.current || choosingAddModeRef.current) return { success: false, error: t('cover_editor_saving') };
        savingRef.current = true;
        fileRequestRef.current += 1;
        const apply = async item => {
            const saved = await window.electronAPI.applyCoverEditor(item);
            if (saved?.success) {
                try {
                    applyCoverReadingAdjustment(window.localStorage, saved.readingAdjustment);
                } catch (error) {
                    saved.readingWarning = [t('cover_editor_reading_save_failed'), error.message].filter(Boolean).join(' ');
                }
            }
            return saved;
        };
        try {
            const result = Array.isArray(request) ? await runCoverEditorBatch(request, apply, batchOptions) : await apply(request);
            const results = result?.batch ? result.results : [result];
            const paths = results.filter(value => value?.success && value.filePath).map(value => value.filePath);
            if (paths.length) window.dispatchEvent(new CustomEvent('bookmanager:metadata-saved', { detail: { paths } }));
            const completed = results.filter(value => value?.success).length;
            const cancelled = results.some(value => value?.cancelled);
            if (shouldPlayCompletionSound(config || {}, completed, cancelled)) {
                void Promise.resolve().then(() => window.electronAPI?.playSound?.(config?.completion_sound || 'Default.wav')).catch(() => {});
            }
            return result;
        } finally {
            savingRef.current = false;
        }
    };

    const back = () => {
        if (busyRef.current || savingRef.current || choosingAddModeRef.current) return;
        fileRequestRef.current += 1;
        onBack?.();
    };

    const reset = () => {
        if (busyRef.current || savingRef.current || choosingAddModeRef.current) return;
        fileRequestRef.current += 1;
        setLocalImageRequest(null);
        setSession(value => value + 1);
    };

    const dragOver = event => {
        if (!isFilePathDrag(event.dataTransfer) && !isCoverImageTransfer(event.dataTransfer)) return;
        event.preventDefault();
        event.stopPropagation();
        const imageOnly = isImageDrag(event.dataTransfer);
        const blocked = busyRef.current || savingRef.current || collectingRef.current || choosingAddModeRef.current || (imageOnly && !imageDropAvailableRef.current);
        event.dataTransfer.dropEffect = blocked ? 'none' : 'copy';
        setImageDrag(imageOnly);
        setDropMode(resolveFileDropMode(event.clientY, event.currentTarget.getBoundingClientRect?.()));
        setDragging(!blocked);
    };

    const receiveImageTransfer = useCallback(transfer => {
        if (!transfer) return;
        if (transfer.errorKey) showToast?.({ key: transfer.errorKey });
        else setLocalImageRequest({ id: ++imageDropRequestRef.current, ...transfer });
    }, [showToast]);

    const paste = useCallback(event => {
        const activeElement = typeof document !== 'undefined' ? document.activeElement : null;
        if (event.defaultPrevented || isTextEntryTarget(event.target) || isTextEntryTarget(activeElement)
            || event.target?.closest?.('[aria-modal="true"], dialog[open]')
            || activeElement?.closest?.('[aria-modal="true"], dialog[open]')
            || busyRef.current || savingRef.current || collectingRef.current || choosingAddModeRef.current || !imageDropAvailableRef.current) return;
        let transfer = extractCoverImageTransfer(event.clipboardData);
        if (!transfer && window.electronAPI?.previewCoverEditorClipboardImage
            && !Array.from(event.clipboardData?.types || []).some(type => type.startsWith('text/'))) {
            transfer = { clipboard: true };
        }
        if (!transfer) return;
        event.preventDefault();
        event.stopPropagation();
        receiveImageTransfer(transfer);
    }, [receiveImageTransfer]);

    useEffect(() => {
        const handlePaste = event => {
            const container = containerRef.current;
            if (!container || container.closest('[hidden], [inert]')) return;
            paste(event);
        };
        window.addEventListener('paste', handlePaste);
        return () => window.removeEventListener('paste', handlePaste);
    }, [paste]);

    const drop = async event => {
        if (!isFilePathDrag(event.dataTransfer) && !isCoverImageTransfer(event.dataTransfer)) return;
        event.preventDefault();
        event.stopPropagation();
        setDragging(false);
        if (busyRef.current || savingRef.current || collectingRef.current || choosingAddModeRef.current) return;
        const paths = droppedPathsFromDataTransfer(event.dataTransfer);
        if (!paths.length) {
            if (imageDropAvailableRef.current) receiveImageTransfer(extractCoverImageTransfer(event.dataTransfer));
            return;
        }
        const mode = resolveFileDropMode(event.clientY, event.currentTarget.getBoundingClientRect?.());
        const allowImage = imageDropAvailableRef.current;
        const imageFallback = allowImage && paths.length === 1
            && (isCoverImagePath(paths[0]) || isCoverImageTransfer(event.dataTransfer))
            ? extractCoverImageTransfer(event.dataTransfer) : null;
        const request = ++fileRequestRef.current;
        const cancelled = () => !mountedRef.current || request !== fileRequestRef.current || busyRef.current || savingRef.current;
        collectingRef.current = true;
        setCollecting(true);
        try {
            const books = [];
            const images = [];
            let skipped = 0;
            for (const path of paths) {
                const stat = await window.electronAPI.stat(path);
                if (cancelled()) return;
                if (stat?.isDirectory) {
                    books.push(...await collectCoverEditorFolderPaths(path, directory => window.electronAPI.readDir(directory), cancelled));
                } else if (stat?.isFile && isCoverImagePath(path)) {
                    images.push(path);
                } else if (stat?.isFile && supportsCoverEditor(fileFromPath(path))) {
                    books.push(path);
                } else if (imageFallback) {
                    receiveImageTransfer(imageFallback);
                    return;
                } else {
                    skipped += 1;
                }
                if (cancelled()) return;
            }
            if (skipped) showToast?.({ key: 'cover_editor_tool_unsupported', values: [skipped] });
            if (images.length > 1) showToast?.({ key: 'cover_editor_drop_one' });
            const nextPaths = normalizeDroppedPaths([...(mode === 'replace' ? [] : files.map(file => file.path)), ...books]);
            const changesFiles = books.length > 0 && (nextPaths.length !== files.length || nextPaths.some((path, index) => path !== files[index]?.path));
            if (books.length) addPaths(books, mode);
            if (images.length === 1 && (allowImage || changesFiles)) {
                setLocalImageRequest({ id: ++imageDropRequestRef.current, path: images[0] });
            }
        } catch (error) {
            if (!cancelled()) {
                if (imageFallback) receiveImageTransfer(imageFallback);
                else showToast?.({ key: 'cover_editor_tool_add_failed', values: [error.message] });
            }
        } finally {
            collectingRef.current = false;
            if (mountedRef.current) setCollecting(false);
        }
    };

    return <section ref={containerRef} className={`cover-editor-tool-container${dragging ? ' is-dragging' : ''}`}
        onPaste={paste}
        onDragEnter={dragOver} onDragOver={dragOver} onDrop={drop}
        onDragEnd={() => setDragging(false)}
        onDragLeave={event => { if (!event.currentTarget.contains(event.relatedTarget)) setDragging(false); }}>
        <CoverEditorDialog key={session} embedded files={files} externalBusy={collecting} apiKeys={config?.api_keys || {}}
            preferences={preferences || config?.folder_cover_editor_options} onPreferencesChange={savePreferences}
            onExecute={execute} onClose={back} showToast={showToast} t={t}
            onToggleFile={toggleFile} onToggleAll={toggleAll} onRemoveFile={removeFile}
            localImageRequest={localImageRequest} onImageDropAvailabilityChange={handleImageDropAvailabilityChange}
            onBusyChange={handleBusyChange} onReset={reset} />
        {dragging && <FileDropHoverOverlay imageDrop={imageDrag} dropMode={dropMode} t={t} />}
    </section>;
}
