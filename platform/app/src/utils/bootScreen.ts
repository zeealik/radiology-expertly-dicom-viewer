/**
 * Bridge to the boot screen defined inline in `public/html-templates/index.html`.
 *
 * The boot screen is plain HTML so it is visible while the app bundle is still
 * downloading. It shows a "taking longer than usual" hint on slow connections and
 * a friendly error with a retry button when start-up fails. The app tells it when
 * the viewer is ready (hide) or when start-up failed (show error).
 */

type BootScreenApi = {
  setMessage: (message: string) => void;
  ready: () => void;
  fail: (title: string, message: string) => void;
};

declare global {
  interface Window {
    __radiologyExpertlyBoot?: BootScreenApi;
  }
}

export const BOOT_ERROR_COPY = {
  appStart: {
    title: "The viewer couldn't start",
    message:
      'Something went wrong while starting the viewer. Check your internet connection and try again.',
  },
  caseLoad: {
    title: "This case couldn't be loaded",
    message:
      "The case images couldn't be downloaded. Check your internet connection and try again.",
  },
} as const;

let studyRouteMounted = false;

function getBootScreen(): BootScreenApi | undefined {
  return typeof window === 'undefined' ? undefined : window.__radiologyExpertlyBoot;
}

export function setBootMessage(message: string) {
  getBootScreen()?.setMessage(message);
}

export function markBootReady() {
  getBootScreen()?.ready();
}

export function failBoot(copy: { title: string; message: string }, error?: unknown) {
  if (error) {
    console.error(error);
  }
  getBootScreen()?.fail(copy.title, copy.message);
}

/** Called by the study (mode) route so the app keeps the boot screen up until images arrive. */
export function markStudyRouteMounted() {
  studyRouteMounted = true;
}

export function hasStudyRouteMounted() {
  return studyRouteMounted;
}

export function urlOpensStudy(
  search = typeof window === 'undefined' ? '' : window.location.search
) {
  const searchParams = new URLSearchParams(search);
  for (const key of searchParams.keys()) {
    const lowerKey = key.toLowerCase();
    if (lowerKey === 'studyinstanceuids' || lowerKey === 'studyinstanceuid') {
      return true;
    }
  }
  return false;
}
