import React from 'react';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { useSystem } from '@ohif/core';
import FindingsNavigation from './FindingsNavigation';

jest.mock('@ohif/core', () => ({ useSystem: jest.fn() }));
jest.mock('@ohif/extension-cornerstone', () => ({
  utils: {
    getMeasurementSliceIndex: measurement => ({ imageIndex: measurement.imageIndex }),
  },
}));
jest.mock('@ohif/ui-next', () => {
  const React = require('react');
  return {
    Button: ({ children, variant, size, ...props }) => React.createElement('button', props, children),
    Icons: {
      ArrowLeftBold: () => React.createElement('span'),
      ArrowRightBold: () => React.createElement('span'),
    },
    useViewportGrid: () => [{ activeViewportId: 'viewport-1' }],
  };
});

describe('FindingsNavigation', () => {
  const run = jest.fn();
  let measurements: Array<{
    uid: string;
    referencedImageId?: string;
    displaySetInstanceUID?: string;
    imageIndex?: number;
  }>;
  let onMeasurementAdded: (() => void) | undefined;
  let currentImageIndex: number | undefined;

  beforeEach(() => {
    run.mockReset();
    measurements = [];
    onMeasurementAdded = undefined;
    currentImageIndex = undefined;

    (useSystem as jest.Mock).mockReturnValue({
      commandsManager: { run },
      servicesManager: {
        services: {
          cornerstoneViewportService: {
            getCornerstoneViewport: () => ({ getCurrentImageIdIndex: () => currentImageIndex }),
          },
          displaySetService: {
            getDisplaySetByUID: () => ({ instances: [] }),
          },
          measurementService: {
            getMeasurements: () => measurements,
            EVENTS: {
              MEASUREMENT_ADDED: 'added',
              RAW_MEASUREMENT_ADDED: 'raw-added',
              MEASUREMENT_UPDATED: 'updated',
              MEASUREMENT_REMOVED: 'removed',
              MEASUREMENTS_CLEARED: 'cleared',
            },
            subscribe: (event, callback) => {
              if (event === 'added') {
                onMeasurementAdded = callback;
              }
              return { unsubscribe: jest.fn() };
            },
          },
        },
      },
    });
  });

  it('hides navigation until there are two image-linked findings', () => {
    render(React.createElement(FindingsNavigation));
    expect(screen.queryByRole('button', { name: 'Next finding' })).toBeNull();

    measurements = [{ uid: 'first', referencedImageId: 'image-1' }];
    act(() => onMeasurementAdded?.());
    expect(screen.queryByRole('button', { name: 'Next finding' })).toBeNull();
  });

  it('moves to the next and previous finding', () => {
    measurements = [
      { uid: 'second', referencedImageId: 'image-2', displaySetInstanceUID: 'series', imageIndex: 2 },
      { uid: 'first', referencedImageId: 'image-1', displaySetInstanceUID: 'series', imageIndex: 1 },
    ];
    render(React.createElement(FindingsNavigation));

    fireEvent.click(screen.getByRole('button', { name: 'Next finding' }));
    fireEvent.click(screen.getByRole('button', { name: 'Previous finding' }));

    expect(run).toHaveBeenNthCalledWith(1, 'jumpToMeasurement', { uid: 'first' });
    expect(run).toHaveBeenNthCalledWith(2, 'jumpToMeasurement', { uid: 'second' });
  });

  it.each([
    ['Next finding', 'later'],
    ['Previous finding', 'earlier'],
  ])('starts %s from the currently displayed slice', (buttonName, expectedUid) => {
    currentImageIndex = 5;
    measurements = [
      { uid: 'later', referencedImageId: 'image-7', displaySetInstanceUID: 'series', imageIndex: 7 },
      { uid: 'earlier', referencedImageId: 'image-3', displaySetInstanceUID: 'series', imageIndex: 3 },
    ];
    render(React.createElement(FindingsNavigation));

    fireEvent.click(screen.getByRole('button', { name: buttonName }));

    expect(run).toHaveBeenCalledWith('jumpToMeasurement', { uid: expectedUid });
  });
});
