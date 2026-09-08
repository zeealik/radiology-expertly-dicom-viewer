import React from 'react';
import {
  Button,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  Icons,
} from '@ohif/ui-next';
import { useSystem } from '@ohif/core';
import { useTranslation } from 'react-i18next';
import { isReadOnlyViewerAccess } from '@ohif/extension-default/src/ViewerLayout/studyParams';

export function StudyMeasurementsActions({ items, StudyInstanceUID, measurementFilter, actions }) {
  const { commandsManager } = useSystem();
  const { t } = useTranslation('MeasurementTable');
  const disabled = !items?.length;

  if (disabled) {
    return null;
  }

  // A read-only viewer (e.g. the pilot study result view) is strictly view-only:
  // CSV export, Create SR and Delete all mutate or extract the linked findings, so
  // the whole action bar is hidden rather than individually disabled.
  if (isReadOnlyViewerAccess()) {
    return null;
  }

  const exportCSV = () => {
    commandsManager.runCommand('downloadCSVMeasurementsReport', {
      StudyInstanceUID,
      measurementFilter,
    });
  };

  const createSR = e => {
    e.stopPropagation();
    if (actions?.createSR) {
      actions.createSR({ StudyInstanceUID, measurementFilter });
      return;
    }
    commandsManager.run('promptSaveReport', {
      StudyInstanceUID,
      measurementFilter,
    });
  };

  const deleteAll = () => {
    if (actions?.onDelete) {
      actions.onDelete();
      return;
    }
    commandsManager.runCommand('clearMeasurements', {
      measurementFilter,
    });
  };

  // Create SR is the action people actually reach for, so it stays visible.
  // Export and the destructive clear move behind an overflow menu rather than
  // sitting at equal weight beside it.
  return (
    <div className="flex h-9 w-full items-center justify-between gap-1 pr-0.5">
      <Button
        size="sm"
        variant="ghost"
        className="gap-1.5"
        onClick={createSR}
      >
        <Icons.Add className="h-4 w-4" />
        {t('Create SR')}
      </Button>

      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            size="icon"
            variant="ghost"
            className="text-muted-foreground hover:text-foreground h-7 w-7"
            aria-label={t('More measurement actions')}
          >
            <Icons.More className="h-4 w-4" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem
            className="gap-2"
            onSelect={exportCSV}
          >
            <Icons.Download className="h-4 w-4" />
            {t('Export CSV')}
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem
            className="text-destructive focus:text-destructive gap-2"
            onSelect={deleteAll}
          >
            <Icons.Delete className="h-4 w-4" />
            {t('Delete all')}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}

export default StudyMeasurementsActions;
