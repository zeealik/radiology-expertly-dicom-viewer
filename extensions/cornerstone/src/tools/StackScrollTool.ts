import { StackScrollTool as CornerstoneStackScrollTool } from '@cornerstonejs/tools';

const DEFAULT_WHEEL_SENSITIVITY = 3;

export default class StackScrollTool extends CornerstoneStackScrollTool {
  static toolName = CornerstoneStackScrollTool.toolName;

  private wheelDelta = 0;

  constructor(
    toolProps = {},
    defaultToolProps = {
      supportedInteractionTypes: ['Mouse', 'Touch'],
      configuration: {
        invert: true,
        debounceIfNotLoaded: true,
        loop: false,
        wheelSensitivity: DEFAULT_WHEEL_SENSITIVITY,
      },
    }
  ) {
    super(toolProps, defaultToolProps);
  }

  mouseWheelCallback(evt) {
    const wheelSensitivity = Math.max(1, this.configuration.wheelSensitivity || 1);

    if (wheelSensitivity === 1) {
      super.mouseWheelCallback(evt);
      return;
    }

    const direction = evt.detail.wheel.direction;

    if (!direction) {
      return;
    }

    this.wheelDelta += direction;

    if (Math.abs(this.wheelDelta) < wheelSensitivity) {
      return;
    }

    const steps = Math.trunc(this.wheelDelta / wheelSensitivity);
    this.wheelDelta %= wheelSensitivity;

    for (let i = 0; i < Math.abs(steps); i++) {
      super.mouseWheelCallback({
        ...evt,
        detail: {
          ...evt.detail,
          wheel: {
            ...evt.detail.wheel,
            direction: Math.sign(steps),
          },
        },
      });
    }
  }
}
