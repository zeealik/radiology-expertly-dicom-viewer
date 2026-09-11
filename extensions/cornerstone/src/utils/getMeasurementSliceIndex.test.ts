import getMeasurementSliceIndex, { getSOPInstanceUIDFromImageId } from './getMeasurementSliceIndex';

describe('getSOPInstanceUIDFromImageId', () => {
  it('extracts the instance uid from a wadors image id', () => {
    const imageId =
      'wadors:https://example.org/dicom-web/studies/1.2.3/series/4.5.6/instances/7.8.9/frames/1';

    expect(getSOPInstanceUIDFromImageId(imageId)).toBe('7.8.9');
  });

  it('returns undefined when there is no instances segment', () => {
    expect(getSOPInstanceUIDFromImageId('dicomweb:https://example.org/image.dcm')).toBeUndefined();
  });

  it('returns undefined for a missing image id', () => {
    expect(getSOPInstanceUIDFromImageId(undefined)).toBeUndefined();
  });
});

describe('getMeasurementSliceIndex', () => {
  const singleFrameDisplaySet = {
    instances: [
      { SOPInstanceUID: 'instance-1' },
      { SOPInstanceUID: 'instance-2' },
      { SOPInstanceUID: 'instance-3' },
    ],
  };

  it('returns the 1-based slice number for the matching instance', () => {
    const result = getMeasurementSliceIndex(
      { SOPInstanceUID: 'instance-3' },
      singleFrameDisplaySet
    );

    expect(result).toEqual({ imageIndex: 2, sliceNumber: 3, frameNumber: 1 });
  });

  it('numbers the first slice as 1, not 0', () => {
    const result = getMeasurementSliceIndex(
      { SOPInstanceUID: 'instance-1' },
      singleFrameDisplaySet
    );

    expect(result?.sliceNumber).toBe(1);
    expect(result?.imageIndex).toBe(0);
  });

  it('falls back to the referenced image id when SOPInstanceUID is absent', () => {
    const result = getMeasurementSliceIndex(
      {
        referencedImageId:
          'wadors:https://example.org/dicom-web/studies/1/series/2/instances/instance-2/frames/1',
      },
      singleFrameDisplaySet
    );

    expect(result?.sliceNumber).toBe(2);
  });

  it('reads the referenced image id from metadata when not set on the measurement', () => {
    const result = getMeasurementSliceIndex(
      {
        metadata: {
          referencedImageId:
            'wadors:https://example.org/dicom-web/studies/1/series/2/instances/instance-2/frames/1',
        },
      },
      singleFrameDisplaySet
    );

    expect(result?.sliceNumber).toBe(2);
  });

  it('uses the images array when instances is absent', () => {
    const result = getMeasurementSliceIndex(
      { SOPInstanceUID: 'instance-2' },
      { images: singleFrameDisplaySet.instances }
    );

    expect(result?.sliceNumber).toBe(2);
  });

  it('accounts for frames contributed by preceding multi-frame instances', () => {
    const multiFrameDisplaySet = {
      instances: [
        { SOPInstanceUID: 'instance-1', NumberOfFrames: 3 },
        { SOPInstanceUID: 'instance-2', NumberOfFrames: 2 },
      ],
    };

    const result = getMeasurementSliceIndex(
      { SOPInstanceUID: 'instance-2', frameNumber: 2 },
      multiFrameDisplaySet
    );

    // 3 frames from instance-1, then the 2nd frame of instance-2.
    expect(result).toEqual({ imageIndex: 4, sliceNumber: 5, frameNumber: 2 });
  });

  it('returns undefined when the instance is not part of the display set', () => {
    expect(
      getMeasurementSliceIndex({ SOPInstanceUID: 'not-here' }, singleFrameDisplaySet)
    ).toBeUndefined();
  });

  it('returns undefined when the measurement has no image reference', () => {
    expect(getMeasurementSliceIndex({}, singleFrameDisplaySet)).toBeUndefined();
  });

  it('returns undefined when the display set has no instances', () => {
    expect(getMeasurementSliceIndex({ SOPInstanceUID: 'instance-1' }, {})).toBeUndefined();
  });
});
