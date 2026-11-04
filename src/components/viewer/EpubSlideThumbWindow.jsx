import React, { useLayoutEffect, useRef, useState } from 'react';

const OVERSCAN_GROUPS = 4;

export default function EpubSlideThumbWindow({ items, spread, pageIndex, renderGroup }) {
    const trackRef = useRef(null);
    const [range, setRange] = useState({ first: 0, end: 0, offset: 0 });
    const step = spread ? 2 : 1;
    const count = Math.ceil(items.length / step);
    const activeGroup = Math.floor(pageIndex / step);
    const singleLast = items.length % step !== 0;

    useLayoutEffect(() => {
        const track = trackRef.current;
        const strip = track.parentElement;
        const style = getComputedStyle(strip);
        const singleWidth = parseFloat(style.getPropertyValue('--viewer-slide-thumb-width'));
        const width = spread ? parseFloat(style.getPropertyValue('--viewer-reader-spread-width')) : singleWidth;
        const stride = width + parseFloat(style.columnGap);
        const lastWidth = singleLast ? singleWidth : width;
        track.style.width = `${count ? (count - 1) * stride + lastWidth : 0}px`;

        const update = () => {
            const left = strip.scrollLeft - track.offsetLeft;
            const first = Math.max(0, Math.floor(left / stride) - OVERSCAN_GROUPS);
            const end = Math.min(count, Math.ceil((left + strip.clientWidth) / stride) + OVERSCAN_GROUPS);
            const offset = first * stride;
            setRange(previous => previous.first === first && previous.end === end && previous.offset === offset
                ? previous : { first, end, offset });
        };
        const activeWidth = activeGroup === count - 1 ? lastWidth : width;
        strip.scrollLeft = track.offsetLeft + activeGroup * stride + (activeWidth - strip.clientWidth) / 2;
        update();
        strip.addEventListener('scroll', update, { passive: true });
        const observer = new ResizeObserver(update);
        observer.observe(strip);
        return () => {
            strip.removeEventListener('scroll', update);
            observer.disconnect();
        };
    }, [activeGroup, count, singleLast, spread]);

    const thumbs = [];
    for (let group = range.first; group < Math.min(count, range.end); group += 1) {
        const groupStartIndex = group * step;
        const pageIndexes = spread && groupStartIndex + 1 < items.length
            ? [groupStartIndex, groupStartIndex + 1] : [groupStartIndex];
        thumbs.push(renderGroup({ groupStartIndex, pageIndexes, items: pageIndexes.map(index => items[index]) }));
    }
    return (
        <div ref={trackRef} className="viewer-epub-slide-track" style={{ paddingInlineStart: range.offset }}>
            {thumbs}
        </div>
    );
}
