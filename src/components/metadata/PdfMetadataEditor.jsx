import React from 'react';

function sectionRef(sectionRefs, id) {
    return node => {
        if (node) sectionRefs.current[id] = node;
    };
}

function PdfMetadataEditor({
    combinedTagOptions,
    fields,
    renderCombinedGenreTags,
    renderFieldRows,
    sectionLabel,
    sectionRefs,
    sectionTabs,
    t,
}) {
    const tabById = Object.fromEntries(sectionTabs.map(section => [section.id, section]));

    return (
        <div className="meta-section-stack">
            <section className="meta-section-box" ref={sectionRef(sectionRefs, 'basic')}>
                <div className="meta-section-title">{sectionLabel(tabById.basic)}</div>
                <div className="meta-column-heads"><span /> <b>{t('t3_col_orig')}</b><span /> <b>{t('t3_col_res')}</b></div>
                {renderFieldRows(fields.basic)}
            </section>

            <section className="meta-section-box" ref={sectionRef(sectionRefs, 'tags')}>
                <div className="meta-section-title">{sectionLabel(tabById.tags)}</div>
                {renderCombinedGenreTags(t('pdf_f_keywords'), combinedTagOptions)}
            </section>

            <section className="meta-section-box" ref={sectionRef(sectionRefs, 'publisher')}>
                <div className="meta-section-title">{sectionLabel(tabById.publisher)}</div>
                {renderFieldRows(fields.publisher)}
            </section>

            <section className="meta-section-box" ref={sectionRef(sectionRefs, 'document')}>
                <div className="meta-section-title">{sectionLabel(tabById.document)}</div>
                {renderFieldRows(fields.document)}
            </section>

            <section className="meta-section-box" ref={sectionRef(sectionRefs, 'rights')}>
                <div className="meta-section-title">{sectionLabel(tabById.rights)}</div>
                {renderFieldRows(fields.rights)}
            </section>
        </div>
    );
}

export { PdfMetadataEditor };
export default PdfMetadataEditor;
