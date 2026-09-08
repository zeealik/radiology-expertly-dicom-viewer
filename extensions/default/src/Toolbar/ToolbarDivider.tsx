import React from 'react';

/**
 * Separates semantic groups of toolbar buttons. Deliberately quiet: a group
 * boundary should be felt rather than read, so this is a short hairline at
 * partial opacity, not a full-height rule.
 */
export default function ToolbarDivider() {
  return (
    <span
      aria-hidden="true"
      className="bg-border/60 mx-1.5 h-5 w-px shrink-0 self-center"
    />
  );
}
