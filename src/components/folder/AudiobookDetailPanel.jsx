import React, { useEffect, useMemo, useState } from 'react';
import { FaIcon } from '../FaIcon';
import {
    duplicateDetailRows,
    splitMetadataValues,
} from '../../detailPanelState';
import {
    DetailCoverFrame,
    DetailFieldGroup,
    DetailLine,
    DetailPanelStatusBadges,
    detailMetadataValue,
    formatDate,
    formatSize,
    useDetailContentHeight,
} from './detailPanelCommon';

function metadataText(t, key, fallback) {
    const translated = t?.(key);
    return translated && translated !== key ? translated : fallback;
}

function finiteNumber(value) {
    const number = Number(value);
    return Number.isFinite(number) && number > 0 ? number : 0;
}

export function formatAudioDuration(value) {
    const totalSeconds = Math.round(finiteNumber(value));
    if (!totalSeconds) return '';
    const hours = Math.floor(totalSeconds / 3600);
    const minutes = Math.floor((totalSeconds % 3600) / 60);
    const seconds = totalSeconds % 60;
    return hours > 0
        ? `${hours}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`
        : `${minutes}:${String(seconds).padStart(2, '0')}`;
}

export function formatAudioBitrate(value) {
    const bitrate = finiteNumber(value);
    if (!bitrate) return '';
    return `${Math.round(bitrate >= 1000 ? bitrate / 1000 : bitrate)} kbps`;
}

export function formatAudioSampleRate(value) {
    const sampleRate = finiteNumber(value);
    if (!sampleRate) return '';
    const kilohertz = sampleRate >= 1000 ? sampleRate / 1000 : sampleRate;
    return `${Number(kilohertz.toFixed(2))} kHz`;
}

function fractionValue(current, total) {
    const currentText = String(current || '').trim();
    const totalText = String(total || '').trim();
    if (!currentText) return '';
    return totalText ? `${currentText} / ${totalText}` : currentText;
}

const AudiobookDetailPanel = ({ selectedFile = null, onContentHeightChange, t }) => {
    const [imageError, setImageError] = useState(false);
    const { contentRef, scrollRef } = useDetailContentHeight(selectedFile, onContentHeightChange);

    useEffect(() => {
        setImageError(false);
    }, [selectedFile?.path]);

    const tags = useMemo(
        () => splitMetadataValues(
            detailMetadataValue(selectedFile, 'genre', 'Genre'),
            detailMetadataValue(selectedFile, 'tags', 'Tags'),
        ),
        [selectedFile],
    );
    const duplicates = useMemo(() => duplicateDetailRows(selectedFile || {}), [selectedFile]);

    if (!selectedFile) {
        return <div className="folder-detail-panel empty"><div className="detail-empty-state">-</div></div>;
    }

    const cover = selectedFile.cover || selectedFile.coverDataUrl || '';
    const coverAvailable = cover && !imageError;
    const fileName = selectedFile.name || String(selectedFile.path || selectedFile.full_path || '').split(/[\\/]/).pop();
    const title = detailMetadataValue(selectedFile, 'title', 'Title') || selectedFile.name;
    const series = detailMetadataValue(selectedFile, 'series', 'Series');
    const artist = detailMetadataValue(selectedFile, 'writer', 'artist', 'Artist', 'Writer');
    const album = detailMetadataValue(selectedFile, 'album', 'Album');
    const albumArtist = detailMetadataValue(selectedFile, 'album_artist', 'albumArtist', 'AlbumArtist');
    const composer = detailMetadataValue(selectedFile, 'composer', 'Composer');
    const publisher = detailMetadataValue(selectedFile, 'publisher', 'Publisher');
    const year = detailMetadataValue(selectedFile, 'year', 'Year', 'date', 'publish_date');
    const track = fractionValue(
        detailMetadataValue(selectedFile, 'track_number', 'trackNumber', 'TrackNumber'),
        detailMetadataValue(selectedFile, 'track_total', 'trackTotal', 'TrackTotal'),
    );
    const disc = fractionValue(
        detailMetadataValue(selectedFile, 'disc_number', 'discNumber', 'DiscNumber'),
        detailMetadataValue(selectedFile, 'disc_total', 'discTotal', 'DiscTotal'),
    );
    const duration = formatAudioDuration(detailMetadataValue(
        selectedFile,
        'duration_seconds',
        'durationSeconds',
        'DurationSeconds',
    ));
    const bitrate = formatAudioBitrate(detailMetadataValue(selectedFile, 'bitrate', 'Bitrate'));
    const sampleRate = formatAudioSampleRate(detailMetadataValue(
        selectedFile,
        'sample_rate',
        'sampleRate',
        'SampleRate',
    ));
    const codec = detailMetadataValue(selectedFile, 'codec', 'Codec');
    const container = detailMetadataValue(selectedFile, 'container', 'Container', 'format', 'Format');
    const channels = detailMetadataValue(selectedFile, 'channels', 'Channels');
    const mimeType = detailMetadataValue(selectedFile, 'mime_type', 'mimeType', 'MimeType');
    const summary = detailMetadataValue(selectedFile, 'description', 'summary', 'Summary');
    const tagLabel = metadataText(t, 't3_f_genre_keywords_categories', '장르/키워드/카테고리');
    const audiobookFields = [
        ['user', metadataText(t, 'audio_f_artist', '아티스트'), artist, true],
        ['book', metadataText(t, 'audio_f_album', '앨범'), album],
        ['users', metadataText(t, 'audio_f_album_artist', '앨범 아티스트'), albumArtist],
        ['user', metadataText(t, 'audio_f_composer', '작곡가'), composer],
        ['building', metadataText(t, 't3_f_pub', '출판사'), publisher],
        ['calendar', metadataText(t, 't3_f_year', '연도'), year],
        ['list', metadataText(t, 'audio_f_track', '트랙'), track],
        ['fileLines', metadataText(t, 'audio_f_disc', '디스크'), disc],
    ];

    return (
        <div className="folder-detail-panel audiobook-detail-panel">
            {coverAvailable && <div className="folder-detail-bg" style={{ backgroundImage: `url(${cover})` }} />}
            <div className="folder-detail-overlay" />
            <DetailPanelStatusBadges selectedFile={selectedFile} t={t} />
            <div className="folder-detail-scroll" ref={scrollRef}>
                <div className="folder-detail-content" ref={contentRef}>
                    <div className="detail-cover-section">
                        <div className="detail-cover-stack">
                            <DetailCoverFrame>
                                {coverAvailable ? (
                                    <img
                                        src={cover}
                                        alt={selectedFile.name || ''}
                                        className="detail-cover-image"
                                        onError={() => setImageError(true)}
                                    />
                                ) : (
                                    <div className="detail-cover-placeholder" title={t('audio_no_cover')}>
                                        <FaIcon name="headphones" size={42} />
                                        <span>{t('audio_no_cover')}</span>
                                    </div>
                                )}
                            </DetailCoverFrame>
                            <div className="detail-cover-caption">
                                <div>{fileName || '-'} ({formatSize(selectedFile.size)})</div>
                                <div>{formatDate(selectedFile.created || selectedFile.ctime)}</div>
                                <div>{formatDate(selectedFile.modified || selectedFile.mtime)}</div>
                            </div>
                        </div>
                    </div>

                    <div className="detail-metadata-section">
                        <div className="detail-heading">
                            <div className="detail-series">{series || album || t('info_no_series')}</div>
                            <div className="detail-title">{title || '-'}</div>
                            <div className="detail-audiobook-artist">{artist || '-'}</div>
                            <div className="detail-tags" aria-label={tagLabel} title={tagLabel}>
                                {tags.length > 0 ? tags.map(tag => <span key={tag}>{tag}</span>) : <span>-</span>}
                            </div>
                        </div>

                        <div className="detail-info-card">
                            <DetailFieldGroup fields={audiobookFields} />
                            <section className="detail-extra audiobook-technical-details">
                                <DetailLine icon="clock" label={metadataText(t, 'audio_f_duration', '재생 시간')} value={duration} inline />
                                <DetailLine icon="towerBroadcast" label={metadataText(t, 'audio_f_bitrate', '비트레이트')} value={bitrate} inline />
                                <DetailLine icon="towerBroadcast" label={metadataText(t, 'audio_f_sample_rate', '샘플레이트')} value={sampleRate} inline />
                                <DetailLine icon="file" label={metadataText(t, 'audio_f_codec', '코덱')} value={codec} inline />
                                <DetailLine icon="archive" label={metadataText(t, 'audio_f_container', '포맷/컨테이너')} value={container} inline />
                                <DetailLine icon="users" label={metadataText(t, 'audio_f_channels', '채널')} value={channels} inline />
                                <DetailLine icon="fileLines" label={metadataText(t, 'audio_f_mime_type', 'MIME 형식')} value={mimeType} inline />
                                <DetailLine icon="bookOpen" label={metadataText(t, 't3_f_book_description', '책설명')} value={summary} plain />
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

export { AudiobookDetailPanel };
export default AudiobookDetailPanel;
