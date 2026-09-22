import React, { useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { placeContextToolbar } from './contextTools';

export default function EditorTooltip({ label, children }) {
    const id = useId();
    const anchor = useRef(null);
    const popup = useRef(null);
    const timer = useRef(null);
    const [open, setOpen] = useState(false);
    const [position, setPosition] = useState(null);
    const hide = () => { clearTimeout(timer.current); setOpen(false); };
    useEffect(() => () => clearTimeout(timer.current), []);
    useEffect(() => {
        if (!open) return;
        for (const name of ['scroll', 'resize', 'pointerdown', 'keydown']) window.addEventListener(name, hide, true);
        return () => { for (const name of ['scroll', 'resize', 'pointerdown', 'keydown']) window.removeEventListener(name, hide, true); };
    }, [open]);
    useLayoutEffect(() => {
        if (!open || !popup.current) { setPosition(null); return; }
        setPosition(placeContextToolbar(anchor.current.getBoundingClientRect(), { top: 8, left: 8, right: window.innerWidth - 8, bottom: window.innerHeight - 8 }, popup.current.getBoundingClientRect()));
    }, [open, label]);
    return <span className="ee-tooltip-anchor" ref={anchor} onMouseEnter={() => { clearTimeout(timer.current); timer.current = setTimeout(() => setOpen(true), 250); }} onMouseLeave={hide} onFocus={() => setOpen(true)} onBlur={hide}>
        {React.cloneElement(children, { 'aria-describedby': open ? id : undefined })}
        {open && createPortal(<span ref={popup} id={id} role="tooltip" className="ee-tooltip" style={{ left: position?.left, top: position?.top, visibility: position ? 'visible' : 'hidden' }}>{label}</span>, document.body)}
    </span>;
}
