import React, { useCallback, useState } from 'react';
import { useNavigate } from 'react-router-dom';

function getStudyInstanceUIDs(): string[] {
  try {
    const params = new URLSearchParams(window.location.search);
    const uids = params.getAll('StudyInstanceUIDs');

    if (uids.length) {
      return uids.flatMap(value => value.split(',')).filter(Boolean);
    }
  } catch {
    // ignore
  }

  return [];
}

function dispatchStudyFeedback(payload) {
  const bridge = (window as any).OHIFBridge;

  if (bridge && typeof bridge.onSubmitFeedback === 'function') {
    bridge.onSubmitFeedback(JSON.stringify(payload));
  } else if (window.parent && window.parent !== window) {
    window.parent.postMessage(payload, '*');
  } else {
    // eslint-disable-next-line no-console
    console.log('[StudyFeedbackPage] no native bridge - payload:', payload);
  }
}

function StudyFeedbackPage(): React.ReactElement {
  const navigate = useNavigate();
  const [feedback, setFeedback] = useState('');
  const [sending, setSending] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [error, setError] = useState('');

  const handleSubmit = useCallback(() => {
    if (sending || submitted || !feedback.trim()) {
      return;
    }

    setSending(true);
    setError('');

    const payload = {
      type: 'OHIF_STUDY_FEEDBACK',
      findingsAndDiagnoses: feedback.trim(),
      studyInstanceUIDs: getStudyInstanceUIDs(),
      url: window.location.href,
      timestamp: new Date().toISOString(),
    };

    try {
      dispatchStudyFeedback(payload);
      setSubmitted(true);
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error('[StudyFeedbackPage] failed to dispatch', err);
      setError('Feedback could not be submitted. Please try again.');
    } finally {
      setSending(false);
    }
  }, [feedback, sending, submitted]);

  return (
    <main className="bg-background flex h-full w-full items-center justify-center overflow-auto px-5 py-8">
      <section className="border-input bg-muted/30 w-full max-w-2xl rounded-lg border p-6 shadow-lg md:p-8">
        <div className="mb-6">
          <div className="text-primary-main mb-2 text-xs font-semibold uppercase tracking-wider">
            Final Step
          </div>
          <h1 className="text-foreground text-2xl font-semibold">Submit your findings</h1>
          <p className="text-muted-foreground mt-2 text-sm leading-6">
            Enter your findings and diagnoses for this study before returning to the main page.
          </p>
        </div>

        <label
          htmlFor="study-feedback"
          className="text-foreground mb-2 block text-sm font-medium"
        >
          Findings and diagnoses
        </label>
        <textarea
          id="study-feedback"
          value={feedback}
          onChange={event => setFeedback(event.target.value)}
          disabled={submitted}
          placeholder="Describe your findings and diagnoses"
          className="border-input bg-background text-foreground focus:border-primary-main focus:ring-primary-main min-h-[220px] w-full resize-y rounded border px-4 py-3 text-sm leading-6 outline-none focus:ring-1 disabled:cursor-not-allowed disabled:opacity-70"
        />

        {error && <p className="mt-3 text-sm text-red-400">{error}</p>}
        {submitted && (
          <p className="mt-3 text-sm font-medium text-green-400">
            Your findings and diagnoses have been submitted.
          </p>
        )}

        <div className="mt-6 flex justify-end">
          {submitted ? (
            <button
              type="button"
              onClick={() => navigate('/')}
              className="bg-primary-main hover:bg-primary-light focus:ring-primary-main rounded px-5 py-2.5 text-sm font-semibold text-white transition focus:outline-none focus:ring-2"
            >
              Proceed to Main Page
            </button>
          ) : (
            <button
              type="button"
              onClick={handleSubmit}
              disabled={sending || !feedback.trim()}
              className="bg-primary-main hover:bg-primary-light focus:ring-primary-main rounded px-5 py-2.5 text-sm font-semibold text-white transition focus:outline-none focus:ring-2 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {sending ? 'Submitting...' : 'Submit Feedback'}
            </button>
          )}
        </div>
      </section>
    </main>
  );
}

export default StudyFeedbackPage;
