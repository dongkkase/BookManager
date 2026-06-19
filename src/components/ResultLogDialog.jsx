import React, { useEffect, useMemo, useRef } from 'react';
import { canContinueResult, formatResultLog, normalizeResultStats } from '../resultLog';
import { useModalAccessibility } from '../hooks/useModalAccessibility';

export function ResultLogDialog({
  result,
  outputPaths = [],
  continueLabelKey,
  onClose,
  onContinue,
  t,
}) {
  const continueHandledRef = useRef(false);
  const closeButtonRef = useRef(null);
  const dialogRef = useModalAccessibility(Boolean(result), onClose);
  const stats = useMemo(() => normalizeResultStats(result?.stats), [result?.stats]);
  const logContent = useMemo(() => formatResultLog(stats), [stats]);
  const showContinue = Boolean(
    continueLabelKey
    && onContinue
    && canContinueResult(result, outputPaths),
  );

  useEffect(() => {
    continueHandledRef.current = false;
    closeButtonRef.current?.focus();
  }, [result]);

  const handleContinue = () => {
    if (continueHandledRef.current) return;
    continueHandledRef.current = true;
    onContinue?.();
  };

  return (
    <div
      className="result-log-overlay"
      role="presentation"
      onMouseDown={event => event.stopPropagation()}
    >
      <section
        ref={dialogRef}
        className="result-log-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="result-log-title"
        tabIndex={-1}
      >
        <h2 id="result-log-title">{t('log_title')}</h2>
        <div className="result-log-summary">
          {t('log_summary', [stats.success.length, stats.skip.length, stats.error.length])}
        </div>
        <textarea
          className="result-log-content"
          value={logContent}
          readOnly
          spellCheck={false}
          aria-label={t('log_title')}
        />
        <div className="result-log-actions">
          {showContinue && (
            <button className="result-log-continue" onClick={handleContinue}>
              {t(continueLabelKey)}
            </button>
          )}
          <button ref={closeButtonRef} className="result-log-close" onClick={onClose}>
            {t('btn_close')}
          </button>
        </div>
      </section>
    </div>
  );
}
