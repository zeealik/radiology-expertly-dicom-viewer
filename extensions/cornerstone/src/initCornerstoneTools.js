import {
  PanTool,
  WindowLevelTool,
  SegmentBidirectionalTool,
  VolumeRotateTool,
  ZoomTool,
  MIPJumpToClickTool,
  LengthTool,
  RectangleROITool,
  RectangleROIThresholdTool,
  EllipticalROITool,
  CircleROITool,
  BidirectionalTool,
  ArrowAnnotateTool,
  DragProbeTool,
  ProbeTool,
  AngleTool,
  CobbAngleTool,
  MagnifyTool,
  CrosshairsTool,
  RectangleScissorsTool,
  SphereScissorsTool,
  CircleScissorsTool,
  BrushTool,
  PaintFillTool,
  init,
  addTool,
  annotation,
  ReferenceLinesTool,
  TrackballRotateTool,
  AdvancedMagnifyTool,
  UltrasoundDirectionalTool,
  UltrasoundPleuraBLineTool,
  PlanarFreehandROITool,
  PlanarFreehandContourSegmentationTool,
  SplineROITool,
  LivewireContourTool,
  OrientationMarkerTool,
  WindowLevelRegionTool,
  SegmentSelectTool,
  RegionSegmentPlusTool,
  SegmentLabelTool,
  LivewireContourSegmentationTool,
  SculptorTool,
  SplineContourSegmentationTool,
  LabelMapEditWithContourTool,
} from '@cornerstonejs/tools';
import { LabelmapSlicePropagationTool, MarkerLabelmapTool } from '@cornerstonejs/ai';
import * as polySeg from '@cornerstonejs/polymorphic-segmentation';

import CalibrationLineTool from './tools/CalibrationLineTool';
import ImageOverlayViewerTool from './tools/ImageOverlayViewerTool';
import StackScrollTool from './tools/StackScrollTool';
import withMillimetreTextLines from './utils/withMillimetreTextLines';

export default function initCornerstoneTools(configuration = {}) {
  CrosshairsTool.isAnnotation = false;
  LabelmapSlicePropagationTool.isAnnotation = false;
  MarkerLabelmapTool.isAnnotation = false;
  ReferenceLinesTool.isAnnotation = false;
  AdvancedMagnifyTool.isAnnotation = false;
  PlanarFreehandContourSegmentationTool.isAnnotation = false;

  init({
    addons: {
      polySeg,
    },
    computeWorker: {
      autoTerminateOnIdle: {
        enabled: false,
      },
    },
  });
  addTool(PanTool);
  addTool(SegmentBidirectionalTool);
  addTool(WindowLevelTool);
  addTool(StackScrollTool);
  addTool(VolumeRotateTool);
  addTool(ZoomTool);
  addTool(withMillimetreTextLines(ProbeTool));
  addTool(MIPJumpToClickTool);
  addTool(withMillimetreTextLines(LengthTool));
  addTool(withMillimetreTextLines(RectangleROITool));
  addTool(RectangleROIThresholdTool);
  addTool(withMillimetreTextLines(EllipticalROITool));
  addTool(withMillimetreTextLines(CircleROITool));
  addTool(withMillimetreTextLines(BidirectionalTool));
  addTool(ArrowAnnotateTool);
  addTool(withMillimetreTextLines(DragProbeTool));
  addTool(withMillimetreTextLines(AngleTool));
  addTool(withMillimetreTextLines(CobbAngleTool));
  addTool(MagnifyTool);
  addTool(CrosshairsTool);
  addTool(RectangleScissorsTool);
  addTool(SphereScissorsTool);
  addTool(CircleScissorsTool);
  addTool(BrushTool);
  addTool(PaintFillTool);
  addTool(ReferenceLinesTool);
  addTool(CalibrationLineTool);
  addTool(TrackballRotateTool);
  addTool(ImageOverlayViewerTool);
  addTool(AdvancedMagnifyTool);
  addTool(withMillimetreTextLines(UltrasoundDirectionalTool));
  addTool(UltrasoundPleuraBLineTool);
  addTool(withMillimetreTextLines(PlanarFreehandROITool));
  addTool(withMillimetreTextLines(SplineROITool));
  addTool(withMillimetreTextLines(LivewireContourTool));
  addTool(OrientationMarkerTool);
  addTool(WindowLevelRegionTool);
  addTool(PlanarFreehandContourSegmentationTool);
  addTool(SegmentSelectTool);
  addTool(SegmentLabelTool);
  addTool(LabelmapSlicePropagationTool);
  addTool(MarkerLabelmapTool);
  addTool(RegionSegmentPlusTool);
  addTool(LivewireContourSegmentationTool);
  addTool(SculptorTool);
  addTool(SplineContourSegmentationTool);
  addTool(LabelMapEditWithContourTool);
  // Annotations are drawn in the viewer's own accent colour rather than Cornerstone's default
  // yellow-on-green, so a finding reads as part of the product instead of a debug overlay.
  // Greyscale and colour-Doppler ultrasound both sit under these marks, so the palette avoids
  // the reds and blues a Doppler overlay already uses.
  const ACCENT = 'rgb(20, 166, 245)';
  const ACCENT_HIGHLIGHTED = 'rgb(98, 196, 248)';
  const ACCENT_SELECTED = 'rgb(48, 232, 125)';
  const ACCENT_LOCKED = 'rgb(148, 163, 184)';

  const annotationStyle = {
    color: ACCENT,
    colorHighlighted: ACCENT_HIGHLIGHTED,
    colorSelected: ACCENT_SELECTED,
    colorLocked: ACCENT_LOCKED,

    // 2px reads as a deliberate line at the sizes these images are viewed at; the previous 3px
    // was heavy enough to hide the tissue boundary the annotation is meant to mark.
    lineWidth: '2',
    lineDash: '',

    // A drop shadow is what keeps a thin line legible over both the bright and the dark parts
    // of an ultrasound sector.
    shadow: true,

    textBoxFontFamily: 'Inter, Helvetica Neue, Helvetica, Arial, sans-serif',
    textBoxFontSize: '13px',
    textBoxColor: 'rgb(226, 240, 252)',
    textBoxColorHighlighted: 'rgb(255, 255, 255)',
    textBoxColorSelected: 'rgb(255, 255, 255)',
    textBoxColorLocked: ACCENT_LOCKED,

    // Text sits on its own translucent plate rather than directly on the image, which is what
    // makes the statistics readable over speckle without a heavier font.
    textBoxBackground: 'rgba(11, 22, 34, 0.72)',
    textBoxShadow: true,

    // Rounded corners and a little breathing room around the text, so the plate reads as a chip
    // rather than a hard-edged box cut out of the image.
    textBoxBorderRadius: 4,
    textBoxMargin: 4,

    // The leader line back to the annotation is restored, but hairline and dashed so it reads as
    // a connection rather than another measurement stroke.
    textBoxLinkLineWidth: '1',
    textBoxLinkLineDash: '2,3',

    markerSize: '8',
  };

  const defaultStyles = annotation.config.style.getDefaultToolStyles();
  annotation.config.style.setDefaultToolStyles({
    global: {
      ...defaultStyles.global,
      ...annotationStyle,
    },
    ArrowAnnotate: {
      ...defaultStyles.ArrowAnnotate,
      ...annotationStyle,
      // An arrow points straight at what it labels, so a leader line back to the text box would
      // only duplicate the arrow itself.
      textBoxLinkLineWidth: '0',
      textBoxLinkLineDash: '',
    },
  });
}

const toolNames = {
  Pan: PanTool.toolName,
  ArrowAnnotate: ArrowAnnotateTool.toolName,
  WindowLevel: WindowLevelTool.toolName,
  StackScroll: StackScrollTool.toolName,
  Zoom: ZoomTool.toolName,
  VolumeRotate: VolumeRotateTool.toolName,
  MipJumpToClick: MIPJumpToClickTool.toolName,
  Length: LengthTool.toolName,
  DragProbe: DragProbeTool.toolName,
  Probe: ProbeTool.toolName,
  RectangleROI: RectangleROITool.toolName,
  RectangleROIThreshold: RectangleROIThresholdTool.toolName,
  EllipticalROI: EllipticalROITool.toolName,
  CircleROI: CircleROITool.toolName,
  Bidirectional: BidirectionalTool.toolName,
  Angle: AngleTool.toolName,
  CobbAngle: CobbAngleTool.toolName,
  Magnify: MagnifyTool.toolName,
  Crosshairs: CrosshairsTool.toolName,
  Brush: BrushTool.toolName,
  PaintFill: PaintFillTool.toolName,
  ReferenceLines: ReferenceLinesTool.toolName,
  CalibrationLine: CalibrationLineTool.toolName,
  TrackballRotateTool: TrackballRotateTool.toolName,
  CircleScissors: CircleScissorsTool.toolName,
  RectangleScissors: RectangleScissorsTool.toolName,
  SphereScissors: SphereScissorsTool.toolName,
  ImageOverlayViewer: ImageOverlayViewerTool.toolName,
  AdvancedMagnify: AdvancedMagnifyTool.toolName,
  UltrasoundDirectional: UltrasoundDirectionalTool.toolName,
  UltrasoundAnnotation: UltrasoundPleuraBLineTool.toolName,
  SplineROI: SplineROITool.toolName,
  LivewireContour: LivewireContourTool.toolName,
  PlanarFreehandROI: PlanarFreehandROITool.toolName,
  OrientationMarker: OrientationMarkerTool.toolName,
  WindowLevelRegion: WindowLevelRegionTool.toolName,
  PlanarFreehandContourSegmentation: PlanarFreehandContourSegmentationTool.toolName,
  SegmentBidirectional: SegmentBidirectionalTool.toolName,
  SegmentSelect: SegmentSelectTool.toolName,
  SegmentLabel: SegmentLabelTool.toolName,
  LabelmapSlicePropagation: LabelmapSlicePropagationTool.toolName,
  MarkerLabelmap: MarkerLabelmapTool.toolName,
  RegionSegmentPlus: RegionSegmentPlusTool.toolName,
  LivewireContourSegmentation: LivewireContourSegmentationTool.toolName,
  SculptorTool: SculptorTool.toolName,
  SplineContourSegmentation: SplineContourSegmentationTool.toolName,
  LabelMapEditWithContourTool: LabelMapEditWithContourTool.toolName,
};

export { toolNames };
