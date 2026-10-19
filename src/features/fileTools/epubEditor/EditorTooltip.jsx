import React, { useEffect, useId, useRef, useState } from 'react';
import { TooltipPopup } from '../../../components/TooltipLayer';

export default function EditorTooltip({ label, children }) {
    const id = useId();
    const anchor = useRef(null);
    const [open, setOpen] = useState(false);
    const hide = () => setOpen(false);
    useEffect(() => {
        if (!open) return;
        const dismissEvents = ['scroll', 'resize', 'pointerdown', 'keydown', 'blur'];
        for (const name of dismissEvents) window.addEventListener(name, hide, true);
        return () => { for (const name of dismissEvents) window.removeEventListener(name, hide, true); };
    }, [open]);
    return <span className="ee-tooltip-anchor" ref={anchor} onMouseEnter={() => setOpen(true)} onMouseLeave={hide} onFocus={() => setOpen(true)} onBlur={hide}>
        {children}
        {open && <TooltipPopup target={anchor.current.firstElementChild} label={label} id={id} />}
    </span>;
}
