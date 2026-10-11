const NUMBER = String.raw`\d+(?:\.\d+)?`;
const RANGE = String.raw`[-~～–—]`;
const UNIT = String.raw`(?:화|권|회|편|巻|話)`;
const VOLUME = String.raw`(?:vol(?:ume)?\.?|ch(?:apter)?\.?|ep(?:isode)?\.?)`;
const EPISODE = String.raw`(?:제|第)?\s*${NUMBER}\s*${UNIT}(?:\s*${RANGE}\s*(?:제|第)?\s*${NUMBER}\s*${UNIT}?)?`;
const NUMBER_RANGE = String.raw`(?:제|第)?\s*${NUMBER}\s*${RANGE}\s*${NUMBER}\s*${UNIT}?`;
const ENGLISH_VOLUME = String.raw`(?<![A-Za-z])${VOLUME}\s*${NUMBER}(?:\s*${RANGE}\s*(?:${VOLUME}\s*)?${NUMBER})?`;
const SUFFIX = new RegExp(String.raw`[\s_\-–—:]*[\[(]?\s*(?:${EPISODE}|${NUMBER_RANGE}|${ENGLISH_VOLUME})(?=$|[\s_\])[(])[\s\S]*$`, 'i');

export function coverEditorSearchTitle(value) {
    const name = String(value || '').normalize('NFC').split(/[\\/]/).pop().replace(/\.[^.]+$/, '').trim();
    let title = name;
    while (title) {
        const next = title.replace(SUFFIX, '').trim();
        if (!next || next === title) break;
        title = next;
    }
    return title;
}
