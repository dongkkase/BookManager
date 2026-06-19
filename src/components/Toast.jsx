import React, { useEffect } from 'react';
import { resolveToastMessage } from '../toastPolicy';

export function Toast({ toast, onClose, t }) {
  useEffect(() => {
    if (!toast) return undefined;
    const timer = window.setTimeout(onClose, toast.duration || 2500);
    return () => window.clearTimeout(timer);
  }, [onClose, toast]);

  if (!toast) return null;
  const message = resolveToastMessage(toast, t);

  return (
    <div className="app-toast-layer" aria-live="polite" aria-atomic="true">
      <div className="app-toast" key={toast.id} role="status">
        {message}
      </div>
    </div>
  );
}
