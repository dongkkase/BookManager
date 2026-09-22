export const MAX_PARAGRAPH_INDENT = 8;
export const PARAGRAPH_INDENT_STEP = 2;
export const MAX_FIRST_LINE_INDENT = 3;

export function validIndentLevel(value) {
    return Number.isInteger(value) && value >= 0 && value <= MAX_PARAGRAPH_INDENT;
}

export function validFirstLineIndent(value) {
    return value === null || (typeof value === 'number' && Number.isFinite(value) && Math.abs(value) <= MAX_FIRST_LINE_INDENT);
}

export function paragraphIndentCss(attrs = {}) {
    const level = validIndentLevel(attrs.indentLevel) ? attrs.indentLevel : 0;
    const firstLine = validFirstLineIndent(attrs.firstLineIndent) ? attrs.firstLineIndent : null;
    const margin = level * PARAGRAPH_INDENT_STEP + Math.max(0, -(firstLine || 0));
    return [margin > 0 && `margin-left:${margin}em`, firstLine !== null && `text-indent:${firstLine}em`].filter(Boolean).join(';');
}
