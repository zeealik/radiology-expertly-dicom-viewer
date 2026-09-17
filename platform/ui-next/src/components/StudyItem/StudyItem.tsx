import React from 'react';
import PropTypes from 'prop-types';
import classnames from 'classnames';
import { ThumbnailList } from '../ThumbnailList';

import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from '../Accordion';
import { Tooltip, TooltipContent, TooltipTrigger } from '../Tooltip';
import { Button } from '../Button';
import { Icons } from '../Icons';

const StudyItem = ({
  date,
  description,
  numInstances,
  modalities,
  isActive,
  onClick,
  isExpanded,
  displaySets,
  activeDisplaySetInstanceUIDs,
  onClickThumbnail,
  onDoubleClickThumbnail,
  onClickUntrack,
  viewPreset = 'thumbnails',
  ThumbnailMenuItems,
  StudyMenuItems,
  StudyInstanceUID,
  onRenameStudy,
  onRenameSeries,
}: withAppTypes) => {
  return (
    <Accordion
      type="single"
      collapsible
      onValueChange={onClick}
      defaultValue={isActive ? 'study-item' : undefined}
    >
      <AccordionItem value="study-item">
        <AccordionTrigger
          className={classnames('hover:bg-accent bg-popover group min-w-0 rounded')}
          actions={
            (onRenameStudy || StudyMenuItems) && (
              <div className="bg-popover flex shrink-0 items-center pr-2">
                {onRenameStudy && (
                  <Button
                    variant="ghost"
                    size="icon"
                    className="text-muted-foreground hover:text-foreground h-8 w-8 opacity-70 transition-opacity hover:opacity-100 focus-visible:opacity-100"
                    aria-label="Rename study"
                    title="Rename study"
                    onClick={event => {
                      event.preventDefault();
                      event.stopPropagation();
                      onRenameStudy(StudyInstanceUID, description);
                    }}
                  >
                    <Icons.Rename className="h-4 w-4" />
                  </Button>
                )}
                {StudyMenuItems && <StudyMenuItems StudyInstanceUID={StudyInstanceUID} />}
              </div>
            )
          }
        >
          <div className="flex h-[40px] w-full flex-row overflow-hidden">
            <div className="flex w-full flex-row items-center justify-between">
              <div className="flex min-w-0 flex-col items-start text-[13px]">
                <Tooltip>
                  <TooltipContent>{date}</TooltipContent>
                  <TooltipTrigger
                    className="w-full"
                    asChild
                  >
                    <div className="text-foreground h-[18px] w-full max-w-[160px] overflow-hidden truncate whitespace-nowrap text-left">
                      {date}
                    </div>
                  </TooltipTrigger>
                </Tooltip>
                <Tooltip>
                  <TooltipContent>{description}</TooltipContent>
                  <TooltipTrigger
                    className="w-full"
                    asChild
                  >
                    <div className="text-muted-foreground h-[18px] w-full overflow-hidden truncate whitespace-nowrap text-left">
                      {description}
                    </div>
                  </TooltipTrigger>
                </Tooltip>
              </div>
              <div className="text-muted-foreground flex flex-col items-end pl-[10px] text-[12px]">
                <div className="max-w-[150px] overflow-hidden text-ellipsis">{modalities}</div>
                <div>{numInstances}</div>
              </div>
            </div>
          </div>
        </AccordionTrigger>
        <AccordionContent
          onClick={event => {
            event.stopPropagation();
          }}
        >
          {isExpanded && displaySets && (
            <ThumbnailList
              thumbnails={displaySets}
              activeDisplaySetInstanceUIDs={activeDisplaySetInstanceUIDs}
              onThumbnailClick={onClickThumbnail}
              onThumbnailDoubleClick={onDoubleClickThumbnail}
              onClickUntrack={onClickUntrack}
              viewPreset={viewPreset}
              ThumbnailMenuItems={ThumbnailMenuItems}
              onRenameSeries={onRenameSeries}
            />
          )}
        </AccordionContent>
      </AccordionItem>
    </Accordion>
  );
};

StudyItem.propTypes = {
  date: PropTypes.string.isRequired,
  description: PropTypes.string,
  modalities: PropTypes.string.isRequired,
  numInstances: PropTypes.number.isRequired,
  isActive: PropTypes.bool,
  onClick: PropTypes.func.isRequired,
  isExpanded: PropTypes.bool,
  displaySets: PropTypes.array,
  activeDisplaySetInstanceUIDs: PropTypes.array,
  onClickThumbnail: PropTypes.func,
  onDoubleClickThumbnail: PropTypes.func,
  onClickUntrack: PropTypes.func,
  viewPreset: PropTypes.string,
  StudyMenuItems: PropTypes.func,
  StudyInstanceUID: PropTypes.string,
  onRenameStudy: PropTypes.func,
  onRenameSeries: PropTypes.func,
};

export { StudyItem };
