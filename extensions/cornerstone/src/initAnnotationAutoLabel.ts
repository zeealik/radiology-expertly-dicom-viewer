import { isReadOnlyViewerAccess } from '@ohif/extension-default/src/ViewerLayout/studyParams';

/**
 * Prompts for a name as soon as an annotation is drawn, for every annotation tool.
 *
 * ArrowAnnotate already does this through its own `getTextCallback` configuration, which is a
 * Cornerstone3D tool option that no other tool exposes. The remaining tools therefore land in
 * the Findings panel with an empty label, so findings read as "(empty)" until someone renames
 * them by hand. Rather than duplicating tool-specific configuration, this listens for the
 * measurement service's own "a measurement appeared" event and reuses the existing
 * `setMeasurementLabel` command — the same dialog the rename action opens.
 *
 * MEASUREMENT_UPDATED already writes a label back onto the Cornerstone annotation
 * (`initMeasurementService`), so the name shows on the image as well as in the panel.
 */

/**
 * ArrowAnnotate prompts for its own text on creation; prompting again here would show two
 * dialogs for one annotation. Segmentation-backed and reference-only tools carry no user label.
 */
const SELF_LABELLING_TOOLS = new Set(['ArrowAnnotate']);
const UNLABELLED_TOOLS = new Set([
  'Crosshairs',
  'ReferenceLines',
  'DICOMSRDisplay',
  'PlanarFreehandContourSegmentation',
]);

/**
 * Resolves once no naming dialog is on screen.
 *
 * Auto-save also runs off MEASUREMENT_ADDED, so without this the report is serialized from an
 * annotation the user is still naming — the save and the dialog race, and the save usually
 * wins. Anything that persists measurements awaits this first so the label is part of what gets
 * written. It is module state because the two live in different extensions with no shared
 * service between them.
 */
let labellingSettled: Promise<unknown> = Promise.resolve();

export function whenLabellingSettled(): Promise<unknown> {
  return labellingSettled;
}

/**
 * Folds a dialog this module did not open into the same barrier, so a caller waiting on
 * `whenLabellingSettled` waits for that one too. ArrowAnnotate's prompt is opened by
 * Cornerstone rather than by this module, and registers itself through here.
 */
export function trackExternalLabelPrompt<T>(prompt: Promise<T>): Promise<T> {
  labellingSettled = labellingSettled.then(() => prompt).catch(() => undefined);

  return prompt;
}

function shouldPromptForLabel(measurement): boolean {
  const toolName = measurement?.metadata?.toolName ?? measurement?.toolName;

  if (!toolName || SELF_LABELLING_TOOLS.has(toolName) || UNLABELLED_TOOLS.has(toolName)) {
    return false;
  }

  // A measurement hydrated from a saved SR arrives with the label it was stored with; only a
  // freshly drawn, still-unnamed annotation should interrupt the user.
  return !measurement.label;
}

export default function initAnnotationAutoLabel({ servicesManager, commandsManager }): () => void {
  const { measurementService } = servicesManager.services;

  // A read-only viewer cannot create annotations, and must never pop an editing dialog over a
  // hydrated report as its measurements load.
  if (isReadOnlyViewerAccess()) {
    return () => {};
  }

  const promptForLabel = ({ measurement }) => {
    if (!shouldPromptForLabel(measurement)) {
      return;
    }

    // The label dialog is modal, so two annotations completed in quick succession would
    // otherwise race for it. Chaining onto the same promise that gates auto-save keeps one
    // prompt on screen at a time, in the order drawn.
    labellingSettled = labellingSettled
      .then(() => commandsManager.run('setMeasurementLabel', { uid: measurement.uid }))
      .catch(error => {
        console.warn('Failed to prompt for an annotation name:', error);
      });
  };

  const subscriptions = [
    measurementService.subscribe(measurementService.EVENTS.MEASUREMENT_ADDED, promptForLabel),
  ];

  return () => subscriptions.forEach(subscription => subscription?.unsubscribe?.());
}
