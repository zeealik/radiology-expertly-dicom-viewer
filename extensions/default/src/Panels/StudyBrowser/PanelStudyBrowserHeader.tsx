import React from 'react';
import { Button, ToggleGroup, ToggleGroupItem } from '@ohif/ui-next';
import { Icons } from '@ohif/ui-next';
import { actionIcon, viewPreset } from './types';

function PanelStudyBrowserHeader({
  viewPresets,
  updateViewPresetValue,
  actionIcons,
  updateActionIconValue,
}: {
  viewPresets: viewPreset[];
  updateViewPresetValue: (viewPreset: viewPreset) => void;
  actionIcons: actionIcon[];
  updateActionIconValue: (actionIcon: actionIcon) => void;
}) {
  // Button order: action icons on the left, view-preset toggle on the right.
  return (
    <div className="bg-muted border-border flex h-9 shrink-0 select-none items-center justify-between gap-2 rounded-t border-b px-2">
      <div className="flex items-center gap-0.5">
        {actionIcons.map((icon: actionIcon, index) => (
          <Button
            key={index}
            variant="ghost"
            size="icon"
            aria-label={icon.id}
            title={icon.id}
            className="text-muted-foreground hover:text-foreground h-7 w-7"
            onClick={() => updateActionIconValue(icon)}
          >
            {React.createElement(Icons[icon.iconName] || Icons.MissingIcon, {
              className: 'h-4 w-4',
            })}
          </Button>
        ))}
      </div>
      <ToggleGroup
        type="single"
        value={viewPresets.filter(preset => preset.selected)[0].id}
        onValueChange={value => {
          const selectedViewPreset = viewPresets.find(preset => preset.id === value);
          updateViewPresetValue(selectedViewPreset);
        }}
      >
        {viewPresets.map((viewPreset: viewPreset, index) => (
          <ToggleGroupItem
            key={index}
            aria-label={viewPreset.id}
            value={viewPreset.id}
            className="text-muted-foreground data-[state=on]:text-foreground h-7 w-7"
          >
            {React.createElement(Icons[viewPreset.iconName] || Icons.MissingIcon, {
              className: 'h-4 w-4',
            })}
          </ToggleGroupItem>
        ))}
      </ToggleGroup>
    </div>
  );
}

export { PanelStudyBrowserHeader };
