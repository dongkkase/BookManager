export const DIVIDER_STYLES = Object.freeze({
    solid: { label: 'dividerSolid', css: 'border-top-width:1px;' },
    heavy: { label: 'dividerHeavy', css: 'border-top-width:3px;' },
    double: { label: 'dividerDouble', css: 'border-top:3px double currentColor;' },
    dashed: { label: 'dividerDashed', css: 'border-top-style:dashed;' },
    dotted: { label: 'dividerDotted', css: 'border-top:2px dotted currentColor;' },
    short: { label: 'dividerShort', css: 'width:28%;border-top-width:2px;' },
    shortDouble: { label: 'dividerShortDouble', css: 'width:28%;border-top:3px double currentColor;' },
    dots: { label: 'dividerDots', symbol: '● ● ●' },
    stars: { label: 'dividerStars', symbol: '✦ ✦ ✦' },
    diamonds: { label: 'dividerDiamonds', symbol: '◆ ◇ ◆' },
    asterism: { label: 'dividerAsterism', symbol: '⁂' },
    flourish: { label: 'dividerFlourish', symbol: '❦' },
});

export function validDividerStyle(value) {
    return typeof value === 'string' && Object.hasOwn(DIVIDER_STYLES, value);
}

export function dividerCss(prefix = '') {
    return `${prefix}.bm-divider{display:block;box-sizing:border-box;clear:both;width:100%;height:0;margin:1.8em auto;padding:0;border:0;border-top:1px solid currentColor;background:none;color:inherit;opacity:.65;break-inside:avoid;page-break-inside:avoid;}
${Object.entries(DIVIDER_STYLES).map(([key, preset]) => `${prefix}.bm-divider-${key}{${preset.symbol ? 'height:auto;border:0;font-family:Georgia,"Times New Roman",serif;font-size:1.1em;font-weight:normal;font-style:normal;line-height:1.5;text-align:center;text-indent:0;letter-spacing:.2em;white-space:nowrap;' : preset.css}}`).join('\n')}`;
}
