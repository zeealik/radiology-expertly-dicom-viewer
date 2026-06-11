import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Enums, VolumeViewport3D } from '@cornerstonejs/core';
import { Icons, useViewportGrid } from '@ohif/ui-next';
import { getHeatmapsBySlice } from './gazeHeatmapUtils';
import type { GazeRecord } from './gazeHeatmapUtils';

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
  viewportId: string | null;
  slice: number | null;
  numberOfSlices: number | null;
  timestamp: string;
};

type StudyQuestionAnswerPayload = SubmittedAnswer & {
  type: 'OHIF_STUDY_QUESTION_ANSWER';
  studyInstanceUIDs: string[];
  url: string;
};

type StudyQuestionReviewPayload = {
  type: 'OHIF_STUDY_QUESTION_REVIEW';
  answers: SubmittedAnswer[];
  gazeRecords: GazeRecord[];
  heatmapsBySlice: ReturnType<typeof getHeatmapsBySlice>;
  studyInstanceUIDs: string[];
  numberOfSlices: number | null;
  url: string;
  timestamp: string;
};

type StudyQuestionBridge = {
  onSubmitQuestionAnswer?: (payload: string) => void;
  onSubmitFeedback?: (payload: string) => void;
  onSubmitQuestionReview?: (payload: string) => void;
  onSubmitStudyQuestionReview?: (payload: string) => void;
};

type ViewportSliceEvent = Event & {
  detail?: {
    imageIndex?: number;
    newImageIdIndex?: number;
    imageIdIndex?: number;
  };
};

type StackLikeViewport = {
  element?: HTMLElement;
  getCurrentImageIdIndex?: () => number;
  getNumberOfSlices?: () => number;
};

type CornerstoneViewportService = {
  EVENTS?: {
    VIEWPORT_DATA_CHANGED?: string;
  };
  resize?: () => void;
  getCornerstoneViewport: (viewportId: string) => StackLikeViewport | VolumeViewport3D | undefined;
  subscribe?: (
    eventName: string,
    callback: (event: { viewportId?: string }) => void
  ) => { unsubscribe?: () => void };
};

const REVIEW_STORAGE_KEY = 'ohif.studyQuestionReview';
const MAX_REVIEW_GAZE_RECORDS = 5000;

const DEFAULT_QUESTIONS: StudyQuestion[] = [
  {
    id: 'initial-impression',
    text: 'What is your primary impression from this study?',
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

function dispatchStudyQuestionAnswer(payload: StudyQuestionAnswerPayload) {
  const bridge = (window as Window & { OHIFBridge?: StudyQuestionBridge }).OHIFBridge;

  try {
    if (bridge && typeof bridge.onSubmitQuestionAnswer === 'function') {
      bridge.onSubmitQuestionAnswer(JSON.stringify(payload));
    } else if (bridge && typeof bridge.onSubmitFeedback === 'function') {
      bridge.onSubmitFeedback(JSON.stringify(payload));
    } else if (window.parent && window.parent !== window) {
      window.parent.postMessage(payload, '*');
    } else {
      // eslint-disable-next-line no-console
      console.log('[StudyQuestionPanel] no study question bridge - payload:', payload);
    }
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error('[StudyQuestionPanel] failed to dispatch', err);
  }
}

function dispatchStudyQuestionReview(payload: StudyQuestionReviewPayload) {
  const bridge = (window as Window & { OHIFBridge?: StudyQuestionBridge }).OHIFBridge;

  try {
    if (bridge && typeof bridge.onSubmitQuestionReview === 'function') {
      bridge.onSubmitQuestionReview(JSON.stringify(payload));
    } else if (bridge && typeof bridge.onSubmitStudyQuestionReview === 'function') {
      bridge.onSubmitStudyQuestionReview(JSON.stringify(payload));
    } else if (window.parent && window.parent !== window) {
      window.parent.postMessage(payload, '*');
    } else {
      // eslint-disable-next-line no-console
      console.log('[StudyQuestionPanel] no review bridge - payload:', payload);
    }
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error('[StudyQuestionPanel] failed to dispatch review', err);
  }
}

function getReviewPath(): string {
  const url = new URL(window.location.href);
  url.searchParams.set('studyReview', '1');

  return `${url.pathname}${url.search}`;
}

function saveReviewData(
  answers: SubmittedAnswer[],
  numberOfSlices: number | null,
  gazeRecords: GazeRecord[]
): StudyQuestionReviewPayload {
  const payload: StudyQuestionReviewPayload = {
    type: 'OHIF_STUDY_QUESTION_REVIEW',
    answers,
    gazeRecords,
    heatmapsBySlice: getHeatmapsBySlice(gazeRecords),
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

type StudyQuestionPanelProps = withAppTypes<{
  onToggleCollapsed?: () => void;
}>;

function StudyQuestionPanel({
  servicesManager,
  onToggleCollapsed,
}: StudyQuestionPanelProps): React.ReactElement {
  const navigate = useNavigate();
  const [{ activeViewportId }] = useViewportGrid();
  const { customizationService } = servicesManager.services;
  const cornerstoneViewportService = (
    servicesManager.services as typeof servicesManager.services & {
      cornerstoneViewportService?: CornerstoneViewportService;
    }
  ).cornerstoneViewportService;
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
  const gazeRecordsRef = useRef<GazeRecord[]>([]);
  const [sending, setSending] = useState(false);

  const showQuestion = useCallback(
    (question?: StudyQuestion) => {
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
    gazeRecordsRef.current = [];
  }, [questions]);

  useEffect(() => {
    const handleGazeRecord = (event: Event) => {
      const record = (event as CustomEvent<GazeRecord>).detail;

      if (!record) {
        return;
      }

      gazeRecordsRef.current = [...gazeRecordsRef.current, record].slice(-MAX_REVIEW_GAZE_RECORDS);
    };

    window.addEventListener('ohif-gaze-record', handleGazeRecord);

    return () => {
      window.removeEventListener('ohif-gaze-record', handleGazeRecord);
    };
  }, []);

  useEffect(() => {
    const timeoutId = window.setTimeout(() => cornerstoneViewportService?.resize?.(), 50);

    return () => window.clearTimeout(timeoutId);
  }, [cornerstoneViewportService]);

  useEffect(() => {
    if (!activeViewportId || !cornerstoneViewportService) {
      return;
    }

    let removeViewportListeners: (() => void) | undefined;
    let retryIntervalId: number | undefined;

    const syncSliceState = (event?: ViewportSliceEvent) => {
      const latestViewport = cornerstoneViewportService.getCornerstoneViewport(activeViewportId);
      if (!latestViewport || latestViewport instanceof VolumeViewport3D) {
        setSliceState({
          imageIndex: null,
          numberOfSlices: null,
        });
        return false;
      }

      const { imageIndex, newImageIdIndex = imageIndex, imageIdIndex } = event?.detail || {};
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
      const sliceQuestion =
        currentSlice === null
          ? undefined
          : questions.find(question => getQuestionSliceTriggers(question).includes(currentSlice));

      if (sliceQuestion) {
        showQuestion(sliceQuestion);
      }

      return true;
    };

    const attachViewportListeners = () => {
      const viewport = cornerstoneViewportService.getCornerstoneViewport(activeViewportId);
      const element = viewport?.element;

      if (!viewport || !element || viewport instanceof VolumeViewport3D) {
        syncSliceState();
        return false;
      }

      removeViewportListeners?.();

      const updateSlice = (event: ViewportSliceEvent) => {
        syncSliceState(event);
      };

      syncSliceState();

      element.addEventListener(Enums.Events.STACK_NEW_IMAGE, updateSlice);
      element.addEventListener(Enums.Events.VOLUME_NEW_IMAGE, updateSlice);
      element.addEventListener(Enums.Events.IMAGE_RENDERED, updateSlice);

      removeViewportListeners = () => {
        element.removeEventListener(Enums.Events.STACK_NEW_IMAGE, updateSlice);
        element.removeEventListener(Enums.Events.VOLUME_NEW_IMAGE, updateSlice);
        element.removeEventListener(Enums.Events.IMAGE_RENDERED, updateSlice);
      };

      return true;
    };

    if (!attachViewportListeners()) {
      retryIntervalId = window.setInterval(() => {
        if (attachViewportListeners() && retryIntervalId) {
          window.clearInterval(retryIntervalId);
          retryIntervalId = undefined;
        }
      }, 250);
    }

    const viewportDataChangedEvent = cornerstoneViewportService.EVENTS?.VIEWPORT_DATA_CHANGED || '';
    const subscription =
      viewportDataChangedEvent && cornerstoneViewportService.subscribe
        ? cornerstoneViewportService.subscribe(viewportDataChangedEvent, event => {
            if (!event?.viewportId || event.viewportId === activeViewportId) {
              attachViewportListeners();
            }
          })
        : undefined;

    return () => {
      if (retryIntervalId) {
        window.clearInterval(retryIntervalId);
      }

      subscription?.unsubscribe?.();
      removeViewportListeners?.();
    };
  }, [activeViewportId, cornerstoneViewportService, questions, showQuestion]);

  useEffect(() => {
    const intervalQuestions = questions.filter(
      (question): question is StudyQuestion & { intervalSeconds: number } =>
        typeof question.intervalSeconds === 'number'
    );
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
      const question = unansweredQuestions.length
        ? unansweredQuestions[Math.floor(Math.random() * unansweredQuestions.length)]
        : undefined;

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
    const submittedAnswer: SubmittedAnswer = {
      questionId: activeQuestion.id,
      questionText: activeQuestion.text,
      answer: answer.trim(),
      viewportId: activeViewportId || null,
      slice: sliceState.imageIndex === null ? null : sliceState.imageIndex + 1,
      numberOfSlices: sliceState.numberOfSlices,
      timestamp,
    };

    const payload: StudyQuestionAnswerPayload = {
      type: 'OHIF_STUDY_QUESTION_ANSWER',
      ...submittedAnswer,
      studyInstanceUIDs: getStudyInstanceUIDs(),
      url: window.location.href,
    };

    dispatchStudyQuestionAnswer(payload);
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
      const reviewPayload = saveReviewData(
        nextSubmittedAnswers,
        sliceState.numberOfSlices,
        gazeRecordsRef.current
      );
      dispatchStudyQuestionReview(reviewPayload);
      window.setTimeout(() => {
        navigate(getReviewPath());
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
    navigate,
  ]);

  const answeredCount = submittedQuestionIds.length;
  const currentSliceLabel =
    sliceState.imageIndex === null
      ? 'Slice -'
      : `Slice ${sliceState.imageIndex + 1}${sliceState.numberOfSlices ? ` / ${sliceState.numberOfSlices}` : ''}`;

  return (
    <aside className="border-input bg-muted/30 flex h-full w-full min-w-0 shrink-0 flex-col border-l">
      <div className="border-input flex min-h-[56px] items-center justify-between gap-3 border-b px-4 sm:px-5">
        <div className="min-w-0">
          <div className="text-foreground truncate text-base font-semibold">Study Question</div>
          <div className="text-muted-foreground mt-0.5 text-xs">{currentSliceLabel}</div>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <div className="bg-background text-muted-foreground rounded px-2 py-1 text-xs">
            {answeredCount}/{questions.length}
          </div>
          {onToggleCollapsed && (
            <button
              type="button"
              onClick={onToggleCollapsed}
              aria-label="Collapse study question panel"
              title="Collapse study question panel"
              className="hover:bg-primary/10 focus:ring-primary-main text-primary flex h-8 w-8 items-center justify-center rounded transition focus:outline-none focus:ring-2"
            >
              <Icons.SidePanelCloseRight className="h-5 w-5" />
            </button>
          )}
        </div>
      </div>

      <div className="flex min-h-0 flex-1 flex-col gap-3 px-4 py-4 sm:gap-4 sm:px-5">
        <div className="border-input bg-background rounded border p-3 sm:p-4">
          <div className="text-foreground text-sm font-medium leading-6">
            {activeQuestion?.text}
          </div>
        </div>

        <textarea
          value={answer}
          onChange={event => setAnswer(event.target.value)}
          placeholder="Enter your answer"
          className="border-input bg-background text-foreground focus:border-primary-main focus:ring-primary-main min-h-[140px] w-full flex-1 resize-none rounded border px-3 py-3 text-sm outline-none focus:ring-1 sm:min-h-[180px]"
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
