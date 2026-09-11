import React from 'react';
import { Button, Icons } from '@ohif/ui-next';
import { useSystem } from '@ohif/core';

/**
 * "Open study" action shown in each study's row in the study browser.
 *
 * `StudyItem` renders whatever is passed as `StudyMenuItems` in the study header, which is
 * normally the `...` dropdown. Here it is a plain button instead: opening the study is the
 * one action people reach for, so it stays visible rather than hidden behind a menu.
 */
export function OpenStudyButton({ StudyInstanceUID }: { StudyInstanceUID: string }) {
  const { commandsManager } = useSystem();

  const openStudy = event => {
    // The study row itself toggles expansion, so the button must not bubble into it.
    event.stopPropagation();
    commandsManager.run('loadStudy', { StudyInstanceUID });
  };

  return (
    <Button
      size="sm"
      variant="ghost"
      className="text-muted-foreground hover:text-foreground h-7 shrink-0 gap-1.5 px-2 text-[12px]"
      onClick={openStudy}
      aria-label="Open study"
      title="Open study"
    >
      <Icons.LaunchArrow className="h-4 w-4" />
      <span>Open study</span>
    </Button>
  );
}

export default OpenStudyButton;
