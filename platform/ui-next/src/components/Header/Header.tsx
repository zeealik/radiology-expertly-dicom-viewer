import React, { ReactNode } from 'react';
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  Icons,
  Button,
  ToolButton,
} from '../';
import { IconPresentationProvider } from '@ohif/ui-next';

import NavBar from '../NavBar';

// Todo: we should move this component to composition and remove props base

interface HeaderProps {
  children?: ReactNode;
  menuOptions: Array<{
    title: string;
    icon?: string;
    onClick: () => void;
  }>;
  isReturnEnabled?: boolean;
  onClickReturnButton?: () => void;
  isSticky?: boolean;
  WhiteLabeling?: {
    createLogoComponentFn?: (React: any, props: any) => ReactNode;
  };
  PatientInfo?: ReactNode;
  Secondary?: ReactNode;
  UndoRedo?: ReactNode;
}

function Header({
  children,
  menuOptions,
  isReturnEnabled = true,
  onClickReturnButton,
  isSticky = false,
  WhiteLabeling,
  PatientInfo,
  UndoRedo,
  Secondary,
  ...props
}: HeaderProps): ReactNode {
  const onClickReturn = () => {
    if (isReturnEnabled && onClickReturnButton) {
      onClickReturnButton();
    }
  };

  return (
    <IconPresentationProvider
      size="large"
      IconContainer={ToolButton}
    >
      <NavBar
        isSticky={isSticky}
        {...props}
      >
        <div className="flex h-[56px] min-w-0 items-center gap-2 overflow-hidden">
          <div className="flex min-w-0 flex-none items-center">
            <div className="inline-flex min-w-0 items-center">
              {isReturnEnabled && (
                <button
                  type="button"
                  className="text-muted-foreground hover:bg-accent hover:text-foreground focus-visible:ring-ring flex h-10 w-12 flex-none cursor-pointer items-center justify-center rounded-lg transition-colors duration-150 focus-visible:outline-none focus-visible:ring-1 md:w-14"
                  onClick={onClickReturn}
                  aria-label="Return to work list"
                  data-cy="return-to-work-list"
                >
                  <Icons.ArrowLeftBold className="h-5 w-5" />
                </button>
              )}
              <div className="ml-1 flex h-10 w-8 flex-none items-center overflow-hidden md:ml-2 [&_svg]:max-w-none [&_svg]:shrink-0">
                {WhiteLabeling?.createLogoComponentFn?.(React, props) || <Icons.OHIFLogo />}
              </div>
            </div>
          </div>
          <div className="hidden h-8 flex-none items-center lg:flex">{Secondary}</div>
          <div className="min-w-0 flex-1 overflow-hidden">
            <div className="flex max-w-full items-center justify-start gap-1 overflow-x-auto px-1 md:justify-center md:gap-2 md:px-2">
              {children}
            </div>
          </div>
          <div className="flex flex-none select-none items-center">
            {UndoRedo}
            <div className="bg-border/60 mx-1.5 h-5 w-px md:mx-2"></div>
            {PatientInfo}
            <div className="bg-border/60 mx-1.5 h-5 w-px md:mx-2"></div>
            <div className="flex-shrink-0">
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="text-muted-foreground hover:bg-accent hover:text-foreground h-10 w-10 rounded-lg transition-colors duration-150"
                  >
                    <Icons.GearSettings />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  {menuOptions.map((option, index) => {
                    const IconComponent = option.icon
                      ? Icons[option.icon as keyof typeof Icons]
                      : null;
                    return (
                      <DropdownMenuItem
                        key={index}
                        onSelect={option.onClick}
                        className="flex items-center gap-2 py-2"
                      >
                        {IconComponent && (
                          <span className="flex h-4 w-4 items-center justify-center">
                            <Icons.ByName name={option.icon} />
                          </span>
                        )}
                        <span className="flex-1">{option.title}</span>
                      </DropdownMenuItem>
                    );
                  })}
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          </div>
        </div>
      </NavBar>
    </IconPresentationProvider>
  );
}

export default Header;
