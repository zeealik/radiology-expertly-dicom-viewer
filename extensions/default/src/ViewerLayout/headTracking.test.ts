import {
  matrixToEuler,
  computeIpd,
  classifyPosition,
  computeConfidence,
  type HeadBaseline,
} from './headTrackingMath';

// column-major 4x4 identity
const IDENTITY = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];

// column-major rotation about Y (yaw) by +30deg.
// Column-major layout: m[col*4 + row].
// Ry = [[ c,0,s],[0,1,0],[-s,0,c]] (row-major) =>
//   r00=c r02=s ; r20=-s r22=c
function yawMatrix(deg: number): number[] {
  const r = (deg * Math.PI) / 180;
  const c = Math.cos(r);
  const s = Math.sin(r);
  const m = IDENTITY.slice();
  // r00 = m[0]
  m[0] = c;
  // r20 = m[2]
  m[2] = -s;
  // r02 = m[8]
  m[8] = s;
  // r22 = m[10]
  m[10] = c;
  return m;
}

function makeLandmarks(leftX: number, rightX: number, y = 0.5) {
  const lm: { x: number; y: number }[] = [];
  for (let i = 0; i < 478; i++) {
    lm[i] = { x: 0.5, y: 0.5 };
  }
  lm[1] = { x: (leftX + rightX) / 2, y }; // nose tip = center
  lm[468] = { x: leftX, y }; // left iris
  lm[473] = { x: rightX, y }; // right iris
  return lm;
}

const BASELINE: HeadBaseline = {
  ipd: 0.1,
  center: { x: 0.5, y: 0.5 },
  pose: { yaw: 0, pitch: 0, roll: 0 },
};

function sample(over: Partial<Parameters<typeof classifyPosition>[0]> = {}) {
  return {
    facePresent: true,
    ipd: 0.1,
    center: { x: 0.5, y: 0.5 },
    faceBox: { x: 0.4, y: 0.4, w: 0.2, h: 0.2 },
    pose: { yaw: 0, pitch: 0, roll: 0 },
    luma: 200,
    ...over,
  };
}

describe('matrixToEuler', () => {
  it('returns zero angles for identity', () => {
    const e = matrixToEuler(IDENTITY);
    expect(e.yaw).toBeCloseTo(0, 5);
    expect(e.pitch).toBeCloseTo(0, 5);
    expect(e.roll).toBeCloseTo(0, 5);
  });

  it('recovers a 30 degree yaw (pins sign convention)', () => {
    const e = matrixToEuler(yawMatrix(30));
    expect(e.yaw).toBeCloseTo(30, 3);
    expect(e.pitch).toBeCloseTo(0, 3);
    expect(e.roll).toBeCloseTo(0, 3);
  });
});

describe('computeIpd', () => {
  it('uses iris centers when present', () => {
    const lm = makeLandmarks(0.45, 0.55);
    expect(computeIpd(lm, 1)).toBeCloseTo(0.1, 5);
  });

  it('falls back to eye-corner midpoints without iris landmarks', () => {
    const lm: { x: number; y: number }[] = [];
    for (let i = 0; i < 400; i++) {
      lm[i] = { x: 0.5, y: 0.5 };
    }
    lm[33] = { x: 0.4, y: 0.5 };
    lm[133] = { x: 0.46, y: 0.5 }; // left midpoint = 0.43
    lm[362] = { x: 0.54, y: 0.5 };
    lm[263] = { x: 0.6, y: 0.5 }; // right midpoint = 0.57
    expect(computeIpd(lm, 1)).toBeCloseTo(0.14, 5);
  });

  it('returns 0 for empty landmarks', () => {
    expect(computeIpd([], 1)).toBe(0);
  });
});

describe('classifyPosition', () => {
  it('reports ok when within the safe zone', () => {
    expect(classifyPosition(sample(), BASELINE).status).toBe('ok');
  });

  it('prioritizes face-lost above everything', () => {
    const r = classifyPosition(sample({ facePresent: false, luma: 0 }), BASELINE);
    expect(r.status).toBe('face-lost');
    expect(r.direction).toBe('center');
  });

  it('detects low light before distance', () => {
    expect(classifyPosition(sample({ luma: 10, ipd: 0.2 }), BASELINE).status).toBe('low-light');
  });

  it('detects too-close (large IPD)', () => {
    const r = classifyPosition(sample({ ipd: 0.1 * 1.3 }), BASELINE);
    expect(r.status).toBe('too-close');
    expect(r.direction).toBe('back');
  });

  it('detects too-far (small IPD)', () => {
    const r = classifyPosition(sample({ ipd: 0.1 * 0.7 }), BASELINE);
    expect(r.status).toBe('too-far');
    expect(r.direction).toBe('forward');
  });

  it('detects lateral drift', () => {
    const right = classifyPosition(sample({ center: { x: 0.7, y: 0.5 } }), BASELINE);
    expect(right.status).toBe('shifted-right');
    expect(right.direction).toBe('left');

    const left = classifyPosition(sample({ center: { x: 0.3, y: 0.5 } }), BASELINE);
    expect(left.status).toBe('shifted-left');
    expect(left.direction).toBe('right');
  });

  it('detects vertical drift', () => {
    expect(classifyPosition(sample({ center: { x: 0.5, y: 0.7 } }), BASELINE).status).toBe(
      'shifted-down'
    );
    expect(classifyPosition(sample({ center: { x: 0.5, y: 0.3 } }), BASELINE).status).toBe(
      'shifted-up'
    );
  });

  it('detects head turn from pose', () => {
    const r = classifyPosition(sample({ pose: { yaw: 30, pitch: 0, roll: 0 } }), BASELINE);
    expect(r.status).toBe('head-turned');
  });
});

describe('computeConfidence', () => {
  it('is high in the safe zone', () => {
    expect(computeConfidence(sample(), BASELINE)).toBeGreaterThan(0.9);
  });

  it('is 0 with no face', () => {
    expect(computeConfidence(sample({ facePresent: false }), BASELINE)).toBe(0);
  });

  it('drops off-zone', () => {
    const off = computeConfidence(sample({ center: { x: 0.7, y: 0.5 } }), BASELINE);
    expect(off).toBeLessThan(computeConfidence(sample(), BASELINE));
  });
});
