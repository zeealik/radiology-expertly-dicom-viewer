import React from 'react';
import { useSystem } from '@ohif/core';
import {
  Button,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  Icons,
} from '@ohif/ui-next';
import { useTranslation } from 'react-i18next';
import { isReadOnlyViewerAccess } from '@ohif/extension-default/src/ViewerLayout/studyParams';

import AccordionGroup from './AccordionGroup';
import MeasurementTableNested from './MeasurementTableNested';
import { groupBySlice } from './groupBySlice';
import useSliceThumbnail from '../hooks/useSliceThumbnail';

/**
 * Header for one slice group: the slice's own thumbnail, its number, how many annotations
 * it holds, and an overflow menu to clear that slice.
 *
 * Clicking the header navigates the viewport to the slice, so the group acts as a
 * bookmark for where the annotation was drawn.
 */
export function SliceMeasurementsTrigger(props) {
  const { group } = props;
  const { commandsManager } = useSystem();
  const { t } = useTranslation('MeasurementTable');
  const thumbnailSrc = useSliceThumbnail(group?.referencedImageId);
  const disableEditing = isReadOnlyViewerAccess();

  const count = group?.items?.length ?? 0;

  const jumpToSlice = () => {
    // Jumping by measurement keeps the viewport, camera and annotation selection in sync,
    // which a raw slice index jump would not do.
    const [firstItem] = group?.items ?? [];
    if (!firstItem) {
      return;
    }

    commandsManager.run('jumpToMeasurement', {
      uid: firstItem.uid,
      displayMeasurements: group.items,
      group,
    });
  };

  const deleteSliceAnnotations = event => {
    event.stopPropagation();
    commandsManager.run('removeMeasurement', {
      uid: group.items.map(item => item.uid),
    });
  };

  return (
    <div
      className="bg-muted/60 hover:bg-muted group my-0.5 flex w-full cursor-pointer items-center gap-2 rounded py-1 pr-1 pl-1.5"
      onClick={jumpToSlice}
    >
      {thumbnailSrc ? (
        <img
          src={thumbnailSrc}
          alt=""
          className="h-9 w-9 shrink-0 rounded object-contain outline outline-1 -outline-offset-1 outline-white/10"
          crossOrigin="anonymous"
        />
      ) : (
        <div className="bg-background h-9 w-9 shrink-0 rounded" />
      )}

      <div className="flex min-w-0 flex-1 flex-col text-left">
        <span className="text-foreground truncate text-xs font-medium tracking-wide">
          {group?.title}
        </span>
        <span className="text-muted-foreground text-[11px]">
          {count === 1 ? t('1 annotation') : t('{{count}} annotations', { count })}
        </span>
      </div>

      {!disableEditing && (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              size="icon"
              variant="ghost"
              className="text-muted-foreground hover:text-foreground h-6 w-6 shrink-0"
              aria-label={t('Slice actions')}
              onClick={event => event.stopPropagation()}
            >
              <Icons.More className="h-4 w-4" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem
              className="text-destructive focus:text-destructive gap-2"
              onSelect={deleteSliceAnnotations}
            >
              <Icons.Delete className="h-4 w-4" />
              {t('Delete annotations')}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      )}
    </div>
  );
}

/**
 * Findings grouped by the slice they were drawn on.
 *
 * Grouping is derived at render from each measurement's referenced image, so an annotation
 * added while scrolled to slice 43 lands in the "Slice 43" fold without any bookkeeping.
 */
export function SliceMeasurements(props): React.ReactNode {
  const { items, grouping = {}, children, activeImageIndex } = props;

  return (
    <AccordionGroup
      grouping={{
        name: 'groupBySlice',
        groupingFunction: groupBySlice,
        activeImageIndex,
        ...grouping,
      }}
      items={items}
      sourceChildren={children}
    >
      <AccordionGroup.Trigger asChild={true}>
        <SliceMeasurementsTrigger />
      </AccordionGroup.Trigger>
      <MeasurementTableNested hideDetails={false} />
    </AccordionGroup>
  );
}

export default SliceMeasurements;
