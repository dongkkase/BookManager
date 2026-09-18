import { cleanText } from '../textCleanerPolicy.js';
import { inspectTextQuotes } from '../textCleanerQuotes.js';
import { buildTextVisualLayout, countTextLines, findTextMatches } from '../textCleanerNavigation.js';

function createWrapLayoutOptions(wrapMetrics = {}) {
    const columns = Math.max(1, Math.floor(Number(wrapMetrics.columns) || 80));
    const wrapWidth = Number(wrapMetrics.wrapWidth);
    const measuredWidths = new Map(wrapMetrics.characterWidths || []);
    if (wrapWidth > 0 && measuredWidths.size > 0) {
        const spaceWidth = Math.max(1, measuredWidths.get(' ') || 1);
        const tabWidth = spaceWidth * Math.max(1, Number(wrapMetrics.tabSize) || 4);
        const measureCharacter = (character, rowWidth) => {
            if (character === '\t') {
                const remainder = rowWidth % tabWidth;
                return remainder === 0 ? tabWidth : tabWidth - remainder;
            }
            return measuredWidths.get(character) || spaceWidth;
        };
        return { columns, wrapWidth, measureCharacter };
    }
    if (!(wrapWidth > 0) || typeof OffscreenCanvas === 'undefined') return columns;

    const canvas = new OffscreenCanvas(1, 1);
    const context = canvas.getContext('2d');
    if (!context) return columns;
    context.font = wrapMetrics.font || '14px monospace';
    const widthCache = new Map();
    const spaceWidth = Math.max(1, context.measureText(' ').width);
    const tabWidth = spaceWidth * Math.max(1, Number(wrapMetrics.tabSize) || 4);
    const measureCharacter = (character, rowWidth) => {
        if (character === '\t') {
            const remainder = rowWidth % tabWidth;
            return remainder === 0 ? tabWidth : tabWidth - remainder;
        }
        let width = widthCache.get(character);
        if (width === undefined) {
            width = context.measureText(character).width;
            widthCache.set(character, width);
        }
        return width;
    };
    return { columns, wrapWidth, measureCharacter };
}

function uniqueLayoutCharacters(...texts) {
    const characters = new Set([' ']);
    for (const text of texts) {
        for (const character of text || '') {
            if (character !== '\n' && character !== '\r' && character !== '\t') {
                characters.add(character);
            }
        }
    }
    return Array.from(characters);
}

function buildLayouts(sourceText, resultText, wrapMetrics) {
    const layoutOptions = createWrapLayoutOptions(wrapMetrics);
    return {
        sourceLayout: buildTextVisualLayout(sourceText, layoutOptions),
        resultLayout: buildTextVisualLayout(resultText, layoutOptions),
    };
}

function layoutTransferList(sourceLayout, resultLayout) {
    return [
        sourceLayout.lineStarts.buffer,
        sourceLayout.lineEnds.buffer,
        sourceLayout.rowStarts.buffer,
        sourceLayout.visualRowOffsets.buffer,
        sourceLayout.canonicalStarts.buffer,
        resultLayout.lineStarts.buffer,
        resultLayout.lineEnds.buffer,
        resultLayout.rowStarts.buffer,
        resultLayout.visualRowOffsets.buffer,
        resultLayout.canonicalStarts.buffer,
    ];
}

function postResult(result, text, wrapMetrics) {
    const layouts = buildLayouts(text, result.text, wrapMetrics);
    result.sourceLayout = layouts.sourceLayout;
    result.resultLayout = layouts.resultLayout;
    self.postMessage({ ok: true, result }, layoutTransferList(
        result.sourceLayout,
        result.resultLayout,
    ));
}

let pendingAnalysis = null;
let pendingLayout = null;

self.onmessage = event => {
    const message = event.data || {};
    if (message.type === 'resultReview') {
        try {
            self.postMessage({
                type: 'resultReviewResult', requestId: message.requestId, ok: true,
                lineCount: countTextLines(message.text),
                query: message.query,
                search: findTextMatches(message.text, message.query),
                review: message.inspectQuotes ? inspectTextQuotes(message.text) : null,
            });
        } catch (error) {
            self.postMessage({ type: 'resultReviewResult', requestId: message.requestId, ok: false });
        }
        return;
    }
    if (message.type === 'quoteReview') {
        try {
            self.postMessage({
                type: 'quoteReviewResult', requestId: message.requestId, ok: true,
                review: inspectTextQuotes(message.text),
            });
        } catch (error) {
            self.postMessage({ type: 'quoteReviewResult', requestId: message.requestId, ok: false });
        }
        return;
    }
    if (message.type === 'characterWidths') {
        if (message.operation === 'layout') {
            if (!pendingLayout || pendingLayout.requestId !== message.requestId) return;
            const { requestId, sourceText, resultText, wrapMetrics } = pendingLayout;
            pendingLayout = null;
            try {
                const layouts = buildLayouts(sourceText, resultText, {
                    ...wrapMetrics,
                    characterWidths: message.widths,
                });
                self.postMessage({
                    type: 'layoutResult',
                    ok: true,
                    requestId,
                    ...layouts,
                }, layoutTransferList(layouts.sourceLayout, layouts.resultLayout));
            } catch (error) {
                self.postMessage({
                    type: 'layoutResult',
                    ok: false,
                    requestId,
                    error: error instanceof Error ? error.message : String(error),
                });
            }
            return;
        }
        if (!pendingAnalysis || pendingAnalysis.analysisId !== message.analysisId) return;
        const { result, text, wrapMetrics } = pendingAnalysis;
        pendingAnalysis = null;
        try {
            postResult(result, text, {
                ...wrapMetrics,
                characterWidths: message.widths,
            });
        } catch (error) {
            self.postMessage({
                ok: false,
                error: error instanceof Error ? error.message : String(error),
            });
        }
        return;
    }

    if (message.type === 'layout') {
        const {
            requestId = 0,
            sourceText = '',
            resultText = '',
            wrapMetrics = {},
        } = message;
        pendingLayout = { requestId, sourceText, resultText, wrapMetrics };
        self.postMessage({
            type: 'measureCharacters',
            operation: 'layout',
            requestId,
            characters: uniqueLayoutCharacters(sourceText, resultText),
        });
        return;
    }

    const { text = '', options = {}, wrapMetrics = {}, analysisId = 0 } = message;
    try {
        const result = cleanText(text, options);
        result.quoteReview = inspectTextQuotes(result.text);
        pendingAnalysis = { analysisId, result, text, wrapMetrics };
        self.postMessage({
            type: 'measureCharacters',
            operation: 'analysis',
            analysisId,
            characters: uniqueLayoutCharacters(text),
        });
    } catch (error) {
        self.postMessage({
            ok: false,
            error: error instanceof Error ? error.message : String(error),
        });
    }
};
