import { useState, useCallback, useEffect, useRef } from 'react';
import { resolveBookType } from '../metadata/metadataTypes.js';
import { joinPath } from '../utils/folderPath.js';

export const FOLDER_FILE_CACHE_LIMIT = 8;
const READY_FILES_FLUSH_DELAY_MS = 180;
const QUICK_LIST_TARGET_EXTENSIONS = new Set([
  '.zip',
  '.cbz',
  '.rar',
  '.cbr',
  '.7z',
  '.cb7',
  '.pdf',
  '.epub',
  '.txt',
]);

function fileExtension(name = '') {
  const value = String(name || '');
  const index = value.lastIndexOf('.');
  return index > 0 ? value.slice(index).toLowerCase() : '';
}

function fileTitle(name = '') {
  const value = String(name || '');
  const index = value.lastIndexOf('.');
  return index > 0 ? value.slice(0, index) : value;
}

function createQuickListFile(folderPath, item) {
  const name = String(item?.name || '');
  const ext = fileExtension(name);
  const filePath = joinPath(folderPath, name);
  const bookType = resolveBookType({ path: filePath, ext });
  return {
    name,
    path: filePath,
    folder_path: folderPath,
    full_path: filePath,
    ext,
    book_type: bookType,
    bookType,
    format: '',
    size: 0,
    mtime: 0,
    ctime: 0,
    created: '',
    modified: '',
    is_folder: false,
    series: '',
    title: fileTitle(name),
    volume: '',
    sorted_volume: null,
    compare_nums: [],
    chapter: '',
    author: '',
    writer: '',
    publisher: '',
    genre: '',
    page_count: '',
    description: '',
    tags: '',
    has_metadata: false,
    resolution: '',
    thumb_path: '',
    cover: '',
    cache_source: 'renderer-quick',
    duplicate_matches: [],
    dup_count: 0,
    max_ratio: 0,
  };
}

async function readQuickListFiles(folderPath) {
  const items = await window.electronAPI?.readDir?.(folderPath);
  if (!Array.isArray(items)) return [];
  return items
    .filter(item => item?.isFile && QUICK_LIST_TARGET_EXTENSIONS.has(fileExtension(item.name)))
    .map(item => createQuickListFile(folderPath, item));
}

export function rememberFolderFileCacheKey(order = [], cacheKey = '', limit = FOLDER_FILE_CACHE_LIMIT) {
  if (!cacheKey) return order;
  const nextOrder = [...order.filter(key => key !== cacheKey), cacheKey];
  return nextOrder.slice(-Math.max(1, Number(limit) || FOLDER_FILE_CACHE_LIMIT));
}

export function trimFolderFileDataCache(cache = {}, order = [], keepKey = '') {
  const keys = Object.keys(cache);
  if (keys.length <= FOLDER_FILE_CACHE_LIMIT) return cache;
  const limit = FOLDER_FILE_CACHE_LIMIT;
  const recentKeys = keepKey
    ? order.filter(key => key !== keepKey).slice(-(limit - 1))
    : order.slice(-limit);
  const keepKeys = new Set(keepKey ? [...recentKeys, keepKey] : recentKeys);
  const next = {};
  for (const key of keys) {
    if (keepKeys.has(key)) next[key] = cache[key];
  }
  return next;
}

/**
 * 폴더 스캔 상태 관리 훅
 * 
 * 폴더 스캔 시작/진행/완료 상태를 관리하며,
 * Electron IPC를 통해 백그라운드 스캔과 통신합니다.
 * 
 * 반환값:
 * - scanning: 스캔 진행 중 여부
 * - scanProgress: 스캔 진행률 (0~100)
 * - fileDataCache: 폴더 경로별 파일 데이터 캐시
 * - statusMessage: 현재 상태 메시지
 * - scanFolder: 폴더 스캔 시작 함수
 * - cancelScan: 스캔 취소 함수
 * - clearCache: 캐시 초기화 함수
 */
export function useFolderScan(t) {
  const [scanning, setScanning] = useState(false);
  const [scanProgress, setScanProgress] = useState(0);
  const [fileDataCache, setFileDataCache] = useState({});
  const [statusMessage, setStatusMessage] = useState('');
  const [abortController, setAbortController] = useState(null);

  const currentFolderRef = useRef(null);
  const fileDataCacheRef = useRef({});
  const fileDataCacheOrderRef = useRef([]);
  const activeScansRef = useRef(new Map());
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      activeScansRef.current.clear();
    };
  }, []);

  useEffect(() => {
    fileDataCacheRef.current = fileDataCache;
  }, [fileDataCache]);

  const mergeFilesPreservingCover = useCallback((incomingFiles = [], currentFiles = []) => {
    const currentByPath = new Map(
      (Array.isArray(currentFiles) ? currentFiles : [])
        .filter(file => file?.path)
        .map(file => [file.path, file])
    );

    return (Array.isArray(incomingFiles) ? incomingFiles : []).map(file => {
      const current = currentByPath.get(file?.path);
      if (!current) return file;
      return {
        ...current,
        ...file,
        cover: file.cover || current.cover || '',
        thumb_path: file.thumb_path || current.thumb_path || '',
      };
    });
  }, []);

  const getCacheKey = useCallback((folderPath, options = {}) => {
    const includeSubfolders = options.includeSubfolders ?? true;
    const enableDupCheck = options.enableDupCheck ?? false;
    const skipArchiveExtraction = options.skipArchiveExtraction === true;
    const dupFolders = (options.dupFolders || []).filter(Boolean).sort();
    return JSON.stringify({ folderPath, includeSubfolders, enableDupCheck, dupFolders, skipArchiveExtraction });
  }, []);

  const touchCacheKey = useCallback(cacheKey => {
    fileDataCacheOrderRef.current = rememberFolderFileCacheKey(fileDataCacheOrderRef.current, cacheKey);
  }, []);

  const limitCache = useCallback((cache, keepKey = '') => (
    trimFolderFileDataCache(cache, fileDataCacheOrderRef.current, keepKey)
  ), []);

  // --- 폴더 스캔 ---
  const scanFolder = useCallback(async (folderPath, options = {}) => {
    const { includeSubfolders = true, enableDupCheck = false } = options;
    const force = options.force === true;
    const silent = options.silent === true;
    const fastInitial = options.fastInitial === true && options.skipArchiveExtraction !== true && !silent;

    if (!folderPath) {
      setStatusMessage(t('folder.status.no_folder') || '스캔할 폴더를 선택하세요');
      return [];
    }

    const cacheKey = getCacheKey(folderPath, options);

    // 캐시에 데이터가 있다면 재사용
    if (!force && fileDataCacheRef.current[cacheKey]) {
      touchCacheKey(cacheKey);
      return fileDataCacheRef.current[cacheKey];
    }

    if (activeScansRef.current.has(cacheKey)) {
      return activeScansRef.current.get(cacheKey);
    }

    const scanPromise = (async () => {
      currentFolderRef.current = folderPath;
      if (mountedRef.current && !silent) {
        setScanning(true);
        setScanProgress(0);
        setStatusMessage(t('folder.status.scanning') || '폴더 스캔 중...');
      }

      try {
        const requestOptions = {
          includeSubfolders,
          enableDupCheck,
          dupFolders: options.dupFolders || [],
          force,
        };

        if (fastInitial) {
          const initialFiles = await readQuickListFiles(folderPath);

          if (mountedRef.current && currentFolderRef.current === folderPath) {
            touchCacheKey(cacheKey);
            setFileDataCache(prev => ({
              ...limitCache(prev, cacheKey),
              [cacheKey]: initialFiles || [],
            }));
            const initialCount = initialFiles?.length || 0;
            setStatusMessage(
              t('folder.status.files_found')?.replace('{count}', initialCount) || `${initialCount}개 파일 발견`
            );
            setScanProgress(100);
            setScanning(false);
          }

          const refreshInBackground = async () => {
            const quickFiles = await window.electronAPI.scanFolder(folderPath, {
              ...requestOptions,
              enableDupCheck: false,
              dupFolders: [],
              skipArchiveExtraction: true,
              skipLibraryCache: true,
              suppressEvents: true,
              background: true,
              reportTaskProgress: false,
              reportFileReady: false,
            });

            if (!mountedRef.current || currentFolderRef.current !== folderPath) return;
            touchCacheKey(cacheKey);
            setFileDataCache(prev => ({
              ...limitCache(prev, cacheKey),
              [cacheKey]: mergeFilesPreservingCover(quickFiles || [], prev[cacheKey] || []),
            }));
            const quickCount = quickFiles?.length || 0;
            setStatusMessage(
              t('folder.status.files_found')?.replace('{count}', quickCount) || `${quickCount}개 파일 발견`
            );

            window.electronAPI.scanFolder(folderPath, {
              ...requestOptions,
              force: false,
              skipArchiveExtraction: false,
              skipCoverExtraction: true,
              suppressEvents: true,
              background: true,
              reportTaskProgress: false,
              reportFileReady: true,
            }).then(files => {
              if (!mountedRef.current || currentFolderRef.current !== folderPath) return;
              touchCacheKey(cacheKey);
              setFileDataCache(prev => ({
                ...limitCache(prev, cacheKey),
                [cacheKey]: mergeFilesPreservingCover(files || [], prev[cacheKey] || []),
              }));
              const count = files?.length || 0;
              setStatusMessage(
                t('folder.status.files_found')?.replace('{count}', count) || `${count}개 파일 발견`
              );
            }).catch(error => {
              console.error('폴더 메타데이터 갱신 실패:', error);
            });
          };

          void refreshInBackground().catch(error => {
            console.error('폴더 빠른 메타데이터 갱신 실패:', error);
          });

          return initialFiles || [];
        }

        const files = await window.electronAPI.scanFolder(folderPath, {
          ...requestOptions,
          skipArchiveExtraction: options.skipArchiveExtraction === true,
          suppressEvents: options.suppressEvents === true,
          reportTaskProgress: options.reportTaskProgress !== false,
          reportFileReady: options.reportFileReady !== false,
        });

        if (!mountedRef.current) return files || [];
        touchCacheKey(cacheKey);
        setFileDataCache(prev => ({
          ...limitCache(prev, cacheKey),
          [cacheKey]: files || [],
        }));
        if (!silent) {
          setScanProgress(100);
          const count = files?.length || 0;
          setStatusMessage(
            t('folder.status.files_found')?.replace('{count}', count) || `${count}개 파일 발견`
          );
        }

        return files || [];
      } catch (error) {
        console.error('폴더 스캔 실패:', error);
        if (mountedRef.current && !silent) setStatusMessage(t('folder.status.error') || '스캔 중 오류 발생');
        return [];
      } finally {
        activeScansRef.current.delete(cacheKey);
        if (mountedRef.current && !silent && activeScansRef.current.size === 0) setScanning(false);
      }
    })();

    activeScansRef.current.set(cacheKey, scanPromise);
    return scanPromise;
  }, [getCacheKey, mergeFilesPreservingCover, t]);

  // --- 스캔 취소 ---
  const cancelScan = useCallback(() => {
    if (abortController) {
      abortController.abort();
      setAbortController(null);
    }
    setScanning(false);
    setStatusMessage('스캔이 취소되었습니다');
  }, [abortController]);

  // --- 캐시에서 파일 데이터 가져오기 ---
  const getCachedFiles = useCallback((folderPath, options = {}) => {
    return fileDataCache[getCacheKey(folderPath, options)] || [];
  }, [fileDataCache, getCacheKey]);

  const updateCachedFiles = useCallback((folderPath, options = {}, updatedFiles = []) => {
    const files = Array.isArray(updatedFiles) ? updatedFiles.filter(file => file?.path) : [];
    if (!folderPath || files.length === 0) return;
    const preferredKey = getCacheKey(folderPath, options);
    setFileDataCache(prev => {
      const targetKeys = Object.keys(prev).filter(key => {
        if (key === preferredKey) return true;
        try {
          return JSON.parse(key).folderPath === folderPath;
        } catch {
          return false;
        }
      });
      if (targetKeys.length === 0) return prev;
      const updatedByPath = new Map(files.map(file => [file.path, file]));
      const next = { ...prev };
      for (const key of targetKeys) {
        const currentFiles = next[key] || [];
        next[key] = currentFiles.map(file => {
          const updated = updatedByPath.get(file.path);
          return updated ? { ...file, ...updated } : file;
        });
      }
      return limitCache(next, preferredKey);
    });
  }, [getCacheKey, limitCache]);

  // --- 캐시 초기화 ---
  const clearCache = useCallback((folderPath) => {
    if (folderPath) {
      // 특정 폴더 관련 캐시만 제거
      setFileDataCache(prev => {
        const newCache = { ...prev };
        Object.keys(newCache).forEach(key => {
          try {
            if (JSON.parse(key).folderPath === folderPath) delete newCache[key];
          } catch {
            delete newCache[key];
          }
        });
        fileDataCacheOrderRef.current = fileDataCacheOrderRef.current.filter(key => newCache[key]);
        return newCache;
      });
    } else {
      // 전체 캐시 초기화
      fileDataCacheOrderRef.current = [];
      setFileDataCache({});
    }
  }, []);

  // --- IPC 이벤트 리스너 ---
  useEffect(() => {
    const pendingReadyFiles = [];
    let readyFilesFlushTimer = null;

    const findReadyTargetKey = (cache, data, folderTargetKeys) => {
      if (cache[data.cacheKey]) return data.cacheKey;
      if (folderTargetKeys.has(data.folderPath)) return folderTargetKeys.get(data.folderPath);
      const targetKey = Object.keys(cache).find(key => {
        try {
          const parsed = JSON.parse(key);
          return parsed.folderPath === data.folderPath;
        } catch {
          return false;
        }
      });
      folderTargetKeys.set(data.folderPath, targetKey || '');
      return targetKey;
    };

    const flushReadyFiles = () => {
      readyFilesFlushTimer = null;
      const batch = pendingReadyFiles.splice(0);
      if (batch.length === 0) return;
      setFileDataCache(prev => {
        const folderTargetKeys = new Map();
        const updatesByTargetKey = new Map();
        for (const data of batch) {
          const targetKey = findReadyTargetKey(prev, data, folderTargetKeys);
          if (!targetKey) continue;
          if (!updatesByTargetKey.has(targetKey)) updatesByTargetKey.set(targetKey, new Map());
          updatesByTargetKey.get(targetKey).set(data.file.path, data.file);
        }
        if (updatesByTargetKey.size === 0) return prev;

        let next = prev;
        for (const [targetKey, updatesByPath] of updatesByTargetKey.entries()) {
          const currentFiles = prev[targetKey] || [];
          let changed = false;
          const nextFiles = currentFiles.map(file => {
            const updated = updatesByPath.get(file.path);
            if (!updated) return file;
            changed = true;
            return {
              ...file,
              ...updated,
              cover: updated.cover || file.cover || '',
              thumb_path: updated.thumb_path || file.thumb_path || '',
            };
          });
          if (!changed) continue;
          if (next === prev) next = { ...prev };
          next[targetKey] = nextFiles;
        }
        return next;
      });
    };

    const scheduleReadyFilesFlush = () => {
      if (readyFilesFlushTimer) return;
      readyFilesFlushTimer = window.setTimeout(flushReadyFiles, READY_FILES_FLUSH_DELAY_MS);
    };

    const handleFolderFileReady = (data) => {
      if (!data?.file?.path) return;
      if (data.folderPath && currentFolderRef.current !== data.folderPath) return;
      if (data.file.cover) {
        window.dispatchEvent(new CustomEvent('bookmanager:folder-thumbnail-ready', {
          detail: {
            src: data.file.cover,
            name: data.file.name || data.file.filename || data.file.path,
            path: data.file.path,
          },
        }));
      }
      pendingReadyFiles.push(data);
      scheduleReadyFilesFlush();
    };

    const handleScanProgress = (data) => {
      const { progress, message } = data || {};
      if (progress !== undefined) {
        setScanProgress(progress);
      }
      if (message) {
        setStatusMessage(message);
      }
    };

    const handleTaskProgress = (data) => {
      if (data?.task !== 'folder:scan') return;
      if (data.progress !== undefined) {
        setScanProgress(Math.max(0, Math.min(100, Number(data.progress) || 0)));
      }
      if (data.message) {
        setStatusMessage(data.message);
      }
    };

    const handleScanComplete = (data) => {
      const { files, folderPath, cacheKey } = data || {};
      if (folderPath && files && cacheKey) {
        touchCacheKey(cacheKey);
        setFileDataCache(prev => ({
          ...limitCache(prev, cacheKey),
          [cacheKey]: mergeFilesPreservingCover(files, prev[cacheKey] || []),
        }));
        setScanProgress(100);
        setScanning(false);
        const count = files.length || 0;
        setStatusMessage(
          t('folder.status.files_found')?.replace('{count}', count) || `${count}개 파일 발견`
        );
      }
    };

    const handleScanError = (data) => {
      const { error, message } = data || {};
      console.error('스캔 오류:', error || message);
      setScanning(false);
      setStatusMessage(message || (t('folder.status.error') || '스캔 중 오류 발생'));
    };

    let removeFileReady, removeProgress, removeTaskProgress, removeComplete, removeError;

    if (window.electronAPI?.onFolderFileReady) {
      removeFileReady = window.electronAPI.onFolderFileReady(handleFolderFileReady);
    }
    if (window.electronAPI?.onScanProgress) {
      removeProgress = window.electronAPI.onScanProgress(handleScanProgress);
    }
    if (window.electronAPI?.onTaskProgress) {
      removeTaskProgress = window.electronAPI.onTaskProgress(handleTaskProgress);
    }
    if (window.electronAPI?.onScanComplete) {
      removeComplete = window.electronAPI.onScanComplete(handleScanComplete);
    }
    if (window.electronAPI?.onScanError) {
      removeError = window.electronAPI.onScanError(handleScanError);
    }

    return () => {
      if (readyFilesFlushTimer) window.clearTimeout(readyFilesFlushTimer);
      if (removeFileReady) removeFileReady();
      if (removeProgress) removeProgress();
      if (removeTaskProgress) removeTaskProgress();
      if (removeComplete) removeComplete();
      if (removeError) removeError();
    };
  }, [limitCache, mergeFilesPreservingCover, t, touchCacheKey]);

  return {
    scanning,
    scanProgress,
    fileDataCache,
    statusMessage,
    scanFolder,
    cancelScan,
    getCachedFiles,
    updateCachedFiles,
    clearCache,
  };
}
