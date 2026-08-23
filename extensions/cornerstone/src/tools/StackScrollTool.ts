import { StackScrollTool as CornerstoneStackScrollTool } from '@cornerstonejs/tools';

const DEFAULT_WHEEL_SENSITIVITY = 3;
const WHEEL_PIXELS_PER_STEP = 40;
const DEFAULT_MAX_WHEEL_STEPS_PER_EVENT = 3;

export default class StackScrollTool extends CornerstoneStackScrollTool {
  static toolName = CornerstoneStackScrollTool.toolName;

  private wheelPixelDelta = 0;

  constructor(
    toolProps = {},
    defaultToolProps = {
      supportedInteractionTypes: ['Mouse', 'Touch'],
      configuration: {
        invert: true,
        debounceIfNotLoaded: true,
        loop: false,
        wheelSensitivity: DEFAULT_WHEEL_SENSITIVITY,
        maxWheelStepsPerEvent: DEFAULT_MAX_WHEEL_STEPS_PER_EVENT,
      },
    }
  ) {
    super(toolProps, defaultToolProps);
  }

  mouseWheelCallback(evt) {
    const wheel = evt.detail.wheel;
    const rawPixelY = Number(wheel.pixelY);
    const direction = Number(wheel.direction);
    const pixelY = Number.isFinite(rawPixelY) && rawPixelY !== 0
      ? rawPixelY
      : direction * WHEEL_PIXELS_PER_STEP;

    if (!pixelY) {
      return;
    }

    const wheelSensitivity = Math.max(1, Number(this.configuration.wheelSensitivity) || 1);
    const pixelsPerStep = Math.max(1, WHEEL_PIXELS_PER_STEP * wheelSensitivity);

    this.wheelPixelDelta += pixelY;

    if (Math.abs(this.wheelPixelDelta) < pixelsPerStep) {
      return;
    }

    const maxStepsPerEvent = Math.max(
      1,
      Number(this.configuration.maxWheelStepsPerEvent) || DEFAULT_MAX_WHEEL_STEPS_PER_EVENT
    );
    const rawSteps = Math.trunc(this.wheelPixelDelta / pixelsPerStep);
    const steps = Math.sign(rawSteps) * Math.min(Math.abs(rawSteps), maxStepsPerEvent);

    this.wheelPixelDelta -= steps * pixelsPerStep;

    for (let i = 0; i < Math.abs(steps); i++) {
      super.mouseWheelCallback({
        ...evt,
        detail: {
          ...evt.detail,
          wheel: {
            ...wheel,
            direction: Math.sign(steps),
          },
        },
      });
    }
  }
}
