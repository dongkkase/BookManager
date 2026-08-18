import React from 'react';

function sectionRef(sectionRefs, id) {
    return node => {
        if (node) sectionRefs.current[id] = node;
    };
}

function AudiobookMetadataEditor({
    combinedTagOptions,
    fields,
    renderCombinedGenreTags,
    renderCoverField,
    renderFieldRows,
    sectionLabel,
    sectionRefs,
    sectionTabs,
    t,
}) {
    const tabById = Object.fromEntries(sectionTabs.map(section => [section.id, section]));

    return (
        <div className="meta-section-stack audiobook-metadata-editor">
            <section className="meta-section-box" ref={sectionRef(sectionRefs, 'basic')}>
                <div className="meta-section-title">{sectionLabel(tabById.basic)}</div>
                <div className="meta-column-heads"><span /> <b>{t('t3_col_orig')}</b><span /> <b>{t('t3_col_res')}</b></div>
                {renderCoverField?.()}
                {renderFieldRows(fields.basic)}
            </section>

            <section className="meta-section-box" ref={sectionRef(sectionRefs, 'creators')}>
                <div className="meta-section-title">{sectionLabel(tabById.creators)}</div>
                {renderFieldRows(fields.creators)}
            </section>

            <section className="meta-section-box" ref={sectionRef(sectionRefs, 'tags')}>
                <div className="meta-section-title">{sectionLabel(tabById.tags)}</div>
                {renderCombinedGenreTags(t('t3_f_genre_keywords_categories'), combinedTagOptions)}
            </section>

            <section className="meta-section-box" ref={sectionRef(sectionRefs, 'track')}>
                <div className="meta-section-title">{sectionLabel(tabById.track)}</div>
                {renderFieldRows(fields.track)}
            </section>
        </div>
    );
}

export { AudiobookMetadataEditor };
export default AudiobookMetadataEditor;
