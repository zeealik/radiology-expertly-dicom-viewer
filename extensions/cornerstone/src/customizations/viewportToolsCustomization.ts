import { Enums } from '@cornerstonejs/tools';
import { toolNames } from '../initCornerstoneTools';

export default {
  'cornerstone.overlayViewportTools': {
    active: [
      {
        toolName: toolNames.Pan,
        bindings: [{ mouseButton: Enums.MouseBindings.Auxiliary }],
      },
      {
        toolName: toolNames.Zoom,
        bindings: [{ mouseButton: Enums.MouseBindings.Secondary }, { numTouchPoints: 2 }],
      },
      {
        toolName: toolNames.StackScroll,
        bindings: [
          { mouseButton: Enums.MouseBindings.Primary },
          { mouseButton: Enums.MouseBindings.Wheel },
          { numTouchPoints: 3 },
        ],
      },
    ],
    passive: [{ toolName: toolNames.WindowLevel }],
    enabled: [
      {
        toolName: toolNames.PlanarFreehandContourSegmentation,
        configuration: {
          displayOnePointAsCrosshairs: true,
        },
      },
    ],
  },
};
