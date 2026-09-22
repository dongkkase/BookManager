import parse from 'css-tree/parser';
import walk from 'css-tree/walker';
import generate from 'css-tree/generator';
import { ident } from 'css-tree/utils';
import { tokenize, tokenTypes as T } from 'css-tree/tokenizer';

// Drafts remain saveable. Only parsed, self-contained CSS reaches a preview or EPUB.
export function inspectCss(source = '') {
    try {
        const stack = [];
        const fail = offset => {
            const before = source.slice(0, offset);
            throw Object.assign(new Error('CSS_INVALID'), { line: before.split('\n').length, column: offset - before.lastIndexOf('\n') });
        };
        tokenize(source, (type, start, end) => {
            if ([T.LeftCurlyBracket, T.LeftSquareBracket, T.LeftParenthesis, T.Function].includes(type)) stack.push({ type: type === T.Function ? T.LeftParenthesis : type, start });
            if ([T.RightCurlyBracket, T.RightSquareBracket, T.RightParenthesis].includes(type) && stack.pop()?.type !== type - 1) fail(start);
            if ([T.BadString, T.BadUrl].includes(type) || (type === T.Comment && !source.slice(start, end).endsWith('*/')) || (type === T.String && source[end - 1] !== source[start])) fail(start);
        });
        if (stack.length) fail(stack.at(-1).start);
        const tree = parse(source, { positions: true, parseCustomProperty: true, onParseError: error => { throw error; } });
        walk(tree, node => {
            if (node.type === 'Declaration' && node.value.type === 'Value' && node.value.children.isEmpty && !node.property.startsWith('--')) fail(node.loc.start.offset);
            if (node.type === 'Raw' || node.type === 'Url' ||
                (node.type === 'Atrule' && !['media', 'supports', 'page'].includes(ident.decode(node.name).toLowerCase())) ||
                (node.type === 'Function' && /^(url|src|image|image-set|-webkit-image-set|expression)$/i.test(ident.decode(node.name)))) {
                throw Object.assign(new Error('CSS_RESOURCE'), { line: node.loc?.start.line, column: node.loc?.start.column });
            }
        });
        return { css: generate(tree), error: null };
    } catch (error) {
        return { css: '', error: { code: error.message === 'CSS_RESOURCE' ? 'CSS_RESOURCE' : 'CSS_INVALID', line: error.line || 1, column: error.column || 1 } };
    }
}

export function safeCss(source) {
    return inspectCss(source).css;
}

export function remapCssIds(source, replacements) {
    if (!source || !replacements.size) return source;
    const checked = inspectCss(source);
    if (checked.error) throw Object.assign(new Error('MERGE_CSS_INVALID'), { code: 'MERGE_CSS_INVALID' });
    const tree = parse(source);
    walk(tree, node => {
        if (node.type === 'IdSelector' && replacements.has(ident.decode(node.name))) node.name = replacements.get(ident.decode(node.name));
        if (node.type === 'AttributeSelector' && ident.decode(node.name.name) === 'id' && node.matcher === '=' && node.value) {
            const value = node.value.type === 'String' ? node.value.value : ident.decode(node.value.name);
            if (replacements.has(value)) node.value = { type: 'String', value: replacements.get(value) };
        }
    });
    return generate(tree);
}
