import React from 'react';

function sectionRef(sectionRefs, id) {
    return node => {
        if (node) sectionRefs.current[id] = node;
    };
}

function BookMetadataEditor({
    combinedTagOptions,
    fields,
    isTextMetadata = false,
    originalColumnLabel,
    renderCombinedGenreTags,
    renderCoverField,
    renderFieldRows,
    sectionLabel,
    sectionRefs,
    sectionTabs,
    storageNotice,
    t,
}) {
    const tabById = Object.fromEntries(sectionTabs.map(section => [section.id, section]));

    return (
        <div className="meta-section-stack">
            <section className="meta-section-box" ref={sectionRef(sectionRefs, 'basic')}>
                <div className="meta-section-title">{sectionLabel(tabById.basic)}{isTextMetadata ? ' · TXT' : ''}</div>
                {storageNotice && <p className="meta-storage-notice">{storageNotice}</p>}
                {renderCoverField?.()}
                <div className="meta-column-heads"><span /> <b>{originalColumnLabel || t('t3_col_orig')}</b><span /> <b>{t('t3_col_res')}</b></div>
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

            <section className="meta-section-box" ref={sectionRef(sectionRefs, 'publisher')}>
                <div className="meta-section-title">{sectionLabel(tabById.publisher)}</div>
                {renderFieldRows(fields.publisher)}
            </section>

            <section className="meta-section-box" ref={sectionRef(sectionRefs, 'other')}>
                <div className="meta-section-title">{sectionLabel(tabById.other)}</div>
                {renderFieldRows(fields.other)}
            </section>
        </div>
    );
}

export { BookMetadataEditor };
export default BookMetadataEditor;
