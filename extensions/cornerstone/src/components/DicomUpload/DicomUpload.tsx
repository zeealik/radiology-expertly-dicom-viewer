import React, { useCallback, useState } from 'react';
import { ReactElement } from 'react';
import Dropzone from 'react-dropzone';
import PropTypes from 'prop-types';
import classNames from 'classnames';
import DicomFileUploader from '../../utils/DicomFileUploader';
import DicomUploadProgress from './DicomUploadProgress';
import { Button } from '@ohif/ui-next';
// Removed dashed border CSS; using simple 1px solid border with muted foreground color

type DicomUploadProps = {
  dataSource;
  onComplete: () => void;
  onStarted: () => void;
};

function DicomUpload({ dataSource, onComplete, onStarted }: DicomUploadProps): ReactElement {
  const baseClassNames =
    'min-h-[375px] flex flex-col bg-background select-none rounded-lg overflow-hidden';
  const [dicomFileUploaderArr, setDicomFileUploaderArr] = useState([]);
  const [acceptedFiles, setAcceptedFiles] = useState([]);
  const [patientName, setPatientName] = useState('');

  const onDrop = useCallback(async acceptedFiles => {
    setAcceptedFiles(acceptedFiles);
    setPatientName('');
  }, []);

  const startUpload = useCallback(() => {
    const trimmedPatientName = patientName.trim();

    if (!acceptedFiles.length || !trimmedPatientName) {
      return;
    }

    onStarted();
    setDicomFileUploaderArr(
      acceptedFiles.map(file => new DicomFileUploader(file, dataSource, trimmedPatientName))
    );
  }, [acceptedFiles, dataSource, onStarted, patientName]);

  const cancelPatientNamePrompt = useCallback(() => {
    setAcceptedFiles([]);
    setPatientName('');
  }, []);

  const getDropZoneComponent = (): ReactElement => {
    return (
      <Dropzone
        onDrop={acceptedFiles => {
          onDrop(acceptedFiles);
        }}
        noClick
      >
        {({ getRootProps }) => (
          <div
            {...getRootProps()}
            className="m-5 flex h-full flex-col items-center justify-center rounded-2xl border"
            style={{ borderColor: 'hsl(var(--muted-foreground) / 0.25)' }}
          >
            <div className="flex gap-2">
              <Dropzone
                onDrop={onDrop}
                noDrag
              >
                {({ getRootProps, getInputProps }) => (
                  <div {...getRootProps()}>
                    <Button
                      variant="default"
                      size="lg"
                      disabled={false}
                      onClick={() => {}}
                    >
                      {'Add files'}
                      <input
                        {...getInputProps()}
                        style={{ display: 'none' }}
                      />
                    </Button>
                  </div>
                )}
              </Dropzone>
              <Dropzone
                onDrop={onDrop}
                noDrag
              >
                {({ getRootProps, getInputProps }) => {
                  const folderInputProps = {
                    ...getInputProps(),
                    webkitdirectory: 'true',
                    mozdirectory: 'true',
                  } as React.InputHTMLAttributes<HTMLInputElement>;

                  return (
                    <div {...getRootProps()}>
                      <Button
                        variant="secondary"
                        size="lg"
                        disabled={false}
                        onClick={() => {}}
                      >
                        {'Add folder'}
                        <input
                          {...folderInputProps}
                          style={{ display: 'none' }}
                        />
                      </Button>
                    </div>
                  );
                }}
              </Dropzone>
            </div>
            <div className="text-foreground pt-6 text-base">or drag images or folders here</div>
            <div className="text-muted-foreground pt-1 text-base">(DICOM files supported)</div>
          </div>
        )}
      </Dropzone>
    );
  };

  const getPatientNamePromptComponent = (): ReactElement => {
    return (
      <div className="border-input m-5 flex h-full flex-col justify-center rounded-2xl border p-8">
        <div className="text-foreground text-xl font-semibold">Set patient name</div>
        <div className="text-muted-foreground pt-2 text-base">
          {`${acceptedFiles.length} ${acceptedFiles.length === 1 ? 'file' : 'files'} selected`}
        </div>
        <label
          htmlFor="dicom-upload-patient-name"
          className="text-foreground pt-8 pb-2 text-sm font-medium"
        >
          Patient Name
        </label>
        <input
          id="dicom-upload-patient-name"
          className="bg-background text-foreground border-input focus:border-primary h-11 rounded-md border px-3 text-base outline-none"
          autoFocus
          value={patientName}
          onChange={event => setPatientName(event.target.value)}
          onKeyDown={event => {
            if (event.key === 'Enter') {
              startUpload();
            }
            if (event.key === 'Escape') {
              cancelPatientNamePrompt();
            }
          }}
          placeholder="Example: John^Doe"
        />
        <div className="mt-8 flex justify-end gap-3">
          <Button
            variant="secondary"
            size="lg"
            onClick={cancelPatientNamePrompt}
          >
            Cancel
          </Button>
          <Button
            variant="default"
            size="lg"
            disabled={!patientName.trim()}
            onClick={startUpload}
          >
            Upload
          </Button>
        </div>
      </div>
    );
  };

  return (
    <>
      {dicomFileUploaderArr.length ? (
        <div className={classNames('h-[calc(100vh-300px)]', baseClassNames)}>
          <DicomUploadProgress
            dicomFileUploaderArr={Array.from(dicomFileUploaderArr)}
            onComplete={onComplete}
          />
        </div>
      ) : acceptedFiles.length ? (
        <div className={classNames('h-[480px]', baseClassNames)}>
          {getPatientNamePromptComponent()}
        </div>
      ) : (
        <div className={classNames('h-[480px]', baseClassNames)}>{getDropZoneComponent()}</div>
      )}
    </>
  );
}

DicomUpload.propTypes = {
  dataSource: PropTypes.object.isRequired,
  onComplete: PropTypes.func.isRequired,
  onStarted: PropTypes.func.isRequired,
};

export default DicomUpload;
