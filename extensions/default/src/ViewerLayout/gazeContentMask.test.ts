import { isContentAt, type ContentMask } from './gazeContentMask';

// 4x4 mask with content in the central 2x2 block (cols/rows 1..2).
function centralMask(): ContentMask {
  const cols = 4;
  const rows = 4;
  const data = new Uint8Array(cols * rows);

  for (let row = 1; row <= 2; row++) {
    for (let col = 1; col <= 2; col++) {
      data[row * cols + col] = 1;
    }
  }

  return {
    cols,
    rows,
    data,
    bbox: { x0: 1 / 4, y0: 1 / 4, x1: 3 / 4, y1: 3 / 4 },
  };
}

describe('isContentAt', () => {
  it('fails open when the mask is null', () => {
    expect(isContentAt(null, 0, 0)).toBe(true);
    expect(isContentAt(null, 0.99, 0.01)).toBe(true);
  });

  it('returns true for points on content cells', () => {
    const mask = centralMask();
    // center of the content region
    expect(isContentAt(mask, 0.5, 0.5)).toBe(true);
  });

  it('returns false for points on the black border', () => {
    const mask = centralMask();
    // corners are outside the central content block
    expect(isContentAt(mask, 0.05, 0.05)).toBe(false);
    expect(isContentAt(mask, 0.95, 0.95)).toBe(false);
  });

  it('rejects points outside the bounding box quickly', () => {
    const mask = centralMask();
    expect(isContentAt(mask, 0.1, 0.5)).toBe(false); // left of bbox
    expect(isContentAt(mask, 0.9, 0.5)).toBe(false); // right of bbox
  });

  it('returns false for non-finite coordinates', () => {
    const mask = centralMask();
    expect(isContentAt(mask, NaN, 0.5)).toBe(false);
    expect(isContentAt(mask, 0.5, Infinity)).toBe(false);
  });
});
