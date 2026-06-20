import React, { useEffect, useMemo, useRef, useState } from 'react';
import { FaIcon } from '../FaIcon';
import {
  duplicateDetailRows,
  formatDetailValue,
  splitMetadataValues,
  visibleDetailTags,
} from '../../detailPanelState';

function formatSize(bytes) {
  if (!bytes) return '-';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let value = Number(bytes);
  let index = 0;
  while (value >= 1024 && index < units.length - 1) {
    value /= 1024;
    index += 1;
  }
  return `${value.toFixed(index === 0 ? 0 : 2)} ${units[index]}`;
}

function formatDate(value) {
  if (!value) return '-';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? String(value) : date.toLocaleString();
}

const DetailPanel = ({ selectedFile = null, onContentHeightChange, t }) => {
  const [imageError, setImageError] = useState(false);
  const contentRef = useRef(null);

  useEffect(() => {
    setImageError(false);
  }, [selectedFile?.path]);

  const tags = useMemo(
    () => visibleDetailTags(selectedFile || {}, []),
    [selectedFile],
  );
  const duplicates = useMemo(() => duplicateDetailRows(selectedFile || {}), [selectedFile]);

  useEffect(() => {
    if (!selectedFile || !contentRef.current) return undefined;
    const measure = () => {
      const content = contentRef.current;
      if (!content) return;
      onContentHeightChange?.(Math.ceil(content.scrollHeight));
    };
    const frame = window.requestAnimationFrame(measure);
    const observer = typeof ResizeObserver === 'function' ? new ResizeObserver(measure) : null;
    if (observer) observer.observe(contentRef.current);
    return () => {
      window.cancelAnimationFrame(frame);
      observer?.disconnect();
    };
  }, [onContentHeightChange, selectedFile?.path]);

  if (!selectedFile) {
    return <div className="folder-detail-panel empty"><div className="detail-empty-state">-</div></div>;
  }

  const coverAvailable = selectedFile.cover && !imageError;
  const creators = splitMetadataValues(
    selectedFile.writer,
    selectedFile.penciller,
    selectedFile.inker,
    selectedFile.colorist,
    selectedFile.letterer,
    selectedFile.cover_artist,
  ).join(', ');
  const leftFields = [
    ['user', t('col_creators'), creators, true],
    ['building', t('col_publisher'), selectedFile.publisher],
    ['fileLines', t('col_page_count'), selectedFile.page_count],
    ['bookOpen', t('col_vol_count'), selectedFile.total_volume],
    ['archive', `${t('col_format')} / ${t('col_manga')}`, [selectedFile.format, selectedFile.manga].filter(Boolean).join(' / ')],
    ['star', t('col_rating'), selectedFile.rating],
    ['child', t('col_age_rating'), selectedFile.age_rating],
    ['link', t('col_web'), selectedFile.link],
  ];
  const arcTeamLocation = [
    splitMetadataValues(selectedFile.story_arc).join(', '),
    splitMetadataValues(selectedFile.teams).join(', '),
    splitMetadataValues(selectedFile.locations).join(', '),
  ].filter(Boolean).join(' / ');

  return (
    <div className="folder-detail-panel">
      {coverAvailable && <div className="folder-detail-bg" style={{ backgroundImage: `url(${selectedFile.cover})` }} />}
      <div className="folder-detail-overlay" />
      <div className="folder-detail-scroll">
        <div className="folder-detail-content" ref={contentRef}>
          <div className="detail-cover-section">
            <div className="detail-cover-stack">
              {coverAvailable ? (
                <img
                  src={selectedFile.cover}
                  alt={selectedFile.name || ''}
                  className="detail-cover-image"
                  onError={() => setImageError(true)}
                />
              ) : (
                <div className="detail-cover-placeholder" title={t('folder_no_cover')}>
                  <FaIcon name="file" size={42} />
                  <span>{t('folder_no_cover')}</span>
                </div>
              )}
              <div className="detail-cover-caption">
                <div>{t('col_res')}: {selectedFile.resolution || '-'}, ({formatSize(selectedFile.size)})</div>
                <div>{formatDate(selectedFile.created || selectedFile.ctime)}</div>
                <div>{formatDate(selectedFile.modified || selectedFile.mtime)}</div>
              </div>
            </div>
          </div>

          <div className="detail-metadata-section">
            <div className="detail-heading">
              <div className="detail-series">{selectedFile.series || t('info_no_series')}</div>
              <div className="detail-title">{selectedFile.title || selectedFile.name || '-'}</div>
              <div className="detail-tags">
                {tags.length > 0 ? tags.map(tag => <span key={tag}>{tag}</span>) : <span>-</span>}
              </div>
            </div>

            <div className="detail-info-card">
              <DetailFieldGroup fields={leftFields} />
              <section className="detail-extra">
                <DetailLine icon="fileLines" label={t('col_summary')} value={selectedFile.description || t('info_no_summary')} plain />
                <DetailLine icon="layers" label={t('info_arc_team_loc')} value={arcTeamLocation} inline />
                <DetailLine icon="user" label={t('col_characters')} value={selectedFile.characters} inline />
              </section>
            </div>

            {duplicates.length > 0 && (
              <section className="detail-duplicates">
                <h4>{t('dup_match_found', [duplicates.length])}</h4>
                {duplicates.map(item => (
                  <div key={`${item.path}-${item.name}`}>
                    <span>{item.ratio}%</span>
                    <strong>{item.name}</strong>
                    <code>{item.path}</code>
                  </div>
                ))}
              </section>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

function DetailFieldGroup({ fields }) {
  return (
    <div className="metadata-grid">
      {fields.map(([icon, label, value, emptyWhenMissing]) => (
        <React.Fragment key={label}>
          <div className="metadata-label">
            <FaIcon name={icon} size={12} />
            <span>{label}</span>
          </div>
          <div className="metadata-value" title={formatDetailValue(value)}>
            {emptyWhenMissing && !value ? '' : formatDetailValue(value)}
          </div>
        </React.Fragment>
      ))}
    </div>
  );
}

function DetailLine({ icon, label, value, plain = false, inline = false }) {
  const display = splitMetadataValues(value).join(', ') || '-';
  return (
    <div className={`detail-line ${plain ? 'plain' : ''} ${inline ? 'inline' : ''}`.trim()}>
      <strong><FaIcon name={icon} size={12} /><span>{label}</span></strong>
      <span>{display}</span>
    </div>
  );
}

export { DetailPanel };
export default DetailPanel;
