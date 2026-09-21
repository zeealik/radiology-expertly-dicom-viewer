import initAnnotationAutoLabel, {
  whenLabellingSettled,
  trackExternalLabelPrompt,
} from './initAnnotationAutoLabel';

jest.mock('@ohif/extension-default/src/ViewerLayout/studyParams', () => ({
  isReadOnlyViewerAccess: jest.fn(() => false),
}));

// eslint-disable-next-line @typescript-eslint/no-var-requires
const { isReadOnlyViewerAccess } = require('@ohif/extension-default/src/ViewerLayout/studyParams');

const MEASUREMENT_ADDED = 'event::measurement_added';

/**
 * Prompts are queued, so each one resolves a full promise chain later than the last. Yielding to
 * the macrotask queue drains every pending microtask regardless of how deep that chain is.
 */
const flush = () => new Promise(resolve => setTimeout(resolve, 0));

function createHarness() {
  const handlers: Record<string, Array<(payload: unknown) => void>> = {};
  const unsubscribe = jest.fn();

  const measurementService = {
    EVENTS: { MEASUREMENT_ADDED },
    subscribe: jest.fn((event: string, handler) => {
      handlers[event] = handlers[event] || [];
      handlers[event].push(handler);
      return { unsubscribe };
    }),
  };

  const commandsManager = { run: jest.fn(() => Promise.resolve()) };

  const emitAdded = measurement =>
    (handlers[MEASUREMENT_ADDED] || []).forEach(handler => handler({ measurement }));

  return {
    measurementService,
    commandsManager,
    unsubscribe,
    emitAdded,
    servicesManager: { services: { measurementService } },
  };
}

describe('initAnnotationAutoLabel', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (isReadOnlyViewerAccess as jest.Mock).mockReturnValue(false);
  });

  it('prompts for a name when an unnamed annotation is drawn', async () => {
    const harness = createHarness();
    initAnnotationAutoLabel(harness);

    harness.emitAdded({ uid: 'measurement-1', toolName: 'RectangleROI', label: '' });
    await flush();

    expect(harness.commandsManager.run).toHaveBeenCalledWith('setMeasurementLabel', {
      uid: 'measurement-1',
    });
  });

  it('prompts for every annotation tool, not just the ROI ones', async () => {
    const harness = createHarness();
    initAnnotationAutoLabel(harness);

    ['Length', 'Bidirectional', 'EllipticalROI', 'Angle', 'CobbAngle', 'Probe'].forEach(
      (toolName, index) => harness.emitAdded({ uid: `measurement-${index}`, toolName, label: '' })
    );
    await flush();

    expect(harness.commandsManager.run).toHaveBeenCalledTimes(6);
  });

  it('does not prompt twice for ArrowAnnotate, which asks for its own text', () => {
    const harness = createHarness();
    initAnnotationAutoLabel(harness);

    harness.emitAdded({ uid: 'measurement-1', toolName: 'ArrowAnnotate', label: '' });

    expect(harness.commandsManager.run).not.toHaveBeenCalled();
  });

  it('leaves an annotation that already carries a label alone', () => {
    const harness = createHarness();
    initAnnotationAutoLabel(harness);

    harness.emitAdded({ uid: 'measurement-1', toolName: 'Length', label: 'Pleural thickness' });

    expect(harness.commandsManager.run).not.toHaveBeenCalled();
  });

  it('ignores tools that carry no user label', () => {
    const harness = createHarness();
    initAnnotationAutoLabel(harness);

    ['Crosshairs', 'ReferenceLines', 'PlanarFreehandContourSegmentation'].forEach(toolName =>
      harness.emitAdded({ uid: 'measurement-1', toolName, label: '' })
    );

    expect(harness.commandsManager.run).not.toHaveBeenCalled();
  });

  it('reads the tool name from annotation metadata when it is not top level', async () => {
    const harness = createHarness();
    initAnnotationAutoLabel(harness);

    harness.emitAdded({ uid: 'measurement-1', metadata: { toolName: 'CircleROI' }, label: '' });
    await flush();

    expect(harness.commandsManager.run).toHaveBeenCalledWith('setMeasurementLabel', {
      uid: 'measurement-1',
    });
  });

  it('never opens a dialog in a read-only viewer', () => {
    const harness = createHarness();
    (isReadOnlyViewerAccess as jest.Mock).mockReturnValue(true);

    initAnnotationAutoLabel(harness);

    expect(harness.measurementService.subscribe).not.toHaveBeenCalled();
  });

  it('queues prompts so two quick annotations do not race for the modal dialog', async () => {
    const harness = createHarness();
    const order: string[] = [];
    let resolveFirst: () => void = () => {};

    (harness.commandsManager.run as jest.Mock).mockImplementation((_command, { uid }) => {
      order.push(`start:${uid}`);
      if (uid === 'measurement-1') {
        return new Promise<void>(resolve => {
          resolveFirst = () => {
            order.push('end:measurement-1');
            resolve();
          };
        });
      }
      return Promise.resolve();
    });

    initAnnotationAutoLabel(harness);

    harness.emitAdded({ uid: 'measurement-1', toolName: 'Length', label: '' });
    harness.emitAdded({ uid: 'measurement-2', toolName: 'Length', label: '' });
    await flush();

    // The second prompt must not have opened while the first is still on screen.
    expect(order).toEqual(['start:measurement-1']);

    resolveFirst();
    await flush();

    expect(order).toEqual(['start:measurement-1', 'end:measurement-1', 'start:measurement-2']);
  });

  it('keeps prompting after one prompt fails', async () => {
    const harness = createHarness();
    (harness.commandsManager.run as jest.Mock)
      .mockRejectedValueOnce(new Error('dialog unavailable'))
      .mockResolvedValue(undefined);
    jest.spyOn(console, 'warn').mockImplementation(() => {});

    initAnnotationAutoLabel(harness);

    harness.emitAdded({ uid: 'measurement-1', toolName: 'Length', label: '' });
    await flush();
    harness.emitAdded({ uid: 'measurement-2', toolName: 'Length', label: '' });
    await flush();

    expect(harness.commandsManager.run).toHaveBeenLastCalledWith('setMeasurementLabel', {
      uid: 'measurement-2',
    });
  });

  it('holds the labelling barrier open until the prompt is answered', async () => {
    const harness = createHarness();
    let answerPrompt: () => void = () => {};
    let barrierSettled = false;

    (harness.commandsManager.run as jest.Mock).mockImplementation(
      () => new Promise<void>(resolve => (answerPrompt = resolve))
    );

    initAnnotationAutoLabel(harness);
    harness.emitAdded({ uid: 'measurement-1', toolName: 'Length', label: '' });

    whenLabellingSettled().then(() => (barrierSettled = true));
    await flush();

    // Auto-save waits on this promise, so it must not resolve while the dialog is open.
    expect(barrierSettled).toBe(false);

    answerPrompt();
    await flush();

    expect(barrierSettled).toBe(true);
  });

  it('resolves the barrier immediately when no dialog is open', async () => {
    const harness = createHarness();
    initAnnotationAutoLabel(harness);

    // A tool that never prompts must not leave a save waiting forever.
    harness.emitAdded({ uid: 'measurement-1', toolName: 'ArrowAnnotate', label: '' });

    let settled = false;
    whenLabellingSettled().then(() => (settled = true));
    await flush();

    expect(settled).toBe(true);
  });

  it('waits for a prompt this module did not open', async () => {
    let answerPrompt: () => void = () => {};
    let barrierSettled = false;

    const externalPrompt = new Promise<string>(resolve => {
      answerPrompt = () => resolve('typed label');
    });

    trackExternalLabelPrompt(externalPrompt);
    whenLabellingSettled().then(() => (barrierSettled = true));
    await flush();

    expect(barrierSettled).toBe(false);

    answerPrompt();
    await flush();

    expect(barrierSettled).toBe(true);
  });

  it('releases the barrier when a prompt fails, so saving is never wedged', async () => {
    const harness = createHarness();
    (harness.commandsManager.run as jest.Mock).mockRejectedValue(new Error('dialog unavailable'));
    jest.spyOn(console, 'warn').mockImplementation(() => {});

    initAnnotationAutoLabel(harness);
    harness.emitAdded({ uid: 'measurement-1', toolName: 'Length', label: '' });

    let settled = false;
    whenLabellingSettled().then(() => (settled = true));
    await flush();

    // A rejected prompt must still release the barrier, or auto-save would hang forever.
    expect(settled).toBe(true);
  });

  it('unsubscribes when torn down', () => {
    const harness = createHarness();
    const teardown = initAnnotationAutoLabel(harness);

    teardown();

    expect(harness.unsubscribe).toHaveBeenCalled();
  });
});
