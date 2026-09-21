/**
 * Spatial units are reported in millimetres throughout the viewer.
 *
 * Cornerstone3D falls back to pixel units (`px`, `px²`) whenever an image carries no pixel
 * spacing, which is common for the ultrasound captures in this deployment. Radiologists read
 * these findings in millimetres, so the pixel labels are mapped onto their millimetre
 * equivalents (1 px treated as 1 mm) rather than surfacing two different unit systems in the
 * same findings list.
 *
 * Only the pixel labels are rewritten — angles (`degrees`) and modality units (`HU`, `MO`, …)
 * flow through this helper too and must be left alone.
 */
const PIXEL_UNIT_TO_MILLIMETRE = {
  px: 'mm',
  'px²': 'mm²',
  'px³': 'mm³',
  pixels: 'mm',
  voxels: 'mm³',
};

const getDisplayUnit = unit => {
  if (unit == null) {
    return '';
  }

  return PIXEL_UNIT_TO_MILLIMETRE[unit] ?? unit;
};

export default getDisplayUnit;
