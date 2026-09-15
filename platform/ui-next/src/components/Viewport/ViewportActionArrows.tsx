import React from 'react';
import classNames from 'classnames';
import PropTypes from 'prop-types';

import { Icons } from '@ohif/ui-next';

const arrowClasses =
  'flex h-8 w-8 shrink-0 items-center justify-center rounded text-primary hover:bg-primary/30 active:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring';

/**
 * Accessible controls for stepping through segments or measurements.
 */
function ViewportActionArrows({ onArrowsClick, className }) {
  return (
    <div
      data-cy="viewport-action-arrows"
      className={classNames(className, 'flex')}
    >
      <button
        type="button"
        aria-label="Previous segment or measurement"
        data-cy="viewport-action-arrows-left"
        className={arrowClasses}
        onClick={() => onArrowsClick(-1)}
      >
        <Icons.ArrowLeftBold />
      </button>
      <button
        type="button"
        aria-label="Next segment or measurement"
        data-cy="viewport-action-arrows-right"
        className={arrowClasses}
        onClick={() => onArrowsClick(1)}
      >
        <Icons.ArrowRightBold />
      </button>
    </div>
  );
}

ViewportActionArrows.propTypes = {
  onArrowsClick: PropTypes.func.isRequired,
  className: PropTypes.string,
};

export { ViewportActionArrows };
