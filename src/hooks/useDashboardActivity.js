import { useCallback, useEffect, useRef, useState } from 'react';

export function useDashboardActivity(month, scopeKey) {
    const key = `${scopeKey}|${month}`;
    const [snapshot, setSnapshot] = useState(null);
    const sequenceRef = useRef(0);
    const mountedRef = useRef(false);
    const currentKeyRef = useRef(key);
    currentKeyRef.current = key;
    const refresh = useCallback(async () => {
        if (!mountedRef.current || currentKeyRef.current !== key) return;
        const sequence = ++sequenceRef.current;
        setSnapshot(previous => ({ key, data: previous?.key === key ? previous.data : null, loading: true, error: false }));
        try {
            const result = await window.electronAPI?.readingLists?.({ operation: 'dashboard', month });
            if (!result?.success || !Array.isArray(result.days)) throw new Error('dashboard_unavailable');
            if (mountedRef.current && currentKeyRef.current === key && sequence === sequenceRef.current) setSnapshot({ key, data: result, loading: false, error: false });
        } catch {
            if (mountedRef.current && currentKeyRef.current === key && sequence === sequenceRef.current) {
                setSnapshot(previous => ({ key, data: previous?.key === key ? previous.data : null, loading: false, error: true }));
            }
        }
    }, [key, month]);
    useEffect(() => {
        mountedRef.current = true;
        return () => { mountedRef.current = false; sequenceRef.current += 1; };
    }, []);
    useEffect(() => {
        void refresh();
        let timer;
        const schedule = () => {
            window.clearTimeout(timer);
            timer = window.setTimeout(() => void refresh(), 250);
        };
        const onVisible = () => { if (document.visibilityState === 'visible') schedule(); };
        const unsubscribeReading = window.electronAPI?.onRecentReadingChanged?.(schedule);
        const unsubscribeLists = window.electronAPI?.onReadingListsChanged?.(schedule);
        window.addEventListener('focus', schedule);
        document.addEventListener('visibilitychange', onVisible);
        return () => {
            sequenceRef.current += 1;
            window.clearTimeout(timer);
            unsubscribeReading?.();
            unsubscribeLists?.();
            window.removeEventListener('focus', schedule);
            document.removeEventListener('visibilitychange', onVisible);
        };
    }, [refresh]);
    const saveGoal = useCallback(async goal => {
        const result = await window.electronAPI?.readingLists?.({ operation: 'dashboard-goal', month, goal });
        if (!result?.success) throw new Error('goal_save_failed');
        await refresh();
    }, [month, refresh]);
    const current = snapshot?.key === key ? snapshot : null;
    return { data: current?.data || null, loading: current?.loading ?? true, error: current?.error || false, refresh, saveGoal };
}
