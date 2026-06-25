import React from 'react';

function sectionRef(sectionRefs, id) {
    return node => {
        if (node) sectionRefs.current[id] = node;
    };
}

function ComicMetadataEditor({
    fields,
    genreOptions,
    renderDualTextarea,
    renderFieldRows,
    renderSeparatedTagField,
    sectionLabel,
    sectionRefs,
    sectionTabs,
    tagOptions,
    t,
}) {
    return (
        <div className="meta-section-stack">
            <section className="meta-section-box" ref={sectionRef(sectionRefs, 'basic')}>
                <div className="meta-section-title">{sectionLabel(sectionTabs[0])}</div>
                <div className="meta-column-heads"><span /> <b>{t('t3_col_orig')}</b><span /> <b>{t('t3_col_res')}</b></div>
                {renderFieldRows(fields.basic)}
            </section>

            <section className="meta-section-box" ref={sectionRef(sectionRefs, 'creators')}>
                <div className="meta-section-title">{sectionLabel(sectionTabs[1])}</div>
                {renderFieldRows(fields.creators)}
            </section>

            <section className="meta-section-box" ref={sectionRef(sectionRefs, 'publisher')}>
                <div className="meta-section-title">{sectionLabel(sectionTabs[2])}</div>
                {renderFieldRows(fields.publisher)}
            </section>

            <section className="meta-section-box" ref={sectionRef(sectionRefs, 'tags')}>
                <div className="meta-section-title">{sectionLabel(sectionTabs[3])}</div>
                {renderSeparatedTagField('Genre', t('t3_f_genre'), genreOptions)}
                {renderSeparatedTagField('Tags', t('t3_f_tags_lbl'), tagOptions)}
                {renderDualTextarea('Characters', t('t3_f_char'))}
            </section>

            <section className="meta-section-box" ref={sectionRef(sectionRefs, 'other')}>
                <div className="meta-section-title">{sectionLabel(sectionTabs[4])}</div>
                {renderFieldRows(fields.other)}
            </section>
        </div>
    );
}

export { ComicMetadataEditor };
export default ComicMetadataEditor;
