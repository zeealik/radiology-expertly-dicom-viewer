import React, { ReactNode } from 'react';
import { useSystem } from '@ohif/core';
import {
  Button,
  Icons,
  Popover,
  PopoverContent,
  PopoverTrigger,
  useViewportGrid,
  useIconPresentation,
} from '@ohif/ui-next';
import { WindowLevelActionMenu } from './WindowLevelActionMenu';
import { useViewportDisplaySets } from '../../hooks/useViewportDisplaySets';
import { useViewportRendering } from '../../hooks';

export function WindowLevelActionMenuWrapper(
  props: withAppTypes<{
    viewportId: string;
    location?: number;
    isOpen?: boolean;
    onOpen?: () => void;
    onClose?: () => void;
    displaySets?: Array<AppTypes.DisplaySet>;
    disabled?: boolean;
    isEmbedded?: boolean;
    isToolbarMenu?: boolean;
    label?: string;
    tooltip?: string;
  }>
): ReactNode {
  const {
    viewportId,
    location,
    isOpen = false,
    onOpen,
    onClose,
    disabled,
    isEmbedded = false,
    isToolbarMenu = false,
    label,
    tooltip,
    onInteraction: onInteractionProps,
    hasEmbeddedVariantToUse,
    ...rest
  } = props;

  const [gridState] = useViewportGrid();
  const viewportIdToUse = viewportId || gridState.activeViewportId;

  const { viewportDisplaySets: displaySets } = useViewportDisplaySets(viewportIdToUse);
  const { servicesManager } = useSystem();
  const { toolbarService } = servicesManager.services;
  const { IconContainer, className: iconClassName, containerProps } = useIconPresentation();
  const { hasColorbar, toggleColorbar } = useViewportRendering(viewportIdToUse);

  const handleOpenChange = (openState: boolean) => {
    const shouldToggleColorbar = hasColorbar && !isEmbedded;

    if (isOpen && shouldToggleColorbar && openState) {
      toggleColorbar();
      onClose?.();
      return;
    }

    if (!isOpen && openState && shouldToggleColorbar) {
      toggleColorbar();
      return;
    }

    if (openState) {
      onOpen?.();
    } else {
      onClose?.();
    }
  };

  const { align, side } = isToolbarMenu
    ? ({ align: 'center', side: 'bottom' } as const)
    : toolbarService.getAlignAndSide(location);

  const modalities = displaySets.map(displaySet => displaySet.supportsWindowLevel);

  if (modalities.length === 0) {
    return null;
  }

  let Icon = <Icons.ViewportWindowLevel className={iconClassName} />;

  if (isToolbarMenu) {
    Icon = <Icons.Controls className="h-7 w-7" />;
  } else if (hasColorbar && !isEmbedded && hasEmbeddedVariantToUse) {
    Icon = <Icons.Close className={iconClassName} />;
  }
  const toolbarTriggerClassName = isToolbarMenu
    ? `text-foreground/80 hover:bg-background hover:text-highlight h-10 w-10 rounded-lg ${isOpen ? 'bg-background' : ''}`
    : undefined;

  return (
    <Popover
      open={isOpen}
      onOpenChange={handleOpenChange}
    >
      <PopoverTrigger
        asChild
        className="flex items-center justify-center"
      >
        <div>
          {IconContainer ? (
            <IconContainer
              disabled={disabled}
              {...rest}
              {...containerProps}
              label={label}
              tooltip={tooltip}
              aria-label={isToolbarMenu ? label : undefined}
              title={isToolbarMenu ? tooltip || label : undefined}
              className={toolbarTriggerClassName || rest.className}
            >
              {Icon}
            </IconContainer>
          ) : (
            <Button
              variant="ghost"
              size="icon"
              disabled={disabled}
              aria-label={isToolbarMenu ? label : undefined}
              title={isToolbarMenu ? tooltip || label : undefined}
              className={toolbarTriggerClassName || rest.className}
            >
              {Icon}
            </Button>
          )}
        </div>
      </PopoverTrigger>
      <PopoverContent
        className="border-none bg-transparent p-0 shadow-none"
        side={side}
        align={align}
        alignOffset={0}
        sideOffset={5}
      >
        <WindowLevelActionMenu
          viewportId={viewportIdToUse}
          align={align}
          side={side}
          onVisibilityChange={handleOpenChange}
        />
      </PopoverContent>
    </Popover>
  );
}
