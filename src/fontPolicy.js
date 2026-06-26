export function fontFamilyForConfig(fontFamily = 'Default') {
    if (!fontFamily || fontFamily === 'Default') {
        return "'Noto Sans KR', 'Jua', 'Malgun Gothic', 'Segoe UI', 'Yu Gothic UI', 'Segoe UI Emoji', sans-serif";
    }
    const safeFamily = String(fontFamily).replace(/['\\]/g, '');
    return `'${safeFamily}', 'Noto Sans KR', 'Malgun Gothic', 'Segoe UI Emoji', sans-serif`;
}

export function fontVarsForConfig(config = {}) {
    const scale = Math.max(0.8, Math.min(1.55, Number(config?.font_scale || 100) / 100));
    const size = value => `${Math.max(8, Math.round(value * scale))}px`;
    return {
        '--font-primary': fontFamilyForConfig(config?.font_family),
        '--font-scale': String(scale),
        '--font-3xs': size(9),
        '--font-2xs': size(10),
        '--font-xs': size(11),
        '--font-sm': size(12),
        '--font-base': size(13),
        '--font-md': size(14),
        '--font-15': size(15),
        '--font-lg': size(16),
        '--font-17': size(17),
        '--font-xl': size(18),
        '--font-2xl': size(20),
        '--font-3xl': size(23),
        '--font-4xl': size(24),
        '--font-5xl': size(25),
        '--font-display': size(48),
        '--control-height-sm': size(24),
        '--control-height': size(28),
        '--control-height-lg': size(34),
        '--checkbox-size': size(16),
        '--table-cell-y': size(6),
    };
}
