/**
 * Master switch for webcam-based gaze (EyeGestures) and head tracking.
 *
 * Disabled on this branch: the viewer must never request camera access — not on
 * load, not on refresh, not for any user or access mode. With this off:
 *  - the EyeGestures browser client and head tracking are never installed,
 *  - the "Eye calibration required" gate is skipped and viewports render directly,
 *  - head tracking's start() refuses to open the camera even if called.
 *
 * Flip to true to restore the gaze-heatmap / head-tracking flow.
 */
export const GAZE_TRACKING_ENABLED = false;
