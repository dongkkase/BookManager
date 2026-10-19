import React, { useEffect, useRef, useState } from 'react';
import { FaIcon } from '../FaIcon';
import { SmoothCoverImage } from '../SmoothCoverImage';
import { ResultLogDialog } from '../ResultLogDialog';
import noImage from '../../images/noimage.png';
import workingAnimation from '../../images/rainbow cat remix.gif';
import { DRAG_DROP_IMAGES, selectRandomResource } from '../../resourcePolicy';
import { createCoverEditorResultLog } from '../../coverEditorResultLog';
import { isTextEntryTarget } from '../../interactionPolicy';
import { coverEditorSearchTitle } from '../../coverEditorSearchTitle';
import { coverEditorMetadataCoverUrl, coverEditorMetadataThumbnail, searchCoverEditorMetadata, upgradeCoverEditorMetadataThumbnails } from '../../coverEditorMetadataSearch';
import { metadataSearchResultKey } from '../../metadataSearch';
import { ALL_METADATA_API_SOURCES, UNIFIED_METADATA_API_SOURCE, apiSourceHasRequiredKey, metadataSearchSourcesForBookType } from '../../metadataApiPolicy';
import { attachCoverEditorSearchScroll } from '../../coverEditorSearchScroll';
import { animateCoverEditorImageArrival } from '../../coverEditorImageArrival';
import { useReducedMotion } from '../../hooks/useReducedMotion';
import { emitStatusState } from '../../statusState';
import '../../styles/RenamerTab.css';
import '../../styles/CoverEditorDialog.css';

const CoverImageEditorDialog = React.lazy(() => import('../../features/fileTools/coverEditor/CoverImageEditorDialog'));

const COVER_HELP_FORMATS = [
    { formats: 'ZIP · CBZ · 7Z · CB7', storage: 'file', description: 'storage_comic' },
    { formats: 'EPUB', storage: 'file', description: 'storage_epub' },
    { formats: 'RAR · CBR', storage: 'copy', description: 'conversion' },
    { formats: 'MP3 · M4A · M4B · FLAC · AAC · AIF · AIFF · OGG · OGA · OPUS · WAV · WAVE', storage: 'file', description: 'storage_audio' },
    { formats: 'TXT', storage: 'local', description: 'storage_text' },
    { formats: 'PDF', storage: 'local', description: 'storage_pdf' },
    { formats: '3GP · AMR · CAF · WEBM', storage: 'local', description: 'storage_audio_local' },
];
const ARCHIVE_PAGE_SIZE = 40;
const ARCHIVE_THUMBNAIL_BATCH_SIZE = 8;
const EMPTY_METADATA_SEARCH = { query: '', page: 1, results: [], hasNext: false, failures: [], searched: false, failed: false };
const COVER_IMAGE_ERROR_KEYS = {
    COVER_IMAGE_INVALID: 'cover_editor_invalid_image',
    COVER_IMAGE_TOO_MANY_PIXELS: 'cover_editor_image_too_many_pixels',
    COVER_IMAGE_TOO_LARGE: 'cover_editor_image_too_large',
    COVER_IMAGE_UNSUPPORTED_FORMAT: 'cover_editor_image_unsupported_format',
    COVER_IMAGE_CONVERSION_FAILED: 'cover_editor_image_conversion_failed',
    COVER_IMAGE_IMPORT_FAILED: 'cover_editor_image_import_failed',
    COVER_SOURCE_CHANGED: 'cover_editor_source_changed',
    IMAGE_SOURCE_CHANGED: 'cover_editor_image_changed',
    COVER_METADATA_IMAGE_UNAVAILABLE: 'cover_editor_metadata_image_unavailable',
};
const metadataResultTitle = result => typeof result.title === 'string' ? result.title
    : result.title?.native || result.title?.english || result.title?.romaji || result.metadata?.Title || result.metadata?.Series || '';
const hasResultWarning = result => Boolean(result?.warning || result?.readingWarning || result?.readingAdjustmentUncertain);

function restoreCoverEditorOptions(preferences, info) {
    return {
        mode: ['replace', 'add'].includes(preferences?.mode) ? preferences.mode : info?.canAdd && !info.coverDataUrl ? 'add' : 'replace',
        renumber: typeof preferences?.renumber === 'boolean' ? preferences.renumber : Boolean(info?.canRenumber && !info.coverDataUrl),
        backup: typeof preferences?.backup === 'boolean' ? preferences.backup : true,
        coverScope: preferences?.coverScope === 'individual' ? 'individual' : 'group',
        apiSource: ALL_METADATA_API_SOURCES.some(source => source.value === preferences?.apiSource)
            ? preferences.apiSource : UNIFIED_METADATA_API_SOURCE,
    };
}

export function CoverEditorDialog({ file, files, apiKeys = {}, metadataApiEnabled, preferences, onPreferencesChange, onExecute, onClose, showToast, t,
    embedded = false, externalBusy = false, localImageRequest, onImageDropAvailabilityChange, onToggleFile, onToggleAll, onRemoveFile, onBusyChange, onReset }) {
    const reducedMotion = useReducedMotion();
    const targets = (files?.length ? files : [file]).filter(Boolean);
    const fileKey = JSON.stringify(targets.map(target => target.full_path || target.path));
    const isBatch = targets.length > 1;
    const dragDropImage = React.useMemo(() => selectRandomResource(DRAG_DROP_IMAGES), []);
    const [entries, setEntries] = useState([]);
    const [selectedIndex, setSelectedIndex] = useState(0);
    const [inspectedCount, setInspectedCount] = useState(0);
    const [currentCover, setCurrentCover] = useState({ filePath: '', dataUrl: '' });
    const [coverLoading, setCoverLoading] = useState(false);
    const [coverError, setCoverError] = useState('');
    const [images, setImages] = useState({ group: null, files: {} });
    const imagesRef = useRef(images);
    const [imageEditTarget, setImageEditTarget] = useState(null);
    const imageEditTargetRef = useRef(null);
    const imageEditButtonRef = useRef(null);
    const wasImageEditingRef = useRef(false);
    const [imageArrival, setImageArrival] = useState(null);
    const [arrivalHighlight, setArrivalHighlight] = useState(0);
    const [imageSource, setImageSource] = useState('local');
    const [searchQuery, setSearchQuery] = useState('');
    const [metadataSearch, setMetadataSearch] = useState(EMPTY_METADATA_SEARCH);
    const [metadataLoading, setMetadataLoading] = useState(false);
    const [archiveImages, setArchiveImages] = useState({ entries: [], total: 0, offset: 0 });
    const [archiveLoading, setArchiveLoading] = useState(false);
    const [archiveError, setArchiveError] = useState('');
    const [options, setOptions] = useState(() => restoreCoverEditorOptions(preferences));
    const optionsRef = useRef(options);
    const optionsInitializedRef = useRef(false);
    const { renumber, backup } = options;
    const [loading, setLoading] = useState(true);
    const [imageLoading, setImageLoading] = useState(false);
    const [saving, setSaving] = useState(false);
    const [dragging, setDragging] = useState(false);
    const [error, setError] = useState('');
    const [result, setResult] = useState(null);
    const [progress, setProgress] = useState(null);
    const [fileResults, setFileResults] = useState({});
    const [batchOpen, setBatchOpen] = useState(false);
    const [expandedFiles, setExpandedFiles] = useState({});
    const [resultDetailsOpen, setResultDetailsOpen] = useState(false);
    const [resultLog, setResultLog] = useState(null);
    const [resultLogOpen, setResultLogOpen] = useState(false);
    const [cancelRequested, setCancelRequested] = useState(false);
    const [helpOpen, setHelpOpen] = useState(false);
    const [filenamePreviewPath, setFilenamePreviewPath] = useState('');
    const dialogRef = useRef(null);
    const localSourceRef = useRef(null);
    const candidateRef = useRef(null);
    const helpDialogRef = useRef(null);
    const helpButtonRef = useRef(null);
    const filenameDialogRef = useRef(null);
    const filenameButtonRef = useRef(null);
    const searchInputRef = useRef(null);
    const metadataResultsRef = useRef(null);
    const batchRef = useRef(null);
    const batchSummaryRef = useRef(null);
    const resultDetailsRef = useRef(null);
    const resultLinkRef = useRef(null);
    const fileTableRef = useRef(null);
    const fileRowRefs = useRef(new Map());
    const imageRequestRef = useRef(0);
    const imageRef = useRef(null);
    const archiveRequestRef = useRef(0);
    const metadataRequestRef = useRef(0);
    const coverRequestRef = useRef(0);
    const selectedPathRef = useRef('');
    const inspectedFileKeyRef = useRef('');
    const lastLocalImageRequestRef = useRef(null);
    const mountedRef = useRef(true);
    const savingRef = useRef(false);
    const cancelRef = useRef(false);
    const completedResultsRef = useRef({});
    const internalBusy = loading || saving || resultLogOpen || helpOpen || Boolean(filenamePreviewPath) || Boolean(imageEditTarget);
    const busy = internalBusy || externalBusy;
    const inspectingFiles = loading && targets.length > 0;
    const loadingFiles = externalBusy || inspectingFiles;
    const processing = saving || loadingFiles;
    const titleId = React.useId();
    const selectedEntry = entries[selectedIndex];
    const info = selectedEntry?.info && {
        ...selectedEntry.info,
        coverDataUrl: currentCover.filePath === selectedEntry.filePath ? currentCover.dataUrl : '',
    };
    const filePath = selectedEntry?.filePath || targets[0]?.full_path || targets[0]?.path || '';
    const individualCovers = options.coverScope === 'individual';
    const imageForFile = path => individualCovers ? images.files[path] || null : images.group;
    const image = imageForFile(filePath);
    imageRef.current = image;
    const bookType = ['comic', 'pdf', 'audio'].includes(info?.kind) ? info.kind : 'book';
    const metadataApiEnabledKey = ALL_METADATA_API_SOURCES.map(source => metadataApiEnabled?.[source.value] !== false).join(',');
    const searchApiSources = metadataSearchSourcesForBookType(bookType, metadataApiEnabled);
    const searchApiSource = searchApiSources.some(source => source.value === options.apiSource)
        ? options.apiSource : UNIFIED_METADATA_API_SOURCE;
    const checkedPaths = new Set(targets.filter(target => !embedded || target.checked !== false).map(target => target.full_path || target.path));
    const allFilesChecked = targets.length > 0 && checkedPaths.size === targets.length;
    const readyEntries = entries.filter(entry => entry.info && checkedPaths.has(entry.filePath));
    const missingCoverCount = readyEntries.filter(entry => !imageForFile(entry.filePath)).length;
    const isBatchSave = embedded ? readyEntries.length > 1 : isBatch;
    const canAdd = readyEntries.length > 0 && readyEntries.every(entry => entry.info.canAdd);
    const emptySelection = embedded && !readyEntries.length;
    const mode = canAdd || emptySelection ? options.mode : 'replace';
    const canRenumber = readyEntries.some(entry => entry.info.canRenumber);
    const canBackup = readyEntries.some(entry => entry.info.storage === 'file' && !entry.info.conversion);
    const inspectionFailureCount = entries.filter(entry => entry.error).length;
    const storageText = value => t(value.conversion ? 'cover_editor_conversion'
        : `cover_editor_storage_${value.kind === 'audio' && value.storage === 'database' ? 'audio_local' : value.kind}`);
    const resultError = value => value?.code === 'COVER_SOURCE_CHANGED'
        ? t('cover_editor_source_changed') : value?.code === 'IMAGE_SOURCE_CHANGED'
            ? t('cover_editor_image_changed') : value?.code === 'COVER_VIEWER_OPEN'
                ? t('cover_editor_viewer_open') : value?.code === 'COVER_METADATA_IMAGE_UNAVAILABLE'
                    ? t('cover_editor_metadata_image_unavailable') : value?.error || t('cover_editor_failed');

    const changeOptions = updates => {
        optionsInitializedRef.current = true;
        const nextOptions = { ...optionsRef.current, ...updates };
        optionsRef.current = nextOptions;
        setOptions(nextOptions);
        onPreferencesChange?.(nextOptions);
    };

    const changeCoverScope = coverScope => {
        if (busy || result || coverScope === options.coverScope) return;
        imageRequestRef.current += 1;
        setImageArrival(null);
        setArrivalHighlight(0);
        setImageLoading(false);
        changeOptions({ coverScope });
        imageRef.current = coverScope === 'individual' ? imagesRef.current.files[selectedPathRef.current] || null : imagesRef.current.group;
    };

    useEffect(() => attachCoverEditorSearchScroll(metadataResultsRef.current), [imageSource, metadataLoading, metadataSearch.results]);

    useEffect(() => {
        metadataRequestRef.current += 1;
        setMetadataLoading(false);
        setMetadataSearch(EMPTY_METADATA_SEARCH);
    }, [metadataApiEnabledKey]);

    useEffect(() => {
        if (metadataApiEnabled?.[options.apiSource] !== false) return;
        const nextOptions = { ...optionsRef.current, apiSource: searchApiSource };
        optionsRef.current = nextOptions;
        setOptions(nextOptions);
        onPreferencesChange?.(nextOptions);
    }, [metadataApiEnabledKey, options.apiSource, searchApiSource]);

    useEffect(() => {
        if (!imageArrival) return;
        if (imageArrival.id !== imageRequestRef.current || busy || result || imageSource !== 'local') {
            setImageArrival(null);
            return;
        }
        let cancelled = false;
        const cancel = animateCoverEditorImageArrival({
            sourceElement: localSourceRef.current,
            targetElement: candidateRef.current,
            container: dialogRef.current,
            image: imageArrival.image,
            onFinish: () => {
                if (cancelled || !mountedRef.current || imageRequestRef.current !== imageArrival.id) return;
                setImageArrival(current => current?.id === imageArrival.id ? null : current);
                setArrivalHighlight(imageArrival.id);
            },
        });
        return () => { cancelled = true; cancel(); };
    }, [imageArrival, busy, result, imageSource]);

    useEffect(() => {
        mountedRef.current = true;
        const previousFocus = document.activeElement;
        const keepFocusInside = event => {
            if (imageEditTargetRef.current) return;
            const dialog = filenameDialogRef.current || helpDialogRef.current || (!embedded && dialogRef.current);
            if (dialog && !dialog.contains(event.target)) {
                event.stopPropagation();
                dialog.focus();
            }
        };
        document.addEventListener('focusin', keepFocusInside, true);
        if (!embedded) dialogRef.current?.focus();
        return () => {
            mountedRef.current = false;
            imageRequestRef.current += 1;
            archiveRequestRef.current += 1;
            metadataRequestRef.current += 1;
            coverRequestRef.current += 1;
            void window.electronAPI.releaseCoverEditorImages?.()?.catch?.(() => {});
            document.removeEventListener('focusin', keepFocusInside, true);
            if (!embedded) previousFocus?.focus?.();
        };
    }, [embedded]);

    useEffect(() => {
        onBusyChange?.(internalBusy);
    }, [internalBusy, onBusyChange]);

    useEffect(() => {
        if (!imageEditTarget && wasImageEditingRef.current) imageEditButtonRef.current?.focus();
        wasImageEditingRef.current = Boolean(imageEditTarget);
    }, [imageEditTarget]);

    useEffect(() => {
        onImageDropAvailabilityChange?.(!busy && !result && !helpOpen && (!individualCovers || Boolean(filePath)));
    }, [busy, result, helpOpen, individualCovers, filePath, onImageDropAvailabilityChange]);

    useEffect(() => {
        let cancelled = false;
        inspectedFileKeyRef.current = '';
        const load = async () => {
            setImageArrival(null);
            setArrivalHighlight(0);
            const nextEntries = targets.map(target => ({
                filePath: target.full_path || target.path,
                name: target.name || target.full_path || target.path,
                info: null,
                error: '',
            }));
            const nextSelectedIndex = embedded ? Math.max(0, nextEntries.findIndex(entry => entry.filePath === selectedPathRef.current)) : 0;
            const previousPath = selectedPathRef.current;
            setEntries(nextEntries);
            setSelectedIndex(nextSelectedIndex);
            selectedPathRef.current = nextEntries[nextSelectedIndex]?.filePath || '';
            setCurrentCover({ filePath: '', dataUrl: '' });
            if (!embedded) {
                imageRef.current = null;
                imagesRef.current = { group: null, files: {} };
                setImages(imagesRef.current);
                setImageSource('local');
            } else {
                const targetPaths = new Set(nextEntries.map(entry => entry.filePath));
                updateImages({ ...imagesRef.current, files: Object.fromEntries(
                    Object.entries(imagesRef.current.files).filter(([path]) => targetPaths.has(path)),
                ) });
            }
            if (!embedded || previousPath !== selectedPathRef.current) {
                setSearchQuery(coverEditorSearchTitle(nextEntries[nextSelectedIndex]?.name));
                setMetadataSearch(EMPTY_METADATA_SEARCH);
                setMetadataLoading(false);
                metadataRequestRef.current += 1;
            }
            setImageLoading(false);
            setArchiveImages({ entries: [], total: 0, offset: 0 });
            setArchiveError('');
            setArchiveLoading(false);
            setError('');
            setResult(null);
            setFileResults({});
            setBatchOpen(false);
            setExpandedFiles({});
            setResultDetailsOpen(false);
            setResultLog(null);
            setResultLogOpen(false);
            setFilenamePreviewPath('');
            setCoverError('');
            setInspectedCount(0);
            setLoading(true);
            if (!embedded) {
                optionsRef.current = restoreCoverEditorOptions(preferences);
                setOptions(optionsRef.current);
            }
            for (let index = 0; index < nextEntries.length; index += 1) {
                if (cancelled) return;
                try {
                    const value = await window.electronAPI.inspectCoverEditor(nextEntries[index].filePath);
                    if (cancelled) return;
                    if (!value || value.error) throw new Error(value?.error || t('cover_editor_failed'));
                    nextEntries[index] = { ...nextEntries[index], info: { ...value, coverDataUrl: '' } };
                    if (selectedPathRef.current === nextEntries[index].filePath) {
                        setCurrentCover({ filePath: nextEntries[index].filePath, dataUrl: value.coverDataUrl || '' });
                    }
                    if (!isBatch && (!embedded || !optionsInitializedRef.current)) {
                        optionsRef.current = restoreCoverEditorOptions(preferences, value);
                        setOptions(optionsRef.current);
                    }
                    optionsInitializedRef.current = true;
                } catch (error) {
                    if (cancelled) return;
                    nextEntries[index] = { ...nextEntries[index], error: error.message };
                    if (!isBatch) setError(error.message);
                }
                setEntries([...nextEntries]);
                setInspectedCount(index + 1);
            }
            if (!cancelled) {
                inspectedFileKeyRef.current = fileKey;
                setLoading(false);
            }
        };
        void load();
        return () => {
            cancelled = true;
            imageRequestRef.current += 1;
            archiveRequestRef.current += 1;
            coverRequestRef.current += 1;
            if (!embedded && mountedRef.current) void window.electronAPI.releaseCoverEditorImages?.()?.catch?.(() => {});
        };
    }, [fileKey, embedded]);

    useEffect(() => {
        const dialog = filenameDialogRef.current || helpDialogRef.current || (!embedded && dialogRef.current);
        if (dialog && !dialog.contains(document.activeElement)) dialog.focus();
    }, [saving, result, embedded]);

    useEffect(() => {
        if (!helpOpen) return;
        helpDialogRef.current?.focus();
        return () => helpButtonRef.current?.focus();
    }, [helpOpen]);

    useEffect(() => {
        if (!filenamePreviewPath) return;
        filenameDialogRef.current?.focus();
        return () => filenameButtonRef.current?.focus();
    }, [filenamePreviewPath]);

    useEffect(() => {
        if (resultDetailsOpen) resultDetailsRef.current?.focus();
    }, [resultDetailsOpen]);

    useEffect(() => {
        if (embedded && resultLog && !resultLogOpen) resultLinkRef.current?.focus();
    }, [resultLogOpen]);

    useEffect(() => {
        if (imageSource === 'archive' && info?.canSelectArchiveImage) void loadArchiveImages(0);
        return () => { archiveRequestRef.current += 1; };
    }, [imageSource, filePath, info?.version, info?.canSelectArchiveImage]);

    const selectEntry = async (entry, index) => {
        if (busy) return;
        const requestId = ++coverRequestRef.current;
        if (selectedPathRef.current !== entry.filePath) {
            imageRequestRef.current += 1;
            setImageArrival(null);
            setArrivalHighlight(0);
            archiveRequestRef.current += 1;
            metadataRequestRef.current += 1;
            setImageLoading(false);
            setArchiveImages({ entries: [], total: 0, offset: 0 });
            setArchiveLoading(false);
            setArchiveError('');
            setError('');
            setSearchQuery(coverEditorSearchTitle(entry.name));
            setMetadataSearch(EMPTY_METADATA_SEARCH);
            setMetadataLoading(false);
        }
        selectedPathRef.current = entry.filePath;
        setSelectedIndex(index);
        setCurrentCover({ filePath: entry.filePath, dataUrl: '' });
        setCoverError('');
        setCoverLoading(Boolean(entry.info));
        if (!entry.info) return;
        try {
            const value = await window.electronAPI.inspectCoverEditor(entry.filePath);
            if (!value || value.error) throw new Error(value?.error || t('cover_editor_failed'));
            if (mountedRef.current && coverRequestRef.current === requestId) {
                setCurrentCover({ filePath: entry.filePath, dataUrl: value.coverDataUrl || '' });
            }
        } catch (error) {
            if (mountedRef.current && coverRequestRef.current === requestId) setCoverError(error.message);
        } finally {
            if (mountedRef.current && coverRequestRef.current === requestId) setCoverLoading(false);
        }
    };

    const handleFileTableKeyDown = event => {
        if (busy || !entries.length || event.defaultPrevented || isTextEntryTarget(event.target)) return;
        const nextIndex = event.key === 'ArrowDown' ? Math.min(entries.length - 1, selectedIndex + 1)
            : event.key === 'ArrowUp' ? Math.max(0, selectedIndex - 1)
                : event.key === 'Home' ? 0 : event.key === 'End' ? entries.length - 1 : -1;
        if (nextIndex < 0) return;
        event.preventDefault();
        if (nextIndex !== selectedIndex) void selectEntry(entries[nextIndex], nextIndex);
        fileRowRefs.current.get(entries[nextIndex].filePath)?.scrollIntoView?.({ block: 'nearest' });
    };

    const releaseImage = imagePath => {
        if (imagePath && ![imagesRef.current.group, ...Object.values(imagesRef.current.files)].some(value => value?.imagePath === imagePath)) {
            void window.electronAPI.releaseCoverEditorImages?.({ imagePath })?.catch?.(() => {});
        }
    };

    const updateImages = nextImages => {
        const previousImages = imagesRef.current;
        imagesRef.current = nextImages;
        setImages(nextImages);
        new Set([previousImages.group, ...Object.values(previousImages.files)].map(value => value?.imagePath)).forEach(releaseImage);
    };

    const updateImage = value => {
        const current = imagesRef.current;
        updateImages(optionsRef.current.coverScope === 'individual'
            ? { ...current, files: { ...current.files, [selectedPathRef.current]: value } }
            : { ...current, group: value });
        imageRef.current = value;
    };

    const clearImage = () => {
        imageRequestRef.current += 1;
        setImageArrival(null);
        setArrivalHighlight(0);
        setImageLoading(false);
        updateImage(null);
    };

    const openImageEditor = () => {
        if (busy || result || imageLoading || !imageRef.current) return;
        setImageArrival(null);
        imageEditTargetRef.current = imageRef.current;
        setImageEditTarget(imageRef.current);
    };

    const closeImageEditor = () => {
        imageEditTargetRef.current = null;
        setImageEditTarget(null);
    };

    const applyEditedImage = async blob => {
        const target = imageEditTarget;
        const isCurrent = () => mountedRef.current && target && imageEditTargetRef.current === target && imageRef.current === target;
        const closedError = () => Object.assign(new Error(), { code: 'IMAGE_EDIT_CLOSED' });
        if (!isCurrent()) throw closedError();
        if (blob.size > 16 * 1024 * 1024) throw Object.assign(new Error(), { code: 'COVER_IMAGE_TOO_LARGE' });
        const bytes = new Uint8Array(await blob.arrayBuffer());
        if (!isCurrent()) throw closedError();
        const value = await window.electronAPI.previewCoverEditorImportedImage({ bytes });
        if (!isCurrent()) {
            releaseImage(value?.imagePath);
            throw closedError();
        }
        if (value?.error || !value?.dataUrl || !value?.imagePath || !value?.imageVersion) {
            releaseImage(value?.imagePath);
            throw Object.assign(new Error(value?.error || ''), { code: value?.code || 'COVER_IMAGE_IMPORT_FAILED' });
        }
        imageRequestRef.current += 1;
        setImageArrival(null);
        setArrivalHighlight(0);
        updateImage({ ...target, ...value });
    };

    const loadChosenImage = async (resolveImage, sourceDetails = {}) => {
        if (savingRef.current || result || optionsRef.current.coverScope === 'individual' && !selectedPathRef.current) return;
        const requestId = ++imageRequestRef.current;
        setImageArrival(null);
        setArrivalHighlight(0);
        const isCurrent = () => mountedRef.current && imageRequestRef.current === requestId;
        setImageSource(sourceDetails.source);
        setImageLoading(true);
        setError('');
        try {
            const value = await resolveImage(isCurrent);
            if (!isCurrent()) {
                releaseImage(value?.imagePath);
                return;
            }
            if (value?.cancelled || value?.empty) return;
            if (value?.error || !value?.dataUrl) {
                throw Object.assign(new Error(value?.error || ''), {
                    code: value?.code || (value?.error ? '' : 'COVER_IMAGE_INVALID'),
                });
            }
            const selectedImage = { ...value, ...sourceDetails };
            if (sourceDetails.source === 'local') {
                setImageArrival({ id: requestId, image: selectedImage, previousImage: imageRef.current });
            }
            updateImage(selectedImage);
        } catch (error) {
            if (isCurrent()) showToast?.({ key: COVER_IMAGE_ERROR_KEYS[error?.code] || 'cover_editor_image_load_failed' });
        } finally {
            if (isCurrent()) setImageLoading(false);
        }
    };

    const chooseImage = imagePath => loadChosenImage(() => window.electronAPI.previewCoverEditorImage(imagePath), { source: 'local' });

    const chooseImportedImage = request => loadChosenImage(async isCurrent => {
        try {
            if (request.clipboard) return await window.electronAPI.previewCoverEditorClipboardImage();
            if (request.file) {
                if (request.file.size > 16 * 1024 * 1024) throw Object.assign(new Error(), { code: 'COVER_IMAGE_TOO_LARGE' });
                const bytes = new Uint8Array(await request.file.arrayBuffer());
                if (!isCurrent()) return { cancelled: true };
                if (bytes.byteLength > 16 * 1024 * 1024) throw Object.assign(new Error(), { code: 'COVER_IMAGE_TOO_LARGE' });
                return await window.electronAPI.previewCoverEditorImportedImage({ bytes });
            }
            return await window.electronAPI.previewCoverEditorImportedImage({ url: request.url });
        } catch (error) {
            throw Object.assign(new Error(error?.message || ''), {
                code: COVER_IMAGE_ERROR_KEYS[error?.code] ? error.code : 'COVER_IMAGE_IMPORT_FAILED',
            });
        }
    }, { source: 'local', sourceTitle: request.file?.name });

    const browseImage = () => loadChosenImage(async isCurrent => {
        const selected = await window.electronAPI.selectFile(t('cover_editor_select'), [{
            name: 'Images', extensions: ['jpg', 'jpeg', 'png', 'webp', 'gif', 'bmp'],
        }]);
        if (!selected || !isCurrent()) return { cancelled: true };
        return window.electronAPI.previewCoverEditorImage(selected);
    }, { source: 'local' });

    const changeImageSource = source => {
        if (source === imageSource) return;
        imageRequestRef.current += 1;
        setImageArrival(null);
        setArrivalHighlight(0);
        archiveRequestRef.current += 1;
        metadataRequestRef.current += 1;
        setImageLoading(false);
        setArchiveLoading(false);
        setMetadataLoading(false);
        if (metadataLoading) setMetadataSearch(current => ({ ...current, searched: false }));
        setDragging(false);
        setError('');
        setImageSource(source);
    };

    useEffect(() => {
        if (!embedded || localImageRequest?.id == null || !(localImageRequest.path || localImageRequest.file || localImageRequest.url || localImageRequest.clipboard)
            || lastLocalImageRequestRef.current === localImageRequest.id || inspectedFileKeyRef.current !== fileKey
            || busy || result || helpOpen) return;
        lastLocalImageRequestRef.current = localImageRequest.id;
        changeImageSource('local');
        if (localImageRequest.path) void chooseImage(localImageRequest.path);
        else void chooseImportedImage(localImageRequest);
    }, [embedded, localImageRequest?.id, localImageRequest?.path, localImageRequest?.file, localImageRequest?.url, localImageRequest?.clipboard, fileKey, busy, result, helpOpen]);

    const searchMetadataImages = event => {
        event.preventDefault();
        const query = searchQuery.trim();
        if (!query || busy || result) return;
        void loadMetadataResults(query, 1);
    };

    const resetMetadataSearch = () => {
        metadataRequestRef.current += 1;
        setSearchQuery('');
        setMetadataLoading(false);
        setMetadataSearch(EMPTY_METADATA_SEARCH);
        searchInputRef.current?.focus();
    };

    const changeSearchApiSource = apiSource => {
        if (busy || result || apiSource === searchApiSource) return;
        metadataRequestRef.current += 1;
        setMetadataLoading(false);
        setMetadataSearch(EMPTY_METADATA_SEARCH);
        changeOptions({ apiSource });
    };

    const loadMetadataResults = async (query, page) => {
        if (!query || busy || result) return;
        const requestId = ++metadataRequestRef.current;
        const isCurrent = () => mountedRef.current && metadataRequestRef.current === requestId;
        setSearchQuery(query);
        setMetadataLoading(true);
        setMetadataSearch({ ...EMPTY_METADATA_SEARCH, query, page, searched: true });
        setError('');
        try {
            if (!apiSourceHasRequiredKey(searchApiSource, apiKeys)) {
                setMetadataSearch(current => ({ ...current, failed: true }));
                showToast?.({ key: 'api_key_missing' });
                return;
            }
            const value = await searchCoverEditorMetadata({ query, page, bookType, apiKeys, metadataApiEnabled, apiSource: searchApiSource },
                request => window.electronAPI.fetchMetadata(request), { isCancelled: () => !isCurrent() });
            if (!isCurrent()) return;
            if (value?.cancelled) {
                setMetadataSearch(current => ({ ...current, searched: false }));
                return;
            }
            if (!value?.success || !Array.isArray(value.results)) {
                setMetadataSearch(current => ({ ...current, failed: true }));
                showToast?.(value?.code === 'API_DISABLED'
                    ? { key: 'api_provider_disabled', values: { api: searchApiSource } }
                    : { key: value?.code === 'NO_ENABLED_APIS' ? 'cover_editor_metadata_no_apis' : 'cover_editor_metadata_failed' });
                return;
            }
            setMetadataSearch({ ...value, query, page, searched: true, failed: false });
            void upgradeCoverEditorMetadataThumbnails(value.results, window.electronAPI.cacheMetadataRemoteCover, {
                isCancelled: () => !isCurrent(),
                onThumbnail: update => {
                    if (!isCurrent()) return;
                    setMetadataSearch(current => {
                        if (!isCurrent() || !current.results.some(item => metadataSearchResultKey(item) === update.resultKey
                            && coverEditorMetadataThumbnail(item) === update.fallback)) return current;
                        return {
                            ...current,
                            results: current.results.map(item => metadataSearchResultKey(item) === update.resultKey
                                ? { ...item, highQualityCoverCacheUrl: update.thumbnail } : item),
                            artwork: { ...current.artwork, [update.resultKey]: {
                                requestId, thumbnail: update.thumbnail, width: update.width, height: update.height, failed: false,
                            } },
                        };
                    });
                },
            }).catch(() => {});
            if (value.failures?.length) {
                showToast?.({ key: 'cover_editor_metadata_partial_failed', values: [value.failures.map(failure => failure.apiSource).join(', ')] });
            }
        } catch {
            if (isCurrent()) {
                setMetadataSearch(current => ({ ...current, failed: true }));
                showToast?.({ key: 'cover_editor_metadata_failed' });
            }
        } finally {
            if (isCurrent()) setMetadataLoading(false);
        }
    };

    const updateMetadataArtwork = (requestId, resultKey, thumbnail, element, failed = false) => {
        if (!mountedRef.current || metadataRequestRef.current !== requestId) return;
        const width = failed ? 0 : Number(element.naturalWidth) || 0;
        const height = failed ? 0 : Number(element.naturalHeight) || 0;
        setMetadataSearch(current => {
            if (!mountedRef.current || metadataRequestRef.current !== requestId) return current;
            const item = current.results.find(item => metadataSearchResultKey(item) === resultKey && coverEditorMetadataThumbnail(item) === thumbnail);
            if (!item) return current;
            if (failed && item.highQualityCoverCacheUrl === thumbnail) {
                return {
                    ...current,
                    results: current.results.map(result => result === item ? { ...result, highQualityCoverCacheUrl: '' } : result),
                    artwork: { ...current.artwork, [resultKey]: undefined },
                };
            }
            const previous = current.artwork?.[resultKey];
            if (previous?.requestId === requestId && previous.thumbnail === thumbnail && previous.width === width && previous.height === height && previous.failed === failed) return current;
            return { ...current, artwork: { ...current.artwork, [resultKey]: { requestId, thumbnail, width, height, failed } } };
        });
    };

    const chooseMetadataImage = selected => loadChosenImage(() => window.electronAPI.previewCoverEditorMetadataImage({
        imageUrl: selected.highQualityCoverCacheUrl || coverEditorMetadataCoverUrl(selected),
    }), { source: 'metadata', sourceTitle: metadataResultTitle(selected), resultKey: metadataSearchResultKey(selected) });

    const loadArchiveImages = async offset => {
        if (!info?.canSelectArchiveImage) return;
        const requestId = ++archiveRequestRef.current;
        setArchiveLoading(true);
        setArchiveError('');
        try {
            const value = await window.electronAPI.listCoverEditorArchiveImages({ filePath, version: info.version, offset, limit: ARCHIVE_PAGE_SIZE });
            if (!mountedRef.current || archiveRequestRef.current !== requestId) return;
            if (value?.error || !Array.isArray(value?.entries)) throw new Error(resultError(value));
            setArchiveImages({ ...value, entries: value.entries.map(entry => ({ ...entry, thumbnailLoading: true })) });
            setArchiveLoading(false);
            void loadArchiveThumbnails(value.entries, requestId);
        } catch (error) {
            if (mountedRef.current && archiveRequestRef.current === requestId) setArchiveError(error.message);
        } finally {
            if (mountedRef.current && archiveRequestRef.current === requestId) setArchiveLoading(false);
        }
    };

    const loadArchiveThumbnails = async (pageEntries, requestId) => {
        const isCurrent = () => mountedRef.current && archiveRequestRef.current === requestId && !savingRef.current;
        for (let offset = 0; offset < pageEntries.length; offset += ARCHIVE_THUMBNAIL_BATCH_SIZE) {
            if (!isCurrent()) return;
            const entryNames = pageEntries.slice(offset, offset + ARCHIVE_THUMBNAIL_BATCH_SIZE).map(entry => entry.name);
            let thumbnails = [];
            try {
                const value = await window.electronAPI.previewCoverEditorArchiveThumbnails({ filePath, version: info.version, entryNames });
                if (!isCurrent()) return;
                if (value?.cancelled) {
                    setArchiveImages(current => ({ ...current, entries: current.entries.map(entry => ({ ...entry, thumbnailLoading: false })) }));
                    return;
                }
                if (value?.code === 'COVER_SOURCE_CHANGED') {
                    setArchiveError(resultError(value));
                    return;
                }
                if (Array.isArray(value?.entries)) thumbnails = value.entries;
            } catch {
                thumbnails = [];
            }
            if (!isCurrent()) return;
            const byName = new Map(thumbnails.map(entry => [entry.name, entry]));
            setArchiveImages(current => ({ ...current, entries: current.entries.map(entry => entryNames.includes(entry.name)
                ? { ...entry, ...byName.get(entry.name), thumbnailLoading: false } : entry) }));
        }
    };

    const chooseArchiveImage = entryName => loadChosenImage(() => window.electronAPI.previewCoverEditorArchiveImage({
        filePath, version: info.version, entryName,
    }), { source: 'archive', sourceFilePath: filePath, entryName });

    const handleDrop = event => {
        event.preventDefault();
        event.stopPropagation();
        setDragging(false);
        if (busy || result) return;
        const files = Array.from(event.dataTransfer?.files || []);
        if (files.length !== 1 || !files[0].path) {
            showToast?.({ key: 'cover_editor_drop_one' });
            return;
        }
        void chooseImage(files[0].path);
    };

    const close = () => {
        if (filenamePreviewPath) {
            setFilenamePreviewPath('');
            return;
        }
        if (helpOpen) {
            setHelpOpen(false);
            return;
        }
        if (!savingRef.current) {
            mountedRef.current = false;
            imageRequestRef.current += 1;
            archiveRequestRef.current += 1;
            metadataRequestRef.current += 1;
            coverRequestRef.current += 1;
            onClose();
        }
    };

    const handleKeyDown = event => {
        if (imageEditTargetRef.current) return;
        if (embedded && !helpOpen && !filenamePreviewPath) return;
        event.stopPropagation();
        if (event.key === 'Escape') {
            event.preventDefault();
            close();
        }
        if (event.key !== 'Tab') return;
        const activeDialog = filenameDialogRef.current || helpDialogRef.current || dialogRef.current;
        const focusable = [...activeDialog.querySelectorAll('button:not(:disabled), input:not(:disabled), select:not(:disabled), summary, [tabindex="0"]')]
            .filter(element => !element.getClientRects || element.getClientRects().length > 0);
        const first = focusable[0];
        const last = focusable[focusable.length - 1];
        if (!first) {
            event.preventDefault();
            return;
        }
        if (event.shiftKey && (document.activeElement === first || document.activeElement === activeDialog)) {
            event.preventDefault();
            last.focus();
        } else if (!event.shiftKey && (document.activeElement === last || document.activeElement === activeDialog)) {
            event.preventDefault();
            first.focus();
        }
    };

    const save = async () => {
        if (!readyEntries.length || missingCoverCount || busy || imageLoading || result || savingRef.current) return;
        savingRef.current = true;
        cancelRef.current = false;
        completedResultsRef.current = {};
        const runCheckedPaths = new Set(checkedPaths);
        const showRunResult = outcomes => {
            if (!embedded) return;
            setResultLog(createCoverEditorResultLog({ entries, checkedPaths: runCheckedPaths,
                outcomes: Object.entries(outcomes).map(([sourcePath, outcome]) => ({ ...outcome, sourcePath })) }, t));
            setHelpOpen(false);
            setResultLogOpen(true);
        };
        if (embedded) {
            setFileResults({});
            setResultLog(null);
        }
        setCancelRequested(false);
        setSaving(true);
        setError('');
        const requests = readyEntries.map(entry => ({
            filePath: entry.info.filePath,
            version: entry.info.version,
            textContentHash: entry.info.textContentHash,
            targetEntry: entry.info.coverEntry,
            imagePath: imageForFile(entry.filePath).imagePath,
            imageVersion: imageForFile(entry.filePath).imageVersion,
            mode,
            renumber: Boolean(entry.info.canRenumber && renumber),
            backup,
        }));
        setProgress(isBatchSave ? { completed: 0, total: requests.length, currentFilePath: requests[0].filePath } : null);
        try {
            const saved = isBatchSave ? await onExecute(requests, {
                shouldCancel: () => cancelRef.current,
                onProgress: update => {
                    if (update.result) completedResultsRef.current[update.filePath] = update.result;
                    if (!mountedRef.current) return;
                    setProgress({ ...update, currentFilePath: requests[Math.min(update.completed, requests.length - 1)].filePath });
                    setFileResults({ ...completedResultsRef.current });
                },
            }) : await onExecute(requests[0]);
            if (isBatchSave) {
                if (!saved?.batch) throw new Error(saved?.error || t('cover_editor_failed'));
                if (mountedRef.current) {
                    const outcomes = { ...completedResultsRef.current };
                    saved.results.forEach((outcome, index) => {
                        const sourcePath = outcome.sourcePath || requests[index]?.filePath;
                        if (sourcePath) outcomes[sourcePath] = outcome;
                    });
                    setFileResults(outcomes);
                    setResult(saved);
                    showRunResult(outcomes);
                }
                return;
            }
            completedResultsRef.current[requests[0].filePath] = saved;
            if (!saved?.success) {
                throw new Error(resultError(saved));
            }
            if (mountedRef.current) {
                if (embedded) {
                    const outcomes = { [requests[0].filePath]: saved };
                    setFileResults(outcomes);
                    showRunResult(outcomes);
                }
                setResult(saved);
            }
        } catch (error) {
            if (mountedRef.current) {
                if (!embedded) setError(error.message);
                if (isBatchSave) {
                    const outcomes = requests.map(request => completedResultsRef.current[request.filePath]
                        || { filePath: request.filePath, success: false, error: error.message });
                    const resultsByPath = Object.fromEntries(requests.map((request, index) => [request.filePath, outcomes[index]]));
                    setFileResults(resultsByPath);
                    showRunResult(resultsByPath);
                    setResult({
                        batch: true,
                        results: outcomes,
                        successCount: outcomes.filter(outcome => outcome.success).length,
                        failureCount: outcomes.filter(outcome => !outcome.success && !outcome.cancelled).length,
                        cancelledCount: outcomes.filter(outcome => outcome.cancelled).length,
                    });
                } else if (embedded) {
                    const outcomes = { [requests[0].filePath]: { ...completedResultsRef.current[requests[0].filePath],
                        filePath: requests[0].filePath, success: false, error: error.message } };
                    setFileResults(outcomes);
                    showRunResult(outcomes);
                }
            }
        } finally {
            savingRef.current = false;
            if (mountedRef.current) setSaving(false);
        }
    };

    const cancelRemaining = React.useCallback(() => {
        if (!savingRef.current) return;
        cancelRef.current = true;
        setCancelRequested(true);
    }, []);

    const currentSavePath = saving ? progress?.currentFilePath || readyEntries[0]?.filePath || '' : '';
    const inspectingTarget = inspectingFiles ? targets[Math.min(inspectedCount, targets.length - 1)] : null;
    const currentProcessingPath = saving ? currentSavePath : inspectingTarget?.full_path || inspectingTarget?.path || '';
    useEffect(() => {
        if (!embedded) return;
        emitStatusState('tools', {
            phase: saving ? cancelRequested ? 'cancelling' : 'executing' : loadingFiles ? 'analyzing' : 'idle',
            message: saving ? cancelRequested ? t('cover_editor_batch_cancelling')
                : progress ? t('cover_editor_batch_progress', [progress.completed, progress.total]) : t('cover_editor_saving')
                : inspectingFiles ? t('cover_editor_batch_inspecting', [inspectedCount, targets.length])
                    : loadingFiles ? t('cover_editor_loading') : '',
            progress: saving ? progress ? progress.completed / progress.total * 100 : 0
                : inspectingFiles ? inspectedCount / targets.length * 100 : 0,
            currentItem: currentProcessingPath,
            currentItemName: currentProcessingPath.split(/[\\/]/).pop(),
            canCancel: saving && isBatchSave,
        });
    }, [embedded, saving, cancelRequested, progress, currentProcessingPath, isBatchSave, loadingFiles, inspectingFiles, inspectedCount, targets.length, t]);

    useEffect(() => {
        if (!embedded) return;
        const handleAction = event => {
            if (event.detail?.activeTab === 'tools' && event.detail.action === 'cancel-current' && isBatchSave) cancelRemaining();
        };
        window.addEventListener('bookmanager:action', handleAction);
        return () => window.removeEventListener('bookmanager:action', handleAction);
    }, [embedded, isBatchSave, cancelRemaining]);

    useEffect(() => {
        if (embedded) return () => emitStatusState('tools', {});
    }, [embedded]);

    const exportCurrentCover = async () => {
        try {
            await window.electronAPI.exportMetadataCover({ filePath, coverDataUrl: info.coverDataUrl, title: t('cover_editor_export') });
        } catch (error) {
            if (mountedRef.current) setError(error.message);
        }
    };

    const filenamePreviewEntry = entries.find(entry => entry.filePath === filenamePreviewPath);
    const filenamePreviewInfo = filenamePreviewEntry?.info;
    const filenamePreviewImage = imageForFile(filenamePreviewPath);
    const filenamePreviewPages = filenamePreviewInfo?.pages || [];
    const filenamePreviewCoverEntry = filenamePreviewInfo?.coverEntry || filenamePreviewPages[0]?.name;
    const numberWidth = Math.max(4, String((filenamePreviewInfo?.pageCount || 0) + (mode === 'add' ? 1 : 0)).length);
    const failureCount = inspectionFailureCount + Object.values(fileResults).filter(outcome => !outcome.success && !outcome.cancelled).length;
    const warningCount = embedded || isBatch ? Object.values(fileResults).filter(hasResultWarning).length : Number(hasResultWarning(result));
    const hasRunResult = Boolean(result) || embedded && Object.keys(fileResults).length > 0 && !saving;
    const loggedStats = embedded && hasRunResult ? resultLog?.stats : null;
    const footerFailureCount = loggedStats ? loggedStats.error.length : failureCount;
    const footerCancelledCount = loggedStats ? loggedStats.skip.length : result?.cancelledCount || 0;
    const resultCounts = loggedStats ? [
        t('cover_editor_count_saved', [loggedStats.success.length]),
        loggedStats.error.length > 0 && t('cover_editor_count_failed', [loggedStats.error.length]),
        loggedStats.skip.length > 0 && t('cover_editor_count_cancelled', [loggedStats.skip.length]),
        warningCount > 0 && t('cover_editor_count_warning', [warningCount]),
    ].filter(Boolean).join(' · ') : result?.batch ? [
        t('cover_editor_count_saved', [result.successCount]),
        result.failureCount + inspectionFailureCount > 0 && t('cover_editor_count_failed', [result.failureCount + inspectionFailureCount]),
        result.cancelledCount > 0 && t('cover_editor_count_cancelled', [result.cancelledCount]),
        warningCount > 0 && t('cover_editor_count_warning', [warningCount]),
    ].filter(Boolean).join(' · ') : '';
    const footerStatus = saving
        ? progress ? t('cover_editor_batch_progress', [progress.completed, progress.total]) : t('cover_editor_saving')
        : hasRunResult ? loggedStats || result?.batch ? resultCounts : [t('cover_editor_saved'), warningCount > 0 && t('cover_editor_count_warning', [warningCount])].filter(Boolean).join(' · ')
            : individualCovers && missingCoverCount > 0 ? t('cover_editor_missing_covers', [missingCoverCount])
                : canBackup && backup ? t('cover_editor_backup_hint') : '';
    const statusTone = saving ? 'is-working' : hasRunResult ? footerFailureCount > 0 ? 'has-error'
        : warningCount > 0 || footerCancelledCount > 0 ? 'has-warning' : 'is-success' : '';
    const showResultDetails = () => {
        if (embedded) {
            if (savingRef.current) return;
            if (!resultLog) setResultLog(createCoverEditorResultLog({ entries,
                outcomes: Object.entries(fileResults).map(([sourcePath, outcome]) => ({ ...outcome, sourcePath })) }, t));
            setHelpOpen(false);
            setResultLogOpen(true);
        } else if (isBatch) {
            setBatchOpen(true);
            if (batchRef.current) batchRef.current.open = true;
            batchSummaryRef.current?.focus();
            batchSummaryRef.current?.scrollIntoView?.({ block: 'nearest' });
        } else {
            setResultDetailsOpen(value => !value);
        }
    };
    const renderResultDetails = outcome => <>
        {outcome.filePath && <p>{t('cover_editor_result_path')}: {outcome.filePath}</p>}
        {outcome.backupPath && <p>{t('cover_editor_backup_path')}: {outcome.backupPath}</p>}
        {outcome.warning && <p className="cover-editor-result-warning">{t('cover_editor_refresh_warning')}: {outcome.warning}</p>}
        {outcome.readingWarning && <p className="cover-editor-result-warning">{outcome.readingWarning}</p>}
        {outcome.readingAdjustmentUncertain && <p className="cover-editor-result-warning">{t('cover_editor_reading_check')}</p>}
    </>;

    const embeddedFileList = entries.length === 0 ? (
        <div className="renamer-empty-state cover-editor-tool-empty">
            <img src={dragDropImage} alt="" className="renamer-empty-image" />
            <p className="renamer-empty-text">{t('drag_drop')}</p>
        </div>
    ) : (
        <div ref={fileTableRef} className="renamer-table-wrapper cover-editor-file-table" tabIndex={0}
            aria-label={t('cover_editor_tool_files')} onKeyDown={handleFileTableKeyDown}>
            <table className="renamer-table">
                <thead><tr>
                    <th scope="col">{t('col_name')}</th>
                    <th scope="col" style={{ width: '10%' }}>{t('cover_editor_tool_page_count')}</th>
                    <th scope="col" style={{ width: '15%' }}>{t('col_size')}</th>
                    <th scope="col" style={{ width: '20%' }}>{t('tf_col_status')}</th>
                    <th scope="col" style={{ width: '88px' }}>{t('cover_editor_filename_preview')}</th>
                    <th scope="col" style={{ width: '8%' }}>{t('cover_editor_tool_remove')}</th>
                </tr></thead>
                <tbody>{entries.map((entry, index) => {
                    const outcome = fileResults[entry.filePath];
                    const status = entry.error ? 'cover_editor_batch_inspect_failed'
                        : outcome?.cancelled ? 'cover_editor_batch_cancelled'
                            : outcome ? outcome.success ? 'cover_editor_status_saved' : 'cover_editor_status_failed'
                                : entry.info ? individualCovers ? imageForFile(entry.filePath) ? 'cover_editor_cover_assigned' : 'cover_editor_cover_required'
                                    : 'cover_editor_batch_ready' : 'cover_editor_batch_pending';
                    const name = entry.info?.name || entry.name;
                    const statusText = [t(status), hasResultWarning(outcome) && t('cover_editor_status_warning')].filter(Boolean).join(' · ');
                    return <tr key={entry.filePath} data-cover-file={entry.filePath}
                        ref={node => { if (node) fileRowRefs.current.set(entry.filePath, node); else fileRowRefs.current.delete(entry.filePath); }}
                        className={selectedIndex === index ? 'selected' : ''} aria-selected={selectedIndex === index}
                        onMouseDown={event => {
                            if (event.button !== 0 || event.target.closest('input, button, textarea, select, a')) return;
                            fileTableRef.current?.focus({ preventScroll: true });
                            if (selectedIndex !== index) void selectEntry(entry, index);
                        }}
                        onClick={event => {
                            if (event.target.closest('input, button, textarea, select, a')) return;
                            fileTableRef.current?.focus({ preventScroll: true });
                        }}>
                        <td><div className="renamer-file-cell">
                            <input type="checkbox" className="cover-editor-file-check" checked={checkedPaths.has(entry.filePath)}
                                disabled={busy || !onToggleFile} aria-label={name}
                                onClick={event => event.stopPropagation()}
                                onChange={event => { event.stopPropagation(); onToggleFile?.(entry.filePath); }} />
                            <span className="renamer-file-name" title={entry.filePath}>{name}</span>
                        </div></td>
                        <td className="renamer-cell-center">{entry.info?.kind === 'comic' && Number.isFinite(entry.info.pageCount) ? entry.info.pageCount : '—'}</td>
                        <td className="renamer-cell-center">{Number.isFinite(entry.info?.size) ? `${(entry.info.size / (1024 * 1024)).toFixed(1)} MB` : '—'}</td>
                        <td className="renamer-cell-center" title={statusText}>{statusText}</td>
                        <td className="renamer-cell-center">
                            <button type="button" className="cover-editor-filename-preview-button" aria-haspopup="dialog"
                                aria-label={t('cover_editor_filename_preview_file', [name])}
                                title={t(!entry.info?.canRenumber ? 'cover_editor_filename_preview_unavailable'
                                    : !renumber ? 'cover_editor_filename_preview_disabled' : 'cover_editor_filename_preview_title')}
                                disabled={busy || Boolean(result) || !renumber || !entry.info?.canRenumber || !entry.info?.pages?.length}
                                onClick={event => {
                                    event.stopPropagation();
                                    if (busy || result || !renumber || !entry.info?.canRenumber || !entry.info?.pages?.length) return;
                                    filenameButtonRef.current = event.currentTarget;
                                    setFilenamePreviewPath(entry.filePath);
                                }}>{t('cover_editor_filename_preview')}</button>
                        </td>
                        <td className="renamer-cell-center">
                            <button type="button" className="renamer-archive-delete-btn" title={t('cover_editor_tool_remove_hint')}
                                aria-label={t('cover_editor_tool_remove_file', [name])} disabled={busy || !onRemoveFile}
                                onClick={event => {
                                    event.stopPropagation();
                                    if (busy || !onRemoveFile) return;
                                    fileTableRef.current?.focus({ preventScroll: true });
                                    if (selectedPathRef.current === entry.filePath) {
                                        selectedPathRef.current = (entries[index + 1] || entries[index - 1])?.filePath || '';
                                    }
                                    onRemoveFile(entry.filePath);
                                }}><FaIcon name="trash" size={11} aria-hidden="true" /></button>
                        </td>
                    </tr>;
                })}</tbody>
            </table>
        </div>
    );
    const fileList = (
        <ul className="cover-editor-file-list" aria-label={t('cover_editor_batch_files')}>
            {entries.map((entry, index) => {
                const outcome = fileResults[entry.filePath];
                const status = entry.error ? 'cover_editor_batch_inspect_failed'
                    : outcome?.cancelled ? 'cover_editor_batch_cancelled'
                        : outcome ? outcome.success ? 'cover_editor_status_saved' : 'cover_editor_status_failed'
                            : entry.info ? individualCovers ? imageForFile(entry.filePath) ? 'cover_editor_cover_assigned' : 'cover_editor_cover_required'
                                : 'cover_editor_batch_ready' : 'cover_editor_batch_pending';
                const warning = hasResultWarning(outcome);
                const name = entry.info?.name || entry.name;
                const expanded = Boolean(expandedFiles[entry.filePath]);
                return <li key={entry.filePath} className={entry.error || (outcome && !outcome.success && !outcome.cancelled) ? 'has-error' : outcome?.success ? 'is-success' : ''}>
                    <div className="cover-editor-file-row">
                        <button type="button" className="cover-editor-file-choice" aria-pressed={selectedIndex === index}
                            onClick={() => selectEntry(entry, index)} title={name}>
                            <span className="cover-editor-file-name">{name}</span>
                            <span className="cover-editor-file-badges"><span className="cover-editor-file-status">{t(status)}</span>
                                {warning && <span className="cover-editor-file-status has-warning">{t('cover_editor_status_warning')}</span>}
                            </span>
                        </button>
                        <button type="button" className="cover-editor-file-detail-toggle" aria-expanded={expanded}
                            aria-controls={`${titleId}-file-${index}`} aria-label={t('cover_editor_file_details', [name])}
                            title={t('cover_editor_file_details', [name])}
                            onClick={() => setExpandedFiles(value => ({ ...value, [entry.filePath]: !value[entry.filePath] }))}>
                            <FaIcon name={expanded ? 'angleUp' : 'angleDown'} aria-hidden="true" />
                        </button>
                    </div>
                    {expanded && <div id={`${titleId}-file-${index}`} className="cover-editor-file-result">
                        {entry.info && <p>{storageText(entry.info)}</p>}
                        <p>{t('cover_editor_file_path')}: {entry.filePath}</p>
                        {entry.error && <p className="cover-editor-file-error">{entry.error}</p>}
                        {outcome && !outcome.success && !outcome.cancelled && <p className="cover-editor-file-error">{resultError(outcome)}</p>}
                        {outcome?.success && renderResultDetails(outcome)}
                    </div>}
                </li>;
            })}
        </ul>
    );
    const sourcePanel = (
        <section className="cover-editor-sources" aria-label={t('cover_editor_source_title')}>
            <div className="cover-editor-source-buttons" role="tablist" aria-label={t('cover_editor_source_title')}>
                {['metadata', 'local', 'archive'].map(source => <button key={source} id={`${titleId}-source-${source}`} type="button" role="tab"
                    aria-selected={imageSource === source} aria-controls={`${titleId}-source-panel`}
                    disabled={loading || saving || externalBusy || Boolean(result)} onClick={() => changeImageSource(source)}>
                    {t(`cover_editor_source_${source}`)}
                </button>)}
            </div>
            <div id={`${titleId}-source-panel`} className={`cover-editor-source-panel is-${imageSource}`}
                role="tabpanel" aria-labelledby={`${titleId}-source-${imageSource}`}>
                {imageSource === 'local' && (embedded ? <div ref={localSourceRef} className="cover-editor-local-picker" tabIndex={0} aria-label={t('cover_editor_source_local')}>
                    <p className="cover-editor-note">{t('cover_editor_source_local_hint')}</p>
                    <button type="button" className="cover-editor-browse" onClick={browseImage} disabled={busy || Boolean(result)}>{t('cover_editor_local_browse')}</button>
                    <small>JPEG · PNG · WebP · GIF · BMP · 16 MiB</small>
                </div> : <button ref={localSourceRef} type="button" className={`cover-editor-local-picker cover-editor-drop ${dragging ? 'is-dragging' : ''}`}
                    onClick={browseImage} disabled={busy || Boolean(result)} aria-label={t('cover_editor_local_browse')}
                    onDragEnter={event => { event.preventDefault(); event.stopPropagation(); if (!busy && !result) setDragging(true); }}
                    onDragLeave={event => { if (!event.currentTarget.contains(event.relatedTarget)) setDragging(false); }}
                    onDragOver={event => { event.preventDefault(); event.stopPropagation(); event.dataTransfer.dropEffect = busy || result ? 'none' : 'copy'; }}
                    onDrop={handleDrop}>
                    <FaIcon name="image" size={30} />
                    <span className="cover-editor-note">{t('cover_editor_source_local_hint')}</span>
                    <span className="cover-editor-browse">{t('cover_editor_local_browse')}</span>
                    <small>JPEG · PNG · WebP · GIF · BMP · 16 MiB</small>
                </button>)}
                {imageSource === 'metadata' && <>
                    <div className="cover-editor-search-toolbar">
                        <form className="cover-editor-search" onSubmit={searchMetadataImages}>
                            <label className="cover-editor-search-label" htmlFor={`${titleId}-api`}>{t('t3_search_api')}</label>
                            <select id={`${titleId}-api`} className="cover-editor-search-api" value={searchApiSource}
                                aria-label={t('t3_search_api')} disabled={busy || Boolean(result)}
                                onChange={event => changeSearchApiSource(event.target.value)}>
                                {searchApiSources.map(source => <option key={source.value} value={source.value}>{t(source.labelKey)}</option>)}
                            </select>
                            <label className="cover-editor-search-label" htmlFor={`${titleId}-query`}>{t('t3_search_query')}</label>
                            <div className="cover-editor-search-field">
                                <input ref={searchInputRef} id={`${titleId}-query`} type="text" value={searchQuery} maxLength={300}
                                    aria-label={t('cover_editor_search_query')}
                                    disabled={busy || Boolean(result)} onChange={event => setSearchQuery(event.target.value)} />
                                {(searchQuery || metadataSearch.searched || metadataLoading) && <button type="button" className="cover-editor-search-clear"
                                    onClick={resetMetadataSearch} disabled={busy || Boolean(result)}
                                    title={t('cover_editor_metadata_reset')} aria-label={t('cover_editor_metadata_reset')}>×</button>}
                            </div>
                            <button type="submit" className="cover-editor-search-submit" disabled={busy || Boolean(result) || !searchQuery.trim()}
                                title={t('cover_editor_metadata_search')} aria-label={t('cover_editor_metadata_search')}>
                                <FaIcon name="search" /> {t('t3_btn_search')}
                            </button>
                        </form>
                        <div className="cover-editor-pagination cover-editor-search-pagination">
                            {metadataSearch.searched && !metadataSearch.failed && <span role="status">{t('cover_editor_metadata_page', [metadataSearch.page])}</span>}
                            <button type="button" disabled={busy || metadataLoading || Boolean(result) || !metadataSearch.searched || metadataSearch.failed || metadataSearch.page <= 1}
                                onClick={() => loadMetadataResults(metadataSearch.query, metadataSearch.page - 1)}>{t('cover_editor_metadata_previous')}</button>
                            <button type="button" disabled={busy || metadataLoading || Boolean(result) || !metadataSearch.searched || metadataSearch.failed || !metadataSearch.hasNext}
                                onClick={() => loadMetadataResults(metadataSearch.query, metadataSearch.page + 1)}>{t('cover_editor_metadata_next')}</button>
                        </div>
                    </div>
                    {metadataLoading ? <div className="cover-editor-search-loading" role="status" aria-live="polite" aria-label={t('cover_editor_metadata_loading')}>
                        {reducedMotion ? <span>{t('cover_editor_metadata_loading')}</span> : <img src={workingAnimation} alt="" />}
                    </div> : <>
                        <ul ref={metadataResultsRef} className="cover-editor-search-results" aria-label={t('cover_editor_source_metadata')}>
                                {metadataSearch.results.map(item => {
                                    const resultKey = metadataSearchResultKey(item);
                                    const title = metadataResultTitle(item) || t('cover_editor_metadata_untitled');
                                    const thumbnail = coverEditorMetadataThumbnail(item);
                                    const author = item.author || item.metadata?.Writer || '';
                                    const requestId = metadataRequestRef.current;
                                    const loadedArtwork = metadataSearch.artwork?.[resultKey];
                                    const artwork = loadedArtwork?.requestId === requestId && loadedArtwork.thumbnail === thumbnail ? loadedArtwork : null;
                                    const dimensions = artwork?.width > 0 && artwork?.height > 0
                                        ? `${artwork.width} × ${artwork.height}` : t('cover_editor_metadata_dimensions_unknown');
                                    return <li key={resultKey}><button type="button" title={title} disabled={busy || Boolean(result)}
                                        aria-pressed={image?.source === 'metadata' && image.resultKey === resultKey} onClick={() => chooseMetadataImage(item)}>
                                        <span className="cover-editor-search-artwork"><FaIcon name="image" size={24} aria-hidden="true" />
                                            {thumbnail && <img src={thumbnail} alt="" hidden={artwork?.failed} loading="lazy" referrerPolicy="no-referrer"
                                                onError={event => updateMetadataArtwork(requestId, resultKey, thumbnail, event.currentTarget, true)}
                                                onLoad={event => updateMetadataArtwork(requestId, resultKey, thumbnail, event.currentTarget)} />}
                                            <span className="cover-editor-search-overlay">
                                                <strong>{title}</strong>
                                                {author && <span className="cover-editor-search-author">{author}</span>}
                                                <small>{item.apiSource}</small>
                                            </span>
                                        </span>
                                        <span className="cover-editor-search-dimensions" title={dimensions}>{dimensions}</span>
                                    </button></li>;
                                })}
                                {metadataSearch.results.length === 0 && metadataSearch.searched && !metadataSearch.failed &&
                                    <li className="cover-editor-search-empty cover-editor-note" role="status">{t('cover_editor_metadata_empty')}</li>}
                            </ul>
                    </>}
                </>}
                {imageSource === 'archive' && (info?.canSelectArchiveImage ? <>
                    <p className="cover-editor-archive-source" title={filePath}>{t('cover_editor_archive_from', [info.name || selectedEntry?.name])}</p>
                    <p className="cover-editor-note">{t(isBatch ? 'cover_editor_archive_batch_hint' : 'cover_editor_archive_hint')}</p>
                    {archiveError ? <div className="cover-editor-archive-error"><p role="alert">{archiveError}</p>
                        <button type="button" disabled={archiveLoading || saving || Boolean(result)} onClick={() => loadArchiveImages(archiveImages.offset)}>{t('cover_editor_archive_retry')}</button></div>
                        : archiveLoading ? <p role="status">{t('cover_editor_loading')}</p>
                            : archiveImages.entries.length ? <>
                                <ul className="cover-editor-archive-list" aria-label={t('cover_editor_source_archive')}>
                                    {archiveImages.entries.map((entry, index) => <li key={entry.name}><button type="button"
                                        title={entry.name} disabled={busy || Boolean(result)}
                                        aria-pressed={image?.source === 'archive' && image.sourceFilePath === filePath && image.entryName === entry.name}
                                        onClick={() => chooseArchiveImage(entry.name)}>
                                        <span className="cover-editor-search-artwork cover-editor-archive-thumbnail">
                                            {entry.thumbnailDataUrl ? <img src={entry.thumbnailDataUrl} alt="" loading="lazy" /> : <FaIcon name="image" size={24} aria-hidden="true" />}
                                            <span className="cover-editor-archive-number" aria-hidden="true">{archiveImages.offset + index + 1}</span>
                                            <span className="cover-editor-search-overlay"><strong>{entry.name}</strong></span>
                                        </span>
                                        <span className="cover-editor-search-dimensions">
                                            {entry.thumbnailDataUrl && entry.width > 0 && entry.height > 0 ? `${entry.width} × ${entry.height}`
                                                : t(entry.thumbnailLoading ? 'cover_editor_archive_thumbnail_loading' : 'cover_editor_archive_thumbnail_unavailable')}
                                        </span>
                                    </button></li>)}
                                </ul>
                                <div className="cover-editor-pagination">
                                    <span role="status">{t('cover_editor_archive_range', [archiveImages.offset + 1, archiveImages.offset + archiveImages.entries.length, archiveImages.total])}</span>
                                    <button type="button" onClick={() => loadArchiveImages(Math.max(0, archiveImages.offset - ARCHIVE_PAGE_SIZE))}
                                        disabled={busy || archiveLoading || Boolean(result) || archiveImages.offset === 0}>{t('cover_editor_archive_previous')}</button>
                                    <button type="button" onClick={() => loadArchiveImages(archiveImages.offset + ARCHIVE_PAGE_SIZE)}
                                        disabled={busy || archiveLoading || Boolean(result) || archiveImages.offset + archiveImages.entries.length >= archiveImages.total}>{t('cover_editor_archive_next')}</button>
                                </div>
                            </> : <p className="cover-editor-note">{t('cover_editor_archive_empty')}</p>}
                </> : <p className="cover-editor-note">{t(targets.length ? 'cover_editor_archive_unavailable' : 'cover_editor_archive_no_file')}</p>)}
            </div>
        </section>
    );
    const previewImage = imageArrival ? imageArrival.previousImage : image;
    const comparisonPanel = (
        <section className="cover-editor-comparison" aria-label={t('cover_editor_preview_title')}>
            <div className="cover-editor-previews">
                <div className="cover-editor-preview">
                    <h3>{t('cover_editor_current')}{(isBatch || embedded) && selectedEntry?.name && <span className="cover-editor-preview-name" title={filePath}>{selectedEntry.name}</span>}</h3>
                    <div className="cover-editor-image">
                        {coverLoading ? <span role="status">{t('cover_editor_loading')}</span> : info?.coverDataUrl ? <img src={info.coverDataUrl} alt={t('cover_editor_current')} />
                            : selectedEntry?.error || coverError ? <span>{selectedEntry?.error || coverError}</span>
                                : <SmoothCoverImage src={noImage} alt={t('cover_editor_no_cover')} className="cover-editor-no-image" />}
                    </div>
                    <div className="cover-editor-preview-actions">
                        <span title={info?.coverEntry}>{info && (info.coverEntry || t(`cover_editor_kind_${info.kind}`))}</span>
                    </div>
                    {info?.coverDataUrl && <div className="cover-editor-preview-actions cover-editor-current-actions">
                        <button type="button" onClick={exportCurrentCover} disabled={busy}>{t('cover_editor_export')}</button>
                    </div>}
                </div>
                {embedded && <div className="cover-editor-preview-divider" aria-hidden="true" />}
                <div className="cover-editor-preview">
                    <h3>{t('cover_editor_new')}{image && <span className="cover-editor-preview-name">{t(`cover_editor_source_${image.source}`)}</span>}</h3>
                    <div ref={candidateRef} className={`cover-editor-image cover-editor-candidate ${image ? 'has-image' : ''}`} aria-busy={imageLoading}>
                        {previewImage ? <img src={previewImage.dataUrl} alt={t('cover_editor_new')} />
                            : <SmoothCoverImage src={noImage} alt={t('cover_editor_preview_empty')} className="cover-editor-no-image" />}
                        {arrivalHighlight > 0 && <span key={arrivalHighlight} className="cover-editor-arrival-highlight" aria-hidden="true" />}
                        {imageLoading && <span className="cover-editor-image-loading" role="status">{t('cover_editor_loading')}</span>}
                    </div>
                    <div className="cover-editor-preview-actions">
                        <span title={image?.sourceTitle || image?.entryName || image?.imagePath}>{image ? `${image.width} × ${image.height} · ${Math.ceil(image.size / 1024)} KB` : t('cover_editor_select_hint')}</span>
                    </div>
                    {image && <div className="cover-editor-preview-actions cover-editor-candidate-actions">
                        <button type="button" disabled={busy || Boolean(result)} onClick={clearImage}>{t('cover_editor_clear')}</button>
                        <button ref={imageEditButtonRef} type="button" disabled={busy || Boolean(result) || imageLoading} onClick={openImageEditor}>{t('cover_editor_edit')}</button>
                    </div>}
                </div>
            </div>
        </section>
    );
    const optionsPanel = (
        <div className="cover-editor-options-toolbar">
            {embedded && <button type="button" className={`renamer-btn-toggle cover-editor-toggle-all${allFilesChecked ? ' active' : ''}`}
                aria-pressed={allFilesChecked} disabled={busy || !targets.length || !onToggleAll}
                onClick={() => { if (!busy && targets.length) onToggleAll?.(); }}>
                <FaIcon name="checkSquare" aria-hidden="true" />{t('toggle_all')}
            </button>}
            <fieldset className="cover-editor-options" disabled={busy || Boolean(result)} aria-label={embedded ? t('cover_editor_tool_options') : undefined}>
                {!embedded && <legend className="cover-editor-section-title"><span aria-hidden="true">3</span>{t('cover_editor_operation')}</legend>}
                <label className="cover-editor-scope">
                    {t('cover_editor_scope')}
                    <select value={options.coverScope} aria-label={t('cover_editor_scope')} aria-describedby={`${titleId}-scope-hint`}
                        onChange={event => changeCoverScope(event.target.value)}>
                        <option value="group">{t('cover_editor_scope_group')}</option>
                        <option value="individual">{t('cover_editor_scope_individual')}</option>
                    </select>
                </label>
                {canAdd || emptySelection ? <div className="cover-editor-modes">
                    <label><input type="radio" name={titleId} checked={mode === 'replace'} onChange={() => changeOptions({ mode: 'replace', renumber: false })} />{t('cover_editor_replace')}<small>{t('cover_editor_replace_hint')}</small></label>
                    <label><input type="radio" name={titleId} checked={mode === 'add'} onChange={() => changeOptions({ mode: 'add', renumber: true })} />{t('cover_editor_add')}<small>{t('cover_editor_add_hint')}</small></label>
                </div> : <p>{isBatch ? t('cover_editor_batch_replace_only') : info && storageText(info)}</p>}
                <div className="cover-editor-checks">
                    {(canBackup || emptySelection) && <label className={`renamer-btn-toggle cover-editor-option-toggle${backup ? ' active' : ''}`}>
                        <input type="checkbox" checked={backup} onChange={event => changeOptions({ backup: event.target.checked })} />
                        <FaIcon name="checkSquare" aria-hidden="true" />{t('cover_editor_backup')}
                    </label>}
                    {(canRenumber || emptySelection) && <label className={`renamer-btn-toggle cover-editor-option-toggle${renumber ? ' active' : ''}`}>
                        <input type="checkbox" checked={renumber} onChange={event => changeOptions({ renumber: event.target.checked })} />
                        <FaIcon name="checkSquare" aria-hidden="true" />{t('cover_editor_renumber')}
                    </label>}
                </div>
                {!isBatch && info?.conversion && <p className="cover-editor-notice">{t('cover_editor_conversion')}</p>}
            </fieldset>
        </div>
    );

    return (
        <div className={embedded ? 'cover-editor-tool' : 'folder-dialog-backdrop cover-editor-backdrop'}
            onMouseDown={event => { if (!embedded && event.target === event.currentTarget) close(); }}
            onDragEnter={embedded ? undefined : event => { event.preventDefault(); event.stopPropagation(); }}
            onDragLeave={embedded ? undefined : event => event.stopPropagation()}
            onDragOver={embedded ? undefined : event => { event.preventDefault(); event.stopPropagation(); event.dataTransfer.dropEffect = 'none'; }}
            onDrop={embedded ? undefined : event => { event.preventDefault(); event.stopPropagation(); }}
            onKeyDown={handleKeyDown}>
            <section ref={dialogRef} className={`cover-editor-dialog${embedded ? ' cover-editor-embedded' : ''}`} data-folder-modal={embedded ? undefined : true}
                role={embedded ? 'region' : 'dialog'} aria-modal={embedded || helpOpen || filenamePreviewPath || imageEditTarget ? undefined : 'true'}
                aria-hidden={helpOpen || resultLogOpen || filenamePreviewPath || imageEditTarget || embedded && processing ? 'true' : undefined} inert={helpOpen || resultLogOpen || filenamePreviewPath || imageEditTarget || embedded && processing ? '' : undefined}
                aria-labelledby={titleId} aria-busy={processing} tabIndex={-1}>
                <header className="cover-editor-header">
                    <div className={embedded ? 'cover-editor-tool-heading' : undefined}>
                        {embedded && <button type="button" className="cover-editor-tool-back" onClick={onClose} disabled={busy}><FaIcon name="angleLeft" aria-hidden="true" />{t('tools.back')}</button>}
                        <h2 id={titleId}>{t('cover_editor_title')}</h2>{!embedded && <p title={isBatch ? undefined : filePath}>{isBatch ? t('cover_editor_batch_title', [targets.length]) : info?.name || targets[0]?.name || filePath}</p>}
                    </div>
                    <div className="cover-editor-header-actions">
                        <button ref={helpButtonRef} type="button" className="cover-editor-help-button" onClick={() => setHelpOpen(true)}
                            title={t('cover_editor_help_button')} aria-label={t('cover_editor_help_button')} aria-haspopup="dialog">
                            <span aria-hidden="true">?</span>
                        </button>
                        {!embedded && <button type="button" onClick={close} disabled={saving} aria-label={t('cover_editor_close')}>×</button>}
                    </div>
                </header>
                <div className="cover-editor-body">
                    {embedded ? <div className="cover-editor-tool-workspace">
                        {comparisonPanel}
                        <div className="cover-editor-tool-main">
                            <section ref={batchRef} id={`${titleId}-files`} className="cover-editor-tool-files" aria-label={t('cover_editor_tool_files')}>
                                {optionsPanel}
                                <p id={`${titleId}-scope-hint`} className="cover-editor-scope-hint">{t(individualCovers ? 'cover_editor_scope_individual_hint' : 'cover_editor_scope_group_hint')}</p>
                                {embeddedFileList}
                                {loading && <p className="cover-editor-note" role="status">{t('cover_editor_batch_inspecting', [inspectedCount, targets.length])}</p>}
                                {inspectionFailureCount > 0 && <p className="cover-editor-note">{t('cover_editor_batch_inspect_hint')}</p>}
                                <div className="renamer-table-count">{t('cover_editor_tool_total_files', { count: entries.length })}</div>
                            </section>
                            {entries.length > 0 && sourcePanel}
                        </div>
                    </div> : <>
                    {isBatch && <details ref={batchRef} id={`${titleId}-files`} className="cover-editor-batch" open={batchOpen}
                        onToggle={event => setBatchOpen(event.currentTarget.open)}>
                        <summary ref={batchSummaryRef}>
                            <strong>{t('cover_editor_batch_files')} <span className="cover-editor-file-count">{entries.length}</span></strong>
                            <span className="cover-editor-batch-name" title={filePath}>{selectedEntry?.name}</span>
                            {failureCount > 0 && <span className="cover-editor-batch-issue has-error">{t('cover_editor_count_failed', [failureCount])}</span>}
                            {warningCount > 0 && <span className="cover-editor-batch-issue has-warning">{t('cover_editor_count_warning', [warningCount])}</span>}
                            <FaIcon name="angleDown" className="cover-editor-batch-chevron" aria-hidden="true" />
                        </summary>
                        {fileList}
                        {inspectionFailureCount > 0 && <p className="cover-editor-note">{t('cover_editor_batch_inspect_hint')}</p>}
                    </details>}
                    {loading && <p role="status">{isBatch ? t('cover_editor_batch_inspecting', [inspectedCount, targets.length]) : t('cover_editor_loading')}</p>}
                    {!loading && readyEntries.length > 0 && <>
                        <div className="cover-editor-workspace">
                            {sourcePanel}
                            <div className="cover-editor-review">
                                {comparisonPanel}
                                {optionsPanel}
                                <p id={`${titleId}-scope-hint`} className="cover-editor-scope-hint">{t(individualCovers ? 'cover_editor_scope_individual_hint' : 'cover_editor_scope_group_hint')}</p>
                            </div>
                        </div>
                    </>}
                    </>}
                </div>
                {error && <div className="cover-editor-error cover-editor-feedback" role="alert" tabIndex={0}>{error}</div>}
                {!embedded && !isBatch && result && resultDetailsOpen && <div ref={resultDetailsRef} id={`${titleId}-result`}
                    className="cover-editor-result-details cover-editor-feedback" role="region" tabIndex={0} aria-label={t('cover_editor_result_details')}>
                    {renderResultDetails(result)}
                </div>}
                <footer className="cover-editor-footer">
                    <div className={`cover-editor-footer-status ${statusTone}`}>
                        <span role="status" aria-label={loggedStats ? t('log_summary', [loggedStats.success.length, loggedStats.skip.length, loggedStats.error.length])
                            : result?.batch ? t('cover_editor_batch_summary', [result.successCount, result.failureCount + inspectionFailureCount, result.cancelledCount]) + (warningCount > 0 ? ` · ${t('cover_editor_count_warning', [warningCount])}` : '') : undefined}>
                            {(saving || hasRunResult) && <FaIcon name={saving ? 'spinner' : footerFailureCount > 0 || warningCount > 0 ? 'info' : footerCancelledCount > 0 ? 'stopCircle' : 'circleCheck'} aria-hidden="true" />}
                            <span>{footerStatus}{saving && cancelRequested && <small>{t('cover_editor_batch_cancelling')}</small>}</span>
                        </span>
                        {!(embedded && saving) && (result || embedded && resultLog || (embedded || isBatch) && failureCount > 0) && <button ref={resultLinkRef} type="button" className="cover-editor-result-link"
                            aria-controls={embedded ? undefined : `${titleId}-${isBatch ? 'files' : 'result'}`} aria-expanded={embedded || isBatch ? undefined : resultDetailsOpen}
                            aria-haspopup={embedded ? 'dialog' : undefined}
                            onClick={showResultDetails}>{t('cover_editor_view_result')}<FaIcon name="angleRight" aria-hidden="true" /></button>}
                    </div>
                    {saving && progress && <button type="button" onClick={cancelRemaining} disabled={cancelRequested}>{t('cover_editor_batch_cancel_remaining')}</button>}
                    {!embedded && <button type="button" onClick={close} disabled={saving}>{t(result ? 'cover_editor_close' : 'cover_editor_cancel')}</button>}
                    {embedded && result && <button type="button" onClick={onReset} disabled={busy || !onReset}>{t('cover_editor_tool_reset')}</button>}
                    {!result && <button type="button" className="cover-editor-save" onClick={save} disabled={busy || imageLoading || !readyEntries.length || missingCoverCount > 0}>{saving ? t('cover_editor_saving') : isBatchSave ? t('cover_editor_batch_save', [readyEntries.length]) : t('cover_editor_save')}</button>}
                </footer>
            </section>
            {imageEditTarget && <React.Suspense fallback={<div className="cover-editor-help-backdrop" role="status">{t('cover_editor_loading')}</div>}>
                <CoverImageEditorDialog image={imageEditTarget} onApply={applyEditedImage} onClose={closeImageEditor} t={t}
                    formatError={failure => failure?.code === 'ASSET_TOO_LARGE' ? t('cover_editor_image_too_large')
                        : COVER_IMAGE_ERROR_KEYS[failure?.code] ? t(COVER_IMAGE_ERROR_KEYS[failure.code]) : ''} />
            </React.Suspense>}
            {embedded && resultLogOpen && resultLog && <div className="cover-editor-result-modal"
                onDragEnter={event => { event.preventDefault(); event.stopPropagation(); }}
                onDragOver={event => { event.preventDefault(); event.stopPropagation(); event.dataTransfer.dropEffect = 'none'; }}
                onDrop={event => { event.preventDefault(); event.stopPropagation(); }}>
                <ResultLogDialog result={resultLog} onClose={() => setResultLogOpen(false)} t={t} />
            </div>}
            {filenamePreviewInfo && <div className="cover-editor-help-backdrop"
                onDragEnter={event => { event.preventDefault(); event.stopPropagation(); }}
                onDragOver={event => { event.preventDefault(); event.stopPropagation(); event.dataTransfer.dropEffect = 'none'; }}
                onDrop={event => { event.preventDefault(); event.stopPropagation(); }}
                onMouseDown={event => { event.stopPropagation(); if (event.target === event.currentTarget) setFilenamePreviewPath(''); }}>
                <section ref={filenameDialogRef} className="cover-editor-dialog cover-editor-help-dialog cover-editor-filename-dialog" data-folder-modal
                    role="dialog" aria-modal="true" aria-labelledby={`${titleId}-filenames`} aria-describedby={`${titleId}-filenames-hint`} tabIndex={-1}>
                    <header className="cover-editor-header">
                        <h2 id={`${titleId}-filenames`}>{t('cover_editor_filename_preview_title')}</h2>
                        <button type="button" onClick={() => setFilenamePreviewPath('')} aria-label={t('cover_editor_close')}
                            title={`${t('cover_editor_close')} (Esc)`}>×</button>
                    </header>
                    <div className="cover-editor-body cover-editor-filename-body" tabIndex={0}>
                        <p className="cover-editor-filename-source" title={filenamePreviewPath}>{filenamePreviewInfo.name || filenamePreviewEntry.name}</p>
                        <p id={`${titleId}-filenames-hint`} className="cover-editor-filename-note">{t('cover_editor_filename_preview_hint')}</p>
                        <div className="cover-editor-filename-table-scroll">
                            <table className="cover-editor-filename-table">
                                <thead><tr>
                                    <th scope="col">{t('cover_editor_filename_preview_before')}</th>
                                    <th scope="col">{t('cover_editor_filename_preview_after')}</th>
                                </tr></thead>
                                <tbody>
                                    {mode === 'add' && <tr>
                                        <td>{t('cover_editor_new')}</td>
                                        <td>{'0'.repeat(numberWidth)}{filenamePreviewImage?.extension || ''}</td>
                                    </tr>}
                                    {filenamePreviewPages.map((page, index) => <tr key={page.name}>
                                        <td>{page.name}</td>
                                        <td>{String(index + (mode === 'add' ? 1 : 0)).padStart(numberWidth, '0')}{mode === 'replace' && page.name === filenamePreviewCoverEntry && filenamePreviewImage
                                            ? filenamePreviewImage.extension : page.name.match(/\.[^.\/]+$/)?.[0] || ''}</td>
                                    </tr>)}
                                </tbody>
                            </table>
                        </div>
                        {filenamePreviewPages.length < filenamePreviewInfo.pageCount && <p className="cover-editor-filename-note">
                            {t('cover_editor_filename_preview_count', [filenamePreviewPages.length, filenamePreviewInfo.pageCount])}
                        </p>}
                        {!filenamePreviewImage && <p className="cover-editor-filename-note">{t('cover_editor_filename_preview_image_hint')}</p>}
                    </div>
                    <footer className="cover-editor-footer">
                        <button type="button" onClick={() => setFilenamePreviewPath('')}>{t('cover_editor_close')}</button>
                    </footer>
                </section>
            </div>}
            {helpOpen && <div className="cover-editor-help-backdrop"
                onDragEnter={event => { event.preventDefault(); event.stopPropagation(); }}
                onDragOver={event => { event.preventDefault(); event.stopPropagation(); event.dataTransfer.dropEffect = 'none'; }}
                onDrop={event => { event.preventDefault(); event.stopPropagation(); }}
                onMouseDown={event => { event.stopPropagation(); if (event.target === event.currentTarget) setHelpOpen(false); }}>
                <section ref={helpDialogRef} className="cover-editor-dialog cover-editor-help-dialog" data-folder-modal role="dialog" aria-modal="true"
                    aria-labelledby={`${titleId}-help`} aria-describedby={`${titleId}-help-intro`} tabIndex={-1}>
                    <header className="cover-editor-header">
                        <h2 id={`${titleId}-help`}>{t('cover_editor_help_title')}</h2>
                        <button type="button" onClick={() => setHelpOpen(false)} aria-label={t('cover_editor_close')}
                            title={`${t('cover_editor_close')} (Esc)`}>×</button>
                    </header>
                    <div className="cover-editor-body cover-editor-help-body" tabIndex={0}>
                        <p id={`${titleId}-help-intro`} className="cover-editor-help-intro">{t('cover_editor_help_intro')}</p>
                        <section aria-labelledby={`${titleId}-help-workflow`}>
                            <h3 id={`${titleId}-help-workflow`}>{t('cover_editor_help_workflow_title')}</h3>
                            <ol className="cover-editor-help-steps">
                                {['files', 'cover', 'save'].map(step => <li key={step}>
                                    <strong>{t(`cover_editor_help_step_${step}_title`)}</strong>
                                    <p>{t(`cover_editor_help_step_${step}`)}</p>
                                </li>)}
                            </ol>
                            <p className="cover-editor-help-note">{t('cover_editor_help_drop')}</p>
                        </section>
                        <section aria-labelledby={`${titleId}-help-sources`}>
                            <h3 id={`${titleId}-help-sources`}>{t('cover_editor_help_sources_title')}</h3>
                            <dl className="cover-editor-help-options">
                                {['metadata', 'local', 'archive'].map(source => <div key={source}>
                                    <dt>{t(`cover_editor_source_${source}`)}</dt>
                                    <dd>{t(`cover_editor_help_source_${source}`)}</dd>
                                </div>)}
                            </dl>
                            <p className="cover-editor-help-note">{t('cover_editor_help_selection')}</p>
                        </section>
                        <section aria-labelledby={`${titleId}-help-formats`}>
                            <h3 id={`${titleId}-help-formats`}>{t('cover_editor_help_formats_title')}</h3>
                            <div className="cover-editor-help-table-scroll"><table className="cover-editor-help-table">
                                <thead><tr>
                                    <th scope="col">{t('cover_editor_help_format')}</th>
                                    <th scope="col">{t('cover_editor_help_storage')}</th>
                                    <th scope="col">{t('cover_editor_help_details')}</th>
                                </tr></thead>
                                <tbody>{COVER_HELP_FORMATS.map(row => <tr key={row.formats}>
                                    <th scope="row">{row.formats}</th>
                                    <td><span className={`cover-editor-help-storage is-${row.storage}`}>{t(`cover_editor_help_storage_${row.storage}`)}</span></td>
                                    <td>{t(`cover_editor_${row.description}`)}</td>
                                </tr>)}</tbody>
                            </table></div>
                            <p className="cover-editor-help-note">{t('cover_editor_help_local_note')}</p>
                        </section>
                        <section aria-labelledby={`${titleId}-help-options`}>
                            <h3 id={`${titleId}-help-options`}>{t('cover_editor_help_options_title')}</h3>
                            <dl className="cover-editor-help-options">
                                {['replace', 'add', 'renumber', 'backup', 'export'].map(option => <div key={option}>
                                    <dt>{t(`cover_editor_${option}`)}</dt>
                                    <dd>{t(`cover_editor_help_${option}`)}</dd>
                                </div>)}
                            </dl>
                            <p className="cover-editor-help-note">{t('cover_editor_help_preferences')}</p>
                        </section>
                        <section aria-labelledby={`${titleId}-help-images`}>
                            <h3 id={`${titleId}-help-images`}>{t('cover_editor_help_images_title')}</h3>
                            <p>{t('cover_editor_help_images')}</p>
                        </section>
                        <section aria-labelledby={`${titleId}-help-batch`}>
                            <h3 id={`${titleId}-help-batch`}>{t('cover_editor_help_batch_title')}</h3>
                            <p>{t('cover_editor_help_batch')}</p>
                            <p>{t('cover_editor_help_batch_cancel')}</p>
                        </section>
                    </div>
                    <footer className="cover-editor-footer">
                        <button type="button" onClick={() => setHelpOpen(false)}>{t('cover_editor_close')}</button>
                    </footer>
                </section>
            </div>}
        </div>
    );
}
