import { useEffect, useState } from 'react';
import * as cornerstone from '@cornerstonejs/core';

/**
 * Renders a thumbnail for a single image (slice) and returns it as a data URL.
 *
 * The study browser builds its thumbnails through the data source (one per display set);
 * slice groups need one per *image*, so this renders the referenced imageId straight
 * through Cornerstone's `loadImageToCanvas`. Results are cached module-wide because a
 * panel re-renders on every measurement change and decoding the same slice repeatedly is
 * wasteful — the pixel data for a given imageId never changes.
 */
const thumbnailCache = new Map<string, string>();

/** Exposed for tests; clears the module-level thumbnail cache. */
export function clearSliceThumbnailCache(): void {
  thumbnailCache.clear();
}

export default function useSliceThumbnail(imageId?: string): string | undefined {
  const [thumbnailSrc, setThumbnailSrc] = useState<string | undefined>(() =>
    imageId ? thumbnailCache.get(imageId) : undefined
  );

  useEffect(() => {
    if (!imageId) {
      setThumbnailSrc(undefined);
      return;
    }

    const cached = thumbnailCache.get(imageId);
    if (cached) {
      setThumbnailSrc(cached);
      return;
    }

    let isCurrent = true;
    const canvas = document.createElement('canvas');

    cornerstone.utilities
      .loadImageToCanvas({ canvas, imageId, thumbnail: true })
      .then(() => {
        const dataUrl = canvas.toDataURL();
        thumbnailCache.set(imageId, dataUrl);

        if (isCurrent) {
          setThumbnailSrc(dataUrl);
        }
      })
      .catch(() => {
        // A slice whose pixel data cannot be decoded still gets a group — it just shows the
        // placeholder rather than failing the panel.
        if (isCurrent) {
          setThumbnailSrc(undefined);
        }
      });

    return () => {
      isCurrent = false;
    };
  }, [imageId]);

  return thumbnailSrc;
}
