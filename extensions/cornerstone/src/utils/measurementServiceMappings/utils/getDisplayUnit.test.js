import getDisplayUnit from './getDisplayUnit';

describe('getDisplayUnit', () => {
  it('reports lengths in millimetres when the image is calibrated', () => {
    expect(getDisplayUnit('mm')).toBe('mm');
    expect(getDisplayUnit('mm²')).toBe('mm²');
  });

  it('reports uncalibrated lengths in millimetres rather than pixels', () => {
    expect(getDisplayUnit('px')).toBe('mm');
    expect(getDisplayUnit('px²')).toBe('mm²');
    expect(getDisplayUnit('px³')).toBe('mm³');
  });

  it('maps the volume pixel units too', () => {
    expect(getDisplayUnit('pixels')).toBe('mm');
    expect(getDisplayUnit('voxels')).toBe('mm³');
  });

  it('leaves non-spatial units alone', () => {
    // Angle and modality units flow through the same helper and must not become millimetres.
    expect(getDisplayUnit('degrees')).toBe('degrees');
    expect(getDisplayUnit('HU')).toBe('HU');
    expect(getDisplayUnit('cm')).toBe('cm');
    expect(getDisplayUnit('%')).toBe('%');
  });

  it('renders a missing unit as an empty string', () => {
    expect(getDisplayUnit(null)).toBe('');
    expect(getDisplayUnit(undefined)).toBe('');
  });
});
