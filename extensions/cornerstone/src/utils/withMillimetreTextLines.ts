import getDisplayUnit from './measurementServiceMappings/utils/getDisplayUnit';

/**
 * Rewrites the pixel units in a tool's on-image text box so the canvas agrees with the
 * Findings panel.
 *
 * Cornerstone3D draws the measurement text itself, from `configuration.getTextLines`, and falls
 * back to pixel units whenever an image carries no pixel spacing. The measurement mappings that
 * feed the Findings panel already map those onto millimetres via `getDisplayUnit`, so without
 * this the same ellipse reads "Area: 87212 px²" on the image and "87212 mm²" in the panel.
 *
 * The tool's own implementation is wrapped rather than reimplemented: each tool composes its own
 * text (area, mean, max, std dev, L/W, angles …) and that logic changes between Cornerstone
 * releases. Only the unit token is rewritten, so new statistics keep working untouched.
 */

/**
 * Matches a pixel unit only as a whole word, so a modality unit that merely contains the letters,
 * or a label the user typed, is left alone.
 */
const PIXEL_UNIT_PATTERN = /\b(px[²³]?|pixels|voxels)\b/g;

export function toMillimetreText(line: unknown): unknown {
  if (typeof line !== 'string') {
    return line;
  }

  return line.replace(PIXEL_UNIT_PATTERN, match => getDisplayUnit(match));
}

/**
 * Returns a subclass of `ToolClass` whose instances render millimetre units.
 *
 * The default `getTextLines` lives in the tool constructor's `defaultToolProps`, so it is only
 * reachable once an instance exists — hence wrapping in the subclass constructor rather than
 * patching the prototype.
 */
type AnnotationToolInstance = {
  configuration?: { getTextLines?: (...args: unknown[]) => unknown };
};

type AnnotationToolClass = new (...args: never[]) => AnnotationToolInstance;

export default function withMillimetreTextLines<T extends AnnotationToolClass>(ToolClass: T): T {
  class MillimetreTextLinesTool extends (ToolClass as AnnotationToolClass) {
    constructor(...args: never[]) {
      super(...args);

      const getTextLines = this.configuration?.getTextLines;

      if (typeof getTextLines !== 'function') {
        return;
      }

      this.configuration.getTextLines = (...textLineArgs: unknown[]) => {
        const textLines = getTextLines.apply(this, textLineArgs);

        return Array.isArray(textLines) ? textLines.map(toMillimetreText) : textLines;
      };
    }
  }

  return MillimetreTextLinesTool as unknown as T;
}
