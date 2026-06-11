import React, { useCallback, useState } from 'react';

function getStudyInstanceUIDs(): string[] {
  try {
    const params = new URLSearchParams(window.location.search);
    const uids = params.getAll('StudyInstanceUIDs');
    if (uids.length) {
      return uids.flatMap(v => v.split(','));
    }
  } catch {
    // ignore
  }
  return [];
}

function SubmitFeedbackButton(): React.ReactElement {
  const [sending, setSending] = useState(false);

  const handleClick = useCallback(() => {
    if (sending) {
      return;
    }
    setSending(true);

    const payload = {
      type: 'OHIF_SUBMIT_FEEDBACK',
      studyInstanceUIDs: getStudyInstanceUIDs(),
      url: window.location.href,
      timestamp: new Date().toISOString(),
    };

    const bridge = (window as any).OHIFBridge;
    try {
      if (bridge && typeof bridge.onSubmitFeedback === 'function') {
        bridge.onSubmitFeedback(JSON.stringify(payload));
      } else if (window.parent && window.parent !== window) {
        window.parent.postMessage(payload, '*');
      } else {
        // Dev/browser fallback
        // eslint-disable-next-line no-console
        console.log('[SubmitFeedback] no feedback bridge - payload:', payload);
      }
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error('[SubmitFeedback] failed to dispatch', err);
    } finally {
      setTimeout(() => setSending(false), 500);
    }
  }, [sending]);

  return (
    <button
      type="button"
      onClick={handleClick}
      disabled={sending}
      className="bg-primary-main hover:bg-primary-light focus:ring-primary-main focus:ring-offset-bkg-full absolute bottom-6 right-8 z-50 rounded-md px-5 py-2.5 text-sm font-semibold text-white shadow-lg ring-1 ring-white/10 backdrop-blur-sm transition focus:outline-none focus:ring-2 focus:ring-offset-2 disabled:opacity-60"
    >
      {sending ? 'Submitting…' : 'Submit and Share Feedback'}
    </button>
  );
}

export default SubmitFeedbackButton;
