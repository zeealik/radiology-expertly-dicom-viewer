export type ContentMask = {
  cols: number;
  rows: number;
  data: Uint8Array; // 1 = meaningful content, 0 = black / irrelevant
  bbox: { x0: number; y0: number; x1: number; y1: number }; // normalized content bounds (0-1)
};

type ComputeContentMaskOptions = {
  grid?: number;
  luminanceThreshold?: number;
};

const DEFAULT_GRID = 64;
// 0-255 luminance below this counts as black / non-diagnostic border.
const DEFAULT_LUMINANCE_THRESHOLD = 12;

/**
 * Resolve the cornerstone-owned rendering canvas for a viewport. Prefers the
 * viewport's own getCanvas(); falls back to the first canvas inside the element
 * (excluding our heatmap overlay canvas, which is aria-hidden).
 */
export function getViewportCanvas(viewport: any): HTMLCanvasElement | null {
  const direct = viewport?.getCanvas?.();
  if (direct instanceof HTMLCanvasElement) {
    return direct;
  }

  const element: HTMLElement | undefined = viewport?.element;
  if (!element) {
    return null;
  }

  const canvases = Array.from(element.querySelectorAll('canvas')) as HTMLCanvasElement[];
  const owned = canvases.find(canvas => canvas.getAttribute('aria-hidden') !== 'true');

  return owned ?? canvases[0] ?? null;
}

/**
 * Build a low-resolution luminance mask of the rendered scan so heatmap data can
 * be restricted to the meaningful image content and excluded from the black
 * non-diagnostic border. Returns null (fail-open) if the canvas pixels cannot be
 * read (e.g. tainted) or the slice is effectively blank.
 */
export function computeContentMask(
  canvas: HTMLCanvasElement | null,
  opts: ComputeContentMaskOptions = {}
): ContentMask | null {
  if (!canvas || !canvas.width || !canvas.height) {
    return null;
  }

  const grid = opts.grid ?? DEFAULT_GRID;
  const threshold = opts.luminanceThreshold ?? DEFAULT_LUMINANCE_THRESHOLD;

  let pixels: Uint8ClampedArray;

  try {
    const offscreen = document.createElement('canvas');
    offscreen.width = grid;
    offscreen.height = grid;
    const context = offscreen.getContext('2d', { willReadFrequently: true });

    if (!context) {
      return null;
    }

    // drawImage downsamples (browser-averaged) so we read a small grid cheaply.
    context.drawImage(canvas, 0, 0, grid, grid);
    pixels = context.getImageData(0, 0, grid, grid).data;
  } catch {
    // getImageData throws on tainted canvases – fail open.
    return null;
  }

  const raw = new Uint8Array(grid * grid);
  let contentCells = 0;

  for (let i = 0; i < grid * grid; i++) {
    const r = pixels[i * 4];
    const g = pixels[i * 4 + 1];
    const b = pixels[i * 4 + 2];
    const lum = 0.2126 * r + 0.7152 * g + 0.0722 * b;

    if (lum > threshold) {
      raw[i] = 1;
      contentCells++;
    }
  }

  // Blank / loading slice – nothing to mask, fail open.
  if (!contentCells) {
    return null;
  }

  // 4-neighbour majority pass: keep the interior of a dim scan solid and remove
  // isolated speckle in the black border.
  const data = new Uint8Array(grid * grid);
  let x0 = grid;
  let y0 = grid;
  let x1 = -1;
  let y1 = -1;

  for (let row = 0; row < grid; row++) {
    for (let col = 0; col < grid; col++) {
      const idx = row * grid + col;
      let count = raw[idx];
      if (col > 0) count += raw[idx - 1];
      if (col < grid - 1) count += raw[idx + 1];
      if (row > 0) count += raw[idx - grid];
      if (row < grid - 1) count += raw[idx + grid];

      // self + 4 neighbours => keep if at least 2 are content
      if (count >= 2) {
        data[idx] = 1;
        if (col < x0) x0 = col;
        if (col > x1) x1 = col;
        if (row < y0) y0 = row;
        if (row > y1) y1 = row;
      }
    }
  }

  if (x1 < x0 || y1 < y0) {
    return null;
  }

  return {
    cols: grid,
    rows: grid,
    data,
    bbox: {
      x0: x0 / grid,
      y0: y0 / grid,
      x1: (x1 + 1) / grid,
      y1: (y1 + 1) / grid,
    },
  };
}

/**
 * Test whether a normalized (0-1) point lands on meaningful image content.
 * A null mask means masking is unavailable – fail open (treat as content).
 */
export function isContentAt(mask: ContentMask | null, nx: number, ny: number): boolean {
  if (!mask) {
    return true;
  }

  if (!Number.isFinite(nx) || !Number.isFinite(ny)) {
    return false;
  }

  // Fast bbox reject.
  if (nx < mask.bbox.x0 || nx > mask.bbox.x1 || ny < mask.bbox.y0 || ny > mask.bbox.y1) {
    return false;
  }

  const col = Math.min(Math.max(Math.floor(nx * mask.cols), 0), mask.cols - 1);
  const row = Math.min(Math.max(Math.floor(ny * mask.rows), 0), mask.rows - 1);

  return mask.data[row * mask.cols + col] === 1;
}
