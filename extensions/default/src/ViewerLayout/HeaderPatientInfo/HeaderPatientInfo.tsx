import React, { useState, useEffect } from 'react';
import usePatientInfo from '../../hooks/usePatientInfo';
import { Icons } from '@ohif/ui-next';

export enum PatientInfoVisibility {
  VISIBLE = 'visible',
  VISIBLE_COLLAPSED = 'visibleCollapsed',
  DISABLED = 'disabled',
  VISIBLE_READONLY = 'visibleReadOnly',
}

const formatWithEllipsis = (str, maxLength) => {
  if (str?.length > maxLength) {
    return str.substring(0, maxLength) + '...';
  }
  return str;
};

function HeaderPatientInfo({ servicesManager, appConfig }: withAppTypes) {
  const initialExpandedState =
    appConfig.showPatientInfo === PatientInfoVisibility.VISIBLE ||
    appConfig.showPatientInfo === PatientInfoVisibility.VISIBLE_READONLY;
  const [expanded, setExpanded] = useState(initialExpandedState);
  const { patientInfo, isMixedPatients } = usePatientInfo(servicesManager);

  useEffect(() => {
    if (isMixedPatients && expanded) {
      setExpanded(false);
    }
  }, [isMixedPatients, expanded]);

  const handleOnClick = () => {
    if (!isMixedPatients && appConfig.showPatientInfo !== PatientInfoVisibility.VISIBLE_READONLY) {
      setExpanded(!expanded);
    }
  };

  const formattedPatientName = formatWithEllipsis(patientInfo.PatientName, 27);
  const formattedPatientID = formatWithEllipsis(patientInfo.PatientID, 15);

  return (
    <div
      className="hover:bg-muted flex min-w-0 cursor-pointer items-center justify-center gap-1 rounded-lg px-1"
      onClick={handleOnClick}
    >
      {isMixedPatients ? (
        <Icons.MultiplePatients className="text-primary" />
      ) : (
        <Icons.Patient className="text-primary" />
      )}
      <div className="hidden min-w-0 flex-col justify-center md:flex">
        {expanded ? (
          <>
            <div className="text-foreground max-w-44 self-start truncate text-[13px] font-bold">
              {formattedPatientName}
            </div>
            <div className="text-muted-foreground max-w-48 flex gap-2 overflow-hidden text-[11px]">
              <div className="truncate">{formattedPatientID}</div>
              <div className="shrink-0">{patientInfo.PatientSex}</div>
              <div className="truncate">{patientInfo.PatientDOB}</div>
            </div>
          </>
        ) : (
          <div className="text-primary max-w-28 self-center truncate text-[13px]">
            {isMixedPatients ? 'Multiple Patients' : 'Patient'}
          </div>
        )}
      </div>
      <Icons.ArrowLeft className={`text-primary hidden md:block ${expanded ? 'rotate-180' : ''}`} />
    </div>
  );
}

export default HeaderPatientInfo;
