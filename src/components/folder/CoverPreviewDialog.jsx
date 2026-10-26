import React, { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { FaIcon } from '../FaIcon';
import { paintAmbientCanvasFromSource } from '../../viewerAmbient';

export function CoverPreviewDialog({ src, filePath, alt = '', t, onClose }) {
    const dialogRef = useRef(null);
    const imageRef = useRef(null);
    const ambientCanvasRef = useRef(null);
    const [imageSrc, setImageSrc] = useState(src);
    const [imageError, setImageError] = useState(false);

    useEffect(() => {
        const image = imageRef.current;
        if (image?.complete && image.naturalWidth > 0) {
            paintAmbientCanvasFromSource(ambientCanvasRef.current, image);
        }
    }, [imageSrc]);

    useEffect(() => {
        const previousFocus = document.activeElement;
        const dialog = dialogRef.current;
        dialog.showModal();
        return () => {
            dialog.close();
            if (previousFocus?.isConnected) previousFocus.focus?.();
        };
    }, []);

    useEffect(() => {
        let disposed = false;
        if (filePath && window.electronAPI?.loadMetadataCover) {
            Promise.resolve().then(() => window.electronAPI.loadMetadataCover(filePath)).then(cover => {
                if (!disposed && typeof cover === 'string' && cover) setImageSrc(cover);
            }).catch(() => {});
        }
        return () => { disposed = true; };
    }, [filePath]);

    return createPortal(
        <dialog
            ref={dialogRef}
            className="detail-cover-preview-dialog"
            data-folder-modal
            aria-modal="true"
            aria-label={alt ? `${t('cover_preview')}: ${alt}` : t('cover_preview')}
            onCancel={event => {
                event.preventDefault();
                onClose();
            }}
            onClose={onClose}
            onKeyDown={event => event.stopPropagation()}
            onClick={event => {
                event.stopPropagation();
                if (event.target === event.currentTarget) onClose();
            }}
        >
            <div className="detail-cover-preview-body">
                <button type="button" className="detail-cover-preview-close" aria-label={t('btn_close')}
                    title={t('btn_close')} onClick={onClose} autoFocus>
                    <FaIcon name="xmark" size={18} />
                </button>
                {imageError ? <p role="status">{t('no_image')}</p> : (
                    <>
                        <canvas ref={ambientCanvasRef} className="detail-cover-preview-ambient" aria-hidden="true" />
                        <img ref={imageRef} className="detail-cover-preview-image" src={imageSrc} alt={alt} draggable={false}
                            onLoad={event => paintAmbientCanvasFromSource(ambientCanvasRef.current, event.currentTarget)}
                            onError={() => {
                                const canvas = ambientCanvasRef.current;
                                canvas?.getContext('2d')?.clearRect(0, 0, canvas.width, canvas.height);
                                if (imageSrc !== src) setImageSrc(src);
                                else setImageError(true);
                            }} />
                    </>
                )}
            </div>
        </dialog>,
        document.body,
    );
}
