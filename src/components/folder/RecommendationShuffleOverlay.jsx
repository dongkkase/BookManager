import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { animate } from 'motion/mini';
import { CoverArtwork } from '../CoverArtwork';
import { FaIcon } from '../FaIcon';
import { useReducedMotion } from '../../hooks/useReducedMotion';
import { dashboardFilePath } from '../../readingDashboardState';
import '../../styles/RecommendationShuffleOverlay.css';

const SEARCH_DURATION = 2200;
const LIFT_DURATION = 1050;
const HOLD_DURATION = 700;
const LAND_DURATION = 1000;
const EXIT_DURATION = 160;
const COLUMN_COUNT = 9;
const ROW_COUNT = 6;
const SAMPLE_SIZE = COLUMN_COUNT * ROW_COUNT;
const CENTER_TRANSFORM = 'translate(-50%, -50%) translate3d(0px, 0px, 0px) rotateX(0deg) rotateZ(0deg) scale(1)';

function thumbnailSample(files, fallback) {
    const sample = [];
    let count = 0;
    for (const file of files) {
        if (!file?.cover || file.isDirectory || file.is_folder || file.exists === false) continue;
        count += 1;
        const index = sample.length < SAMPLE_SIZE ? sample.length : Math.floor(Math.random() * count);
        if (index < SAMPLE_SIZE) sample[index] = file;
    }
    return sample.length ? sample : [fallback || {}];
}

function visibleTiles(plane, selector = '.recommendation-shuffle-tile', leadSeconds = 0) {
    return [...plane.querySelectorAll(selector)].filter(element => {
        const rect = element.getBoundingClientRect();
        const track = element.parentElement;
        const travel = (Number(track.dataset.distance) || 0) / (Number(track.dataset.duration) || 1)
            * leadSeconds * (track.dataset.direction === 'down' ? 1 : -1);
        const x = rect.left + rect.width / 2 + Math.sin(32 * Math.PI / 180) * travel;
        const y = rect.top + rect.height / 2 + Math.cos(38 * Math.PI / 180) * Math.cos(32 * Math.PI / 180) * travel;
        return x > 40 && x < innerWidth - 40 && y > 40 && y < innerHeight - 40;
    });
}

function randomVisibleSlot(plane, previous, leadSeconds) {
    const visible = visibleTiles(plane, '.recommendation-shuffle-tile', leadSeconds);
    const differentColumns = visible.filter(element => Number(element.dataset.column) !== previous?.column);
    const candidates = differentColumns.length ? differentColumns : visible;
    const tile = candidates[Math.floor(Math.random() * candidates.length)];
    return tile ? { column: Number(tile.dataset.column), row: Number(tile.dataset.row) } : { column: 3, row: 1 };
}

export function RecommendationShuffleOverlay({ files, currentFile, prepare, commit, cancel, onClose, returnFocusElement, destinationRef, lastOriginRef, t }) {
    const reducedMotion = useReducedMotion();
    const reducedRef = useRef(reducedMotion);
    const callbacksRef = useRef({ prepare, commit, cancel, onClose });
    const dialogRef = useRef(null);
    const sceneRef = useRef(null);
    const wallRef = useRef(null);
    const planeRef = useRef(null);
    const messageRef = useRef(null);
    const selectedRef = useRef(null);
    const captionRef = useRef(null);
    const controlsRef = useRef(new Set());
    const waitsRef = useRef(new Map());
    const closedRef = useRef(false);
    const phaseRef = useRef('searching');
    const destinationElementRef = useRef(null);
    const [sample] = useState(() => thumbnailSample(files, currentFile));
    const [phase, setPhase] = useState('searching');
    const [selectedFile, setSelectedFile] = useState(null);
    const [selectionSlot, setSelectionSlot] = useState(null);
    const [message, setMessage] = useState('');
    callbacksRef.current = { prepare, commit, cancel, onClose };
    reducedRef.current = reducedMotion;

    const changePhase = next => {
        phaseRef.current = next;
        setPhase(next);
    };
    const destinationTransform = () => {
        const cover = destinationElementRef.current;
        const selected = selectedRef.current;
        if (!cover?.isConnected || !selected) return CENTER_TRANSFORM;
        const rect = cover.getBoundingClientRect();
        const x = rect.left + rect.width / 2 - innerWidth / 2;
        const y = rect.top + rect.height / 2 - innerHeight / 2;
        return `translate(-50%, -50%) translate3d(${x}px, ${y}px, 0px) rotateX(0deg) rotateZ(0deg) scale(${rect.width / selected.offsetWidth}, ${rect.height / selected.offsetHeight})`;
    };

    const stopMotion = () => {
        controlsRef.current.forEach(control => control.cancel());
        controlsRef.current.clear();
    };
    const releaseWaits = () => {
        waitsRef.current.forEach((resolve, timer) => { window.clearTimeout(timer); resolve(); });
        waitsRef.current.clear();
    };
    const settleMotion = () => {
        stopMotion();
        const landing = ['landing', 'committing', 'exiting'].includes(phaseRef.current);
        const revealed = landing || phaseRef.current === 'revealing';
        if (selectedRef.current) selectedRef.current.style.transform = landing ? destinationTransform() : CENTER_TRANSFORM;
        if (revealed) {
            if (messageRef.current) messageRef.current.style.opacity = '0';
            if (wallRef.current) wallRef.current.style.opacity = '0.22';
            if (captionRef.current) captionRef.current.style.opacity = landing ? '0' : '1';
        }
        if (sceneRef.current) sceneRef.current.style.opacity = landing ? '0' : '1';
        releaseWaits();
    };
    const close = () => {
        if (closedRef.current) return;
        closedRef.current = true;
        stopMotion();
        releaseWaits();
        callbacksRef.current.cancel();
        callbacksRef.current.onClose();
    };

    useLayoutEffect(() => {
        const dialog = dialogRef.current;
        const previousFocus = returnFocusElement || document.activeElement;
        dialog.showModal();
        dialog.querySelector('button')?.focus({ preventScroll: true });
        return () => {
            dialog.close();
            queueMicrotask(() => {
                if (previousFocus?.isConnected) previousFocus.focus?.({ preventScroll: true });
            });
        };
    }, []);

    useEffect(() => {
        if (!reducedMotion) return;
        settleMotion();
        planeRef.current?.querySelectorAll('.recommendation-shuffle-track').forEach(track => { track.style.transform = 'none'; });
    }, [reducedMotion]);

    useEffect(() => {
        let disposed = false;
        let halted = false;
        let pickedElement;
        let previousDestinationVisibility;
        let deadline;
        const live = () => !disposed && !halted && !closedRef.current;
        const wait = milliseconds => new Promise(resolve => {
            const timer = window.setTimeout(() => { waitsRef.current.delete(timer); resolve(); }, milliseconds);
            waitsRef.current.set(timer, resolve);
        });
        const play = (element, frames, options) => {
            if (!element || !live() || reducedRef.current) return;
            const control = animate(element, frames, options);
            controlsRef.current.add(control);
            return control;
        };
        const settleOnResize = () => settleMotion();
        const showMessage = key => {
            if (!live()) return;
            halted = true;
            window.clearTimeout(deadline);
            stopMotion();
            callbacksRef.current.cancel();
            setMessage(key);
            changePhase('message');
            if (messageRef.current) messageRef.current.style.opacity = '1';
            if (wallRef.current) wallRef.current.style.opacity = '0.35';
            if (sceneRef.current) sceneRef.current.style.opacity = '1';
        };
        const run = async () => {
            const tracks = [...planeRef.current.querySelectorAll('.recommendation-shuffle-track')];
            const gap = parseFloat(getComputedStyle(tracks[0]).gap) || 0;
            const distance = (tracks[0].scrollHeight + gap) / 2;
            planeRef.current.style.height = `${distance}px`;
            tracks.forEach((track, index) => {
                const from = index % 2 ? -distance : 0;
                const to = index % 2 ? 0 : -distance;
                const duration = 50 + index % 3 * 6;
                track.dataset.distance = String(distance);
                track.dataset.duration = String(duration);
                if (!reducedRef.current) {
                    track.style.transform = `translateY(${from}px)`;
                    play(track, { transform: [`translateY(${from}px)`, `translateY(${to}px)`] }, {
                        duration, repeat: Infinity, ease: 'linear',
                    });
                }
            });
            deadline = window.setTimeout(() => {
                showMessage('reading_lists.dashboard_recommendation_shuffle_failed');
                releaseWaits();
            }, 15000);
            try {
                const result = await callbacksRef.current.prepare();
                if (!live()) return;
                if (result.status === 'cancelled') { close(); return; }
                if (result.status !== 'ready') {
                    showMessage('reading_lists.dashboard_recommendation_no_alternative');
                    return;
                }
                setSelectionSlot(randomVisibleSlot(planeRef.current, lastOriginRef.current, reducedRef.current ? 0 : (SEARCH_DURATION + 50) / 1000));
                setSelectedFile(result.file);
                await wait(50);
                if (!live()) return;
                wallRef.current.style.opacity = '1';
                play(wallRef.current, { opacity: [0, 1] }, { duration: 0.45, ease: 'easeOut' });
                await wait(reducedRef.current ? 120 : SEARCH_DURATION);
                if (!live()) return;
                const selected = selectedRef.current;
                const target = selected.getBoundingClientRect();
                const candidates = visibleTiles(planeRef.current, '[data-shuffle-candidate="true"]');
                pickedElement = candidates[Math.floor(Math.random() * candidates.length)];
                const origin = pickedElement?.getBoundingClientRect();
                const x = origin ? origin.left + origin.width / 2 - innerWidth / 2 : 0;
                const y = origin ? origin.top + origin.height / 2 - innerHeight / 2 : 0;
                const scale = pickedElement && target.width ? pickedElement.offsetWidth / target.width : 0.7;
                const from = `translate(-50%, -50%) translate3d(${x}px, ${y}px, 0px) rotateX(38deg) rotateZ(-32deg) scale(${scale})`;
                selected.style.transform = reducedRef.current ? CENTER_TRANSFORM : from;
                if (pickedElement) {
                    pickedElement.style.visibility = 'hidden';
                    lastOriginRef.current = { column: Number(pickedElement.dataset.column), row: Number(pickedElement.dataset.row) };
                    selected.dataset.originColumn = pickedElement.dataset.column;
                    selected.dataset.originRow = pickedElement.dataset.row;
                }
                selected.dataset.originX = String(x);
                selected.dataset.originY = String(y);
                changePhase('revealing');
                if (reducedRef.current) {
                    messageRef.current.style.opacity = '0';
                    wallRef.current.style.opacity = '0.22';
                } else {
                    play(messageRef.current, { opacity: [1, 0] }, { duration: 0.25 });
                    play(wallRef.current, { opacity: [1, 0.22] }, { duration: 0.8 });
                    play(selected, { transform: [from, CENTER_TRANSFORM] }, { duration: LIFT_DURATION / 1000, ease: [0.18, 0.8, 0.2, 1] });
                    await wait(LIFT_DURATION);
                }
                if (!live()) return;
                selected.style.transform = CENTER_TRANSFORM;
                if (reducedRef.current) captionRef.current.style.opacity = '1';
                else play(captionRef.current, { opacity: [0, 1] }, { duration: 0.25 });
                await wait(reducedRef.current ? 180 : HOLD_DURATION);
                if (!live()) return;
                destinationElementRef.current = destinationRef.current?.querySelector('.reading-dashboard-cover');
                const destination = destinationElementRef.current;
                if (destination) {
                    previousDestinationVisibility = destination.style.visibility;
                    destination.style.visibility = 'hidden';
                }
                changePhase('landing');
                const landingTransform = destinationTransform();
                let landingMotion;
                if (!reducedRef.current) {
                    play(sceneRef.current, { opacity: [1, 0] }, { duration: 0.65, ease: 'easeInOut' });
                    play(captionRef.current, { opacity: [1, 0] }, { duration: 0.2 });
                    landingMotion = play(selected, { transform: [CENTER_TRANSFORM, landingTransform], borderRadius: ['6px', '2px'] }, {
                        duration: LAND_DURATION / 1000, ease: [0.65, 0, 0.3, 1],
                    });
                    await wait(LAND_DURATION);
                }
                if (!live()) return;
                // The timer can finish before the animation presents its final frame.
                landingMotion?.cancel();
                selected.style.transform = destinationTransform();
                selected.style.borderRadius = '2px';
                sceneRef.current.style.opacity = '0';
                captionRef.current.style.opacity = '0';
                changePhase('committing');
                const committed = await callbacksRef.current.commit(result);
                if (!live()) return;
                if (!committed) {
                    showMessage('reading_lists.dashboard_recommendation_shuffle_failed');
                    return;
                }
                window.clearTimeout(deadline);
                await wait(40);
                if (!live()) return;
                stopMotion();
                selected.style.transform = destinationTransform();
                selected.style.borderRadius = '2px';
                messageRef.current.style.opacity = '0';
                captionRef.current.style.opacity = '0';
                sceneRef.current.style.opacity = '0';
                if (destination?.isConnected) destination.style.visibility = previousDestinationVisibility;
                changePhase('exiting');
                if (!reducedRef.current) {
                    play(dialogRef.current, { opacity: [1, 0] }, { duration: EXIT_DURATION / 1000, ease: 'easeOut' });
                    await wait(EXIT_DURATION);
                }
                if (live()) close();
            } catch {
                showMessage('reading_lists.dashboard_recommendation_shuffle_failed');
            }
        };
        void run().catch(() => showMessage('reading_lists.dashboard_recommendation_shuffle_failed'));
        window.addEventListener('resize', settleOnResize);
        return () => {
            disposed = true;
            window.clearTimeout(deadline);
            window.removeEventListener('resize', settleOnResize);
            stopMotion();
            releaseWaits();
            if (pickedElement) pickedElement.style.visibility = '';
            if (destinationElementRef.current?.isConnected && previousDestinationVisibility !== undefined) {
                destinationElementRef.current.style.visibility = previousDestinationVisibility;
            }
            callbacksRef.current.cancel();
        };
    }, []);

    const title = selectedFile?.title || selectedFile?.name || '';
    return createPortal(<dialog ref={dialogRef} className="recommendation-shuffle-overlay" data-folder-modal
        style={{ '--shuffle-columns': COLUMN_COUNT }}
        data-phase={phase} data-reduced-motion={reducedMotion ? 'true' : 'false'} aria-modal="true"
        aria-label={t('reading_lists.dashboard_new_recommendation')}
        onCancel={event => { event.preventDefault(); close(); }} onKeyDown={event => {
            event.stopPropagation();
            if (event.key === 'Escape') { event.preventDefault(); close(); }
        }}>
        <div className="recommendation-shuffle-scene" ref={sceneRef} aria-hidden="true">
            <div className="recommendation-shuffle-wall" ref={wallRef}>
                <div className="recommendation-shuffle-plane" ref={planeRef}>
                    {Array.from({ length: COLUMN_COUNT }, (_, column) => <div className="recommendation-shuffle-column" key={column}>
                        <div className="recommendation-shuffle-track" data-direction={column % 2 ? 'down' : 'up'}>
                            {Array.from({ length: ROW_COUNT * 2 }, (_, row) => {
                                const candidate = Boolean(selectedFile) && column === selectionSlot?.column && row % ROW_COUNT === selectionSlot?.row;
                                const file = candidate ? selectedFile : sample[(column * ROW_COUNT + row % ROW_COUNT) % sample.length];
                                return <div key={row} className="recommendation-shuffle-tile" data-column={column} data-row={row % ROW_COUNT}
                                    data-shuffle-candidate={candidate ? 'true' : undefined}>
                                    <CoverArtwork src={file.cover} alt="" fallbackAlt="" smooth />
                                </div>;
                            })}
                        </div>
                    </div>)}
                </div>
            </div>
            <div className="recommendation-shuffle-shade" />
        </div>
        <button className="recommendation-shuffle-close" type="button" onClick={close}
            aria-label={t(phase === 'message' ? 'reading_lists.dashboard_recommendation_close' : 'reading_lists.dashboard_recommendation_cancel')}>
            <FaIcon name="xmark" size={17} />
        </button>
        <div ref={messageRef} className="recommendation-shuffle-message" role="status" aria-live="polite"
            aria-hidden={phase !== 'searching' && phase !== 'message'}>
            <span className="recommendation-shuffle-eyebrow"><FaIcon name="shuffle" size={14} />{t('reading_lists.dashboard_recommendation')}</span>
            <h2>{t(message || 'reading_lists.dashboard_finding_recommendation')}</h2>
            <span className="recommendation-shuffle-rule" aria-hidden="true" />
            {phase === 'message' && <button type="button" className="recommendation-shuffle-dismiss" onClick={close}>{t('reading_lists.dashboard_recommendation_close')}</button>}
        </div>
        {selectedFile && <>
            <div className="recommendation-shuffle-selected" data-file-path={dashboardFilePath(selectedFile)} ref={selectedRef} aria-hidden="true">
                <CoverArtwork src={selectedFile.cover} alt="" fallbackAlt="" smooth />
            </div>
            <div ref={captionRef} className="recommendation-shuffle-caption" role="status" aria-live="polite"
                aria-hidden={phase !== 'revealing'}>
                <span>{t('reading_lists.dashboard_recommendation_found')}</span>
                <strong>{title}</strong>
                {selectedFile.writer && <span>{selectedFile.writer}</span>}
            </div>
        </>}
    </dialog>, document.body);
}
