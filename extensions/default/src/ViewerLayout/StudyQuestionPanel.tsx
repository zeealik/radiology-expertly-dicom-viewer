import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Enums, VolumeViewport3D } from '@cornerstonejs/core';
import { useViewportGrid } from '@ohif/ui-next';

type StudyQuestion = {
  id: string;
  text: string;
  triggerSlice?: number;
  triggerSlices?: number[];
  intervalSeconds?: number;
};

type SliceState = {
  imageIndex: number | null;
  numberOfSlices: number | null;
};

type SubmittedAnswer = {
  questionId: string;
  questionText: string;
  answer: string;
  viewportId: string;
  slice: number | null;
  numberOfSlices: number | null;
  timestamp: string;
};

const REVIEW_STORAGE_KEY = 'ohif.studyQuestionReview';

const DEFAULT_QUESTIONS: StudyQuestion[] = [
  {
    id: 'initial-impression',
    text: 'What is your primary impression from this study?',
  },
  {
    id: 'mid-study-finding',
    text: 'Is there an abnormality visible on this slice? Describe it briefly.',
    triggerSlice: 50,
  },
  {
    id: 'confidence-check',
    text: 'How confident are you in your interpretation so far?',
    intervalSeconds: 45,
  },
];

function getStudyInstanceUIDs(): string[] {
  try {
    const params = new URLSearchParams(window.location.search);
    const uids = params.getAll('StudyInstanceUIDs');
    if (uids.length) {
      return uids.flatMap(v => v.split(',')).filter(Boolean);
    }
  } catch {
    // ignore
  }

  return [];
}

function getQuestionSliceTriggers(question: StudyQuestion): number[] {
  return [question.triggerSlice, ...(question.triggerSlices || [])].filter(
    slice => typeof slice === 'number' && slice > 0
  ) as number[];
}

function dispatchQuestionAnswer(payload) {
  const bridge = (window as any).OHIFBridge;

  try {
    if (bridge && typeof bridge.onSubmitQuestionAnswer === 'function') {
      bridge.onSubmitQuestionAnswer(JSON.stringify(payload));
    } else if (bridge && typeof bridge.onSubmitFeedback === 'function') {
      bridge.onSubmitFeedback(JSON.stringify(payload));
    } else if (window.parent && window.parent !== window) {
      window.parent.postMessage(payload, '*');
    } else {
      // eslint-disable-next-line no-console
      console.log('[StudyQuestionPanel] no native bridge - payload:', payload);
    }
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error('[StudyQuestionPanel] failed to dispatch', err);
  }
}

function getReviewPath(): string {
  const url = new URL(window.location.href);
  url.searchParams.set('studyReview', '1');

  return `${url.pathname}${url.search}`;
}

function saveReviewData(answers: SubmittedAnswer[], numberOfSlices: number | null) {
  const payload = {
    type: 'OHIF_STUDY_QUESTION_REVIEW',
    answers,
    studyInstanceUIDs: getStudyInstanceUIDs(),
    numberOfSlices,
    url: window.location.href,
    timestamp: new Date().toISOString(),
  };

  try {
    window.sessionStorage.setItem(REVIEW_STORAGE_KEY, JSON.stringify(payload));
  } catch {
    // ignore
  }

  return payload;
}

function StudyQuestionPanel({ servicesManager }: withAppTypes): React.ReactElement {
  const [{ activeViewportId }] = useViewportGrid();
  const { cornerstoneViewportService, customizationService } = servicesManager.services;
  const configuredQuestions = customizationService.getCustomization(
    'studyQuestionPanel.questions'
  ) as unknown as StudyQuestion[];

  const questions = useMemo(
    () =>
      Array.isArray(configuredQuestions) && configuredQuestions.length
        ? configuredQuestions
        : DEFAULT_QUESTIONS,
    [configuredQuestions]
  );

  const [activeQuestion, setActiveQuestion] = useState<StudyQuestion>(questions[0]);
  const [answer, setAnswer] = useState('');
  const [submittedQuestionIds, setSubmittedQuestionIds] = useState<string[]>([]);
  const [submittedAnswers, setSubmittedAnswers] = useState<SubmittedAnswer[]>([]);
  const [sliceState, setSliceState] = useState<SliceState>({
    imageIndex: null,
    numberOfSlices: null,
  });
  const [sending, setSending] = useState(false);

  const showQuestion = useCallback(
    (question: StudyQuestion) => {
      if (
        !question ||
        activeQuestion?.id === question.id ||
        submittedQuestionIds.includes(question.id)
      ) {
        return;
      }

      setActiveQuestion(question);
      setAnswer('');
    },
    [activeQuestion?.id, submittedQuestionIds]
  );

  useEffect(() => {
    setActiveQuestion(questions[0]);
    setAnswer('');
    setSubmittedQuestionIds([]);
    setSubmittedAnswers([]);
  }, [questions]);

  useEffect(() => {
    const timeoutId = window.setTimeout(() => cornerstoneViewportService?.resize?.(), 50);

    return () => window.clearTimeout(timeoutId);
  }, [cornerstoneViewportService]);

  useEffect(() => {
    if (!activeViewportId || !cornerstoneViewportService) {
      return;
    }

    const viewport = cornerstoneViewportService.getCornerstoneViewport(activeViewportId);
    const element = viewport?.element;

    if (!viewport || !element || viewport instanceof VolumeViewport3D) {
      return;
    }

    const updateSlice = event => {
      const latestViewport = cornerstoneViewportService.getCornerstoneViewport(activeViewportId);
      if (!latestViewport || latestViewport instanceof VolumeViewport3D) {
        return;
      }

      const { imageIndex, newImageIdIndex = imageIndex, imageIdIndex } = event.detail || {};
      const nextImageIndex =
        typeof newImageIdIndex === 'number'
          ? newImageIdIndex
          : typeof imageIdIndex === 'number'
            ? imageIdIndex
            : latestViewport.getCurrentImageIdIndex?.();
      const numberOfSlices = latestViewport.getNumberOfSlices?.() ?? null;

      setSliceState({
        imageIndex: nextImageIndex ?? null,
        numberOfSlices,
      });

      const currentSlice = typeof nextImageIndex === 'number' ? nextImageIndex + 1 : null;
      const sliceQuestion = questions.find(question =>
        getQuestionSliceTriggers(question).includes(currentSlice)
      );

      if (sliceQuestion) {
        showQuestion(sliceQuestion);
      }
    };

    try {
      setSliceState({
        imageIndex: viewport.getCurrentImageIdIndex?.() ?? null,
        numberOfSlices: viewport.getNumberOfSlices?.() ?? null,
      });
    } catch {
      // ignore
    }

    element.addEventListener(Enums.Events.STACK_NEW_IMAGE, updateSlice);
    element.addEventListener(Enums.Events.VOLUME_NEW_IMAGE, updateSlice);
    element.addEventListener(Enums.Events.IMAGE_RENDERED, updateSlice);

    return () => {
      element.removeEventListener(Enums.Events.STACK_NEW_IMAGE, updateSlice);
      element.removeEventListener(Enums.Events.VOLUME_NEW_IMAGE, updateSlice);
      element.removeEventListener(Enums.Events.IMAGE_RENDERED, updateSlice);
    };
  }, [activeViewportId, cornerstoneViewportService, questions, showQuestion]);

  useEffect(() => {
    const intervalQuestions = questions.filter(question => question.intervalSeconds);
    if (!intervalQuestions.length) {
      return;
    }

    const intervalSeconds = Math.min(
      ...intervalQuestions.map(question => question.intervalSeconds)
    );
    const timer = window.setInterval(() => {
      const unansweredQuestions = intervalQuestions.filter(
        question =>
          question.id !== activeQuestion?.id && !submittedQuestionIds.includes(question.id)
      );
      const question = unansweredQuestions[Math.floor(Math.random() * unansweredQuestions.length)];

      showQuestion(question);
    }, intervalSeconds * 1000);

    return () => window.clearInterval(timer);
  }, [activeQuestion?.id, questions, showQuestion, submittedQuestionIds]);

  const handleSubmit = useCallback(() => {
    if (!activeQuestion || sending || !answer.trim()) {
      return;
    }

    setSending(true);

    const timestamp = new Date().toISOString();
    const submittedAnswer = {
      questionId: activeQuestion.id,
      questionText: activeQuestion.text,
      answer: answer.trim(),
      viewportId: activeViewportId,
      slice: sliceState.imageIndex === null ? null : sliceState.imageIndex + 1,
      numberOfSlices: sliceState.numberOfSlices,
      timestamp,
    };

    const payload = {
      type: 'OHIF_STUDY_QUESTION_ANSWER',
      ...submittedAnswer,
      studyInstanceUIDs: getStudyInstanceUIDs(),
      url: window.location.href,
    };

    dispatchQuestionAnswer(payload);
    const nextSubmittedAnswers = [...submittedAnswers, submittedAnswer];
    const nextSubmittedQuestionIds = [...new Set([...submittedQuestionIds, activeQuestion.id])];

    setSubmittedAnswers(nextSubmittedAnswers);
    setSubmittedQuestionIds(nextSubmittedQuestionIds);
    setAnswer('');

    const nextQuestion = questions.find(
      question =>
        question.id !== activeQuestion.id && !nextSubmittedQuestionIds.includes(question.id)
    );

    if (nextQuestion && nextSubmittedQuestionIds.length < questions.length) {
      setActiveQuestion(nextQuestion);
    } else {
      const reviewPayload = saveReviewData(nextSubmittedAnswers, sliceState.numberOfSlices);
      dispatchQuestionAnswer(reviewPayload);
      window.setTimeout(() => {
        window.location.assign(getReviewPath());
      }, 300);
    }

    window.setTimeout(() => setSending(false), 500);
  }, [
    activeQuestion,
    activeViewportId,
    answer,
    questions,
    sending,
    sliceState,
    submittedAnswers,
    submittedQuestionIds,
  ]);

  const answeredCount = submittedQuestionIds.length;
  const currentSliceLabel =
    sliceState.imageIndex === null
      ? 'Slice -'
      : `Slice ${sliceState.imageIndex + 1}${sliceState.numberOfSlices ? ` / ${sliceState.numberOfSlices}` : ''}`;

  return (
    <aside className="border-input bg-muted/30 flex h-full w-full min-w-0 shrink-0 flex-col border-l">
      <div className="border-input flex min-h-[56px] items-center justify-between border-b px-5">
        <div className="min-w-0">
          <div className="text-foreground text-base font-semibold">Study Question</div>
          <div className="text-muted-foreground mt-0.5 text-xs">{currentSliceLabel}</div>
        </div>
        <div className="bg-background text-muted-foreground rounded px-2 py-1 text-xs">
          {answeredCount}/{questions.length}
        </div>
      </div>

      <div className="flex min-h-0 flex-1 flex-col gap-4 px-5 py-4">
        <div className="border-input bg-background rounded border p-4">
          <div className="text-foreground text-sm font-medium leading-6">
            {activeQuestion?.text}
          </div>
        </div>

        <textarea
          value={answer}
          onChange={event => setAnswer(event.target.value)}
          placeholder="Enter your answer"
          className="border-input bg-background text-foreground focus:border-primary-main focus:ring-primary-main min-h-[180px] w-full flex-1 resize-none rounded border px-3 py-3 text-sm outline-none focus:ring-1"
        />

        <button
          type="button"
          onClick={handleSubmit}
          disabled={sending || !answer.trim()}
          className="bg-primary-main hover:bg-primary-light focus:ring-primary-main h-10 rounded px-4 text-sm font-semibold text-white transition focus:outline-none focus:ring-2 disabled:opacity-60"
        >
          {sending ? 'Submitting...' : 'Submit Answer'}
        </button>
      </div>
    </aside>
  );
}

export default StudyQuestionPanel;
