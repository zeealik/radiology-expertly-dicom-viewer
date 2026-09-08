import React from 'react';
import type { LucideIcon } from 'lucide-react';
import type { IconProps } from '../types';

/**
 * Stroke weight for the whole generic icon set. Matches the optical weight of
 * regular-weight label text sitting beside it; the hand-drawn domain icons
 * (measurement tools, layout grids) are normalized to the same value.
 */
export const ICON_STROKE_WIDTH = 1.5;

/**
 * Wraps a `lucide-react` glyph so it behaves like an OHIF icon: it accepts the
 * same `IconProps`, inherits color through `currentColor`, and lets the caller's
 * `className` drive the rendered size.
 *
 * Sizing note: the OHIF icons this replaces hard-code `width`/`height` before
 * spreading props, so a `h-4 w-4` class fights the attribute. Here the size
 * defaults to `100%` and the wrapper element sizes the glyph, which is what the
 * `h-*`/`w-*` classes throughout the app already expect.
 */
export function fromLucide(Glyph: LucideIcon) {
  const Icon = ({ className, ...props }: IconProps) => (
    <Glyph
      className={className}
      strokeWidth={ICON_STROKE_WIDTH}
      absoluteStrokeWidth
      {...(props as React.ComponentProps<LucideIcon>)}
    />
  );

  Icon.displayName = `Lucide(${Glyph.displayName ?? 'Icon'})`;

  return Icon;
}

export default fromLucide;
