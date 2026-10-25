export const DEFAULT_HIGHLIGHT_COLOR = 'yellow';

// Keep these persisted IDs and marker values aligned with Readive's highlight palette.
export const HIGHLIGHT_COLORS = Object.freeze([
    { id: 'yellow', label: '노랑', hex: '#FFE255', opacity: 0.58 },
    { id: 'green', label: '초록', hex: '#5BD67D', opacity: 0.5 },
    { id: 'blue', label: '파랑', hex: '#52A9FF', opacity: 0.52 },
    { id: 'pink', label: '분홍', hex: '#FF6FB5', opacity: 0.5 },
    { id: 'purple', label: '보라', hex: '#B57BFF', opacity: 0.5 },
    { id: 'orange', label: '주황', hex: '#FFAB52', opacity: 0.5 },
    { id: 'red', label: '빨강', hex: '#FF6B6B', opacity: 0.5 },
    { id: 'olive', label: '올리브', hex: '#A8B95F', opacity: 0.5 },
    { id: 'cyan', label: '청록', hex: '#4DD0E1', opacity: 0.5 },
    { id: 'gray', label: '회색', hex: '#AEB4BE', opacity: 0.5 },
].map(color => Object.freeze({ ...color, labelKey: `viewer.context.highlight_color_${color.id}` })));

export const HIGHLIGHT_COLOR_IDS = Object.freeze(HIGHLIGHT_COLORS.map(color => color.id));
export const ANNOTATION_COLORS = Object.freeze([...HIGHLIGHT_COLOR_IDS, 'underline', 'strikethrough']);

export function normalizeHighlightColor(value) {
    const color = String(value || '').trim();
    return ANNOTATION_COLORS.includes(color) ? color : DEFAULT_HIGHLIGHT_COLOR;
}

export function annotationStyle(value) {
    const id = normalizeHighlightColor(value);
    return id === 'underline' || id === 'strikethrough' ? id : 'highlight';
}

export function highlightBackground(value) {
    const id = normalizeHighlightColor(value);
    if (annotationStyle(id) !== 'highlight') return 'transparent';
    const color = HIGHLIGHT_COLORS.find(item => item.id === id);
    const rgb = color.hex.slice(1).match(/../g).map(part => parseInt(part, 16));
    return `rgba(${rgb.join(', ')}, ${color.opacity})`;
}
