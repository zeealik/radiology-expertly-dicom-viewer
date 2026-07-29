import React from 'react';
import { MeasurementTable } from '@ohif/ui-next';
import { useSystem } from '@ohif/core';
import { isReadOnlyViewerAccess } from '@ohif/extension-default/src/ViewerLayout/studyParams';

/**
 * This is a measurement table that is designed to be nested inside
 * the accordion groups.
 */
export default function MeasurementTableNested(props) {
  const { title, items, group, customHeader } = props;
  const { commandsManager } = useSystem();
  // In a read-only viewer the findings are reference material, so rename/delete
  // are suppressed on every row. Selecting a row still jumps to the measurement.
  const disableEditing = isReadOnlyViewerAccess();
  const onAction = (e, command, uid) => {
    if (disableEditing && command !== 'jumpToMeasurement') {
      return;
    }
    commandsManager.run(command, { uid, annotationUID: uid, displayMeasurements: items });
  };

  return (
    <MeasurementTable
      title={title ? title : `Measurements`}
      data={items}
      onAction={onAction}
      {...group}
      disableEditing={disableEditing}
      key={group.key}
    >
      <MeasurementTable.Header key="measurementTableHeader">
        {customHeader && group.isFirst && customHeader({ ...props, items: props.allItems })}
      </MeasurementTable.Header>
      <MeasurementTable.Body key="measurementTableBody" />
    </MeasurementTable>
  );
}
