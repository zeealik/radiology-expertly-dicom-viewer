import {
  AngleTool,
  annotation,
  ArrowAnnotateTool,
  BidirectionalTool,
  CobbAngleTool,
  EllipticalROITool,
  CircleROITool,
  LengthTool,
  PlanarFreehandROITool,
  RectangleROITool,
} from '@cornerstonejs/tools';
import { Types } from '@ohif/core';

import DICOMSRDisplayTool from './tools/DICOMSRDisplayTool';
import addToolInstance from './utils/addToolInstance';
import toolNames from './tools/toolNames';

/**
 * @param {object} configuration
 */
export default function init({
  configuration = {},
  servicesManager,
}: Types.Extensions.ExtensionParams): void {
  addToolInstance(toolNames.DICOMSRDisplay, DICOMSRDisplayTool);
  addToolInstance(toolNames.SRLength, LengthTool);
  addToolInstance(toolNames.SRBidirectional, BidirectionalTool);
  addToolInstance(toolNames.SREllipticalROI, EllipticalROITool);
  addToolInstance(toolNames.SRCircleROI, CircleROITool);
  addToolInstance(toolNames.SRArrowAnnotate, ArrowAnnotateTool);
  addToolInstance(toolNames.SRAngle, AngleTool);
  addToolInstance(toolNames.SRPlanarFreehandROI, PlanarFreehandROITool);
  addToolInstance(toolNames.SRRectangleROI, RectangleROITool);

  // TODO - fix the SR display of Cobb Angle, as it joins the two lines
  addToolInstance(toolNames.SRCobbAngle, CobbAngleTool);

  const solidLine = {
    lineDash: '',
    lineWidth: '3',
    textBoxLinkLineDash: '',
    textBoxLinkLineWidth: '0',
  };
  annotation.config.style.setToolGroupToolStyles('SRToolGroup', {
    [toolNames.DICOMSRDisplay]: solidLine,
    SRLength: solidLine,
    SRBidirectional: solidLine,
    SREllipticalROI: solidLine,
    SRCircleROI: solidLine,
    SRArrowAnnotate: solidLine,
    SRCobbAngle: solidLine,
    SRAngle: solidLine,
    SRPlanarFreehandROI: solidLine,
    SRRectangleROI: solidLine,
    global: {},
  });
}
