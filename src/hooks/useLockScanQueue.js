import { useCallback, useEffect, useRef, useState } from 'react';
import {
    hasMatchingLockScanItem,
    mergeLockScanItem,
    mergeLockScanQueueItem,
} from '../lockScanItems';

const LIBRARY_SCAN_SLIDE_INTERVAL_MS = 900;

export function useLockScanQueue({
    isAppLocked,
    isLibraryScanSlideActive,
}) {
    const [lockThumbnails, setLockThumbnails] = useState([]);
    const [lockThumbnailIndex, setLockThumbnailIndex] = useState(0);
    const lockThumbnailsRef = useRef([]);
    const libraryScanSlideActiveRef = useRef(false);
    const lockScanQueueRef = useRef([]);
    const lockScanQueueTimerRef = useRef(null);

    const stopLockScanQueueTimer = useCallback(() => {
        if (!lockScanQueueTimerRef.current) return;
        window.clearInterval(lockScanQueueTimerRef.current);
        lockScanQueueTimerRef.current = null;
    }, []);

    const displayLockScanItem = useCallback((item = {}) => {
        const next = mergeLockScanItem(lockThumbnailsRef.current, item);
        if (next === lockThumbnailsRef.current) return;
        lockThumbnailsRef.current = next;
        setLockThumbnails(next);
    }, []);

    const drainLockScanQueue = useCallback(() => {
        if (!libraryScanSlideActiveRef.current) {
            lockScanQueueRef.current = [];
            stopLockScanQueueTimer();
            return;
        }
        const [nextItem, ...restItems] = lockScanQueueRef.current;
        if (!nextItem) {
            stopLockScanQueueTimer();
            return;
        }
        lockScanQueueRef.current = restItems;
        displayLockScanItem(nextItem);
        if (restItems.length === 0) stopLockScanQueueTimer();
    }, [displayLockScanItem, stopLockScanQueueTimer]);

    const startLockScanQueueTimer = useCallback(() => {
        if (lockScanQueueTimerRef.current) return;
        lockScanQueueTimerRef.current = window.setInterval(
            drainLockScanQueue,
            LIBRARY_SCAN_SLIDE_INTERVAL_MS,
        );
    }, [drainLockScanQueue]);

    const activateLockScanQueue = useCallback(() => {
        libraryScanSlideActiveRef.current = true;
    }, []);

    const pushLockScanItem = useCallback((item = {}) => {
        if (!libraryScanSlideActiveRef.current) {
            return;
        }
        const visibleItems = lockThumbnailsRef.current;
        if (visibleItems.length === 0 && lockScanQueueRef.current.length === 0) {
            displayLockScanItem(item);
            return;
        }
        if (hasMatchingLockScanItem(visibleItems, item)) {
            displayLockScanItem(item);
            return;
        }
        const nextQueue = mergeLockScanQueueItem(lockScanQueueRef.current, item);
        if (nextQueue === lockScanQueueRef.current) return;
        lockScanQueueRef.current = nextQueue;
        startLockScanQueueTimer();
    }, [displayLockScanItem, startLockScanQueueTimer]);

    useEffect(() => {
        libraryScanSlideActiveRef.current = isLibraryScanSlideActive;
        if (isLibraryScanSlideActive) return undefined;
        lockScanQueueRef.current = [];
        stopLockScanQueueTimer();
        return undefined;
    }, [isLibraryScanSlideActive, stopLockScanQueueTimer]);

    useEffect(() => {
        return () => stopLockScanQueueTimer();
    }, [stopLockScanQueueTimer]);

    useEffect(() => {
        lockThumbnailsRef.current = lockThumbnails;
    }, [lockThumbnails]);

    useEffect(() => {
        if (!isAppLocked) {
            lockThumbnailsRef.current = [];
            lockScanQueueRef.current = [];
            stopLockScanQueueTimer();
            setLockThumbnails([]);
            setLockThumbnailIndex(0);
            return undefined;
        }
        if (isLibraryScanSlideActive) {
            setLockThumbnailIndex(0);
            return undefined;
        }
        if (lockThumbnails.length <= 1) {
            setLockThumbnailIndex(0);
            return undefined;
        }
        const timer = window.setInterval(() => {
            setLockThumbnailIndex(current => (current + 1) % lockThumbnails.length);
        }, 1600);
        return () => window.clearInterval(timer);
    }, [isAppLocked, isLibraryScanSlideActive, lockThumbnails.length, stopLockScanQueueTimer]);

    return {
        activateLockScanQueue,
        lockThumbnailIndex,
        lockThumbnails,
        pushLockScanItem,
    };
}
