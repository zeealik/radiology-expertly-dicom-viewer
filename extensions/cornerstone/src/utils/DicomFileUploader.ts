import dicomImageLoader from '@cornerstonejs/dicom-image-loader';
import dcmjs from 'dcmjs';

import { PubSubService } from '@ohif/core';

export const EVENTS = {
  PROGRESS: 'event:DicomFileUploader:progress',
};

export interface DicomFileUploaderEvent {
  fileId: number;
}

export interface DicomFileUploaderProgressEvent extends DicomFileUploaderEvent {
  percentComplete: number;
}

export enum UploadStatus {
  NotStarted,
  InProgress,
  Success,
  Failed,
  Cancelled,
}

type CancelOrFailed = UploadStatus.Cancelled | UploadStatus.Failed;
type UploadCallbacks = Record<string, EventListener>;
type PreparedDicomUpload = {
  arrayBuffer: ArrayBuffer;
  studyInstanceUID?: string;
};

export class UploadRejection {
  message: string;
  status: CancelOrFailed;

  constructor(status: CancelOrFailed, message: string) {
    this.message = message;
    this.status = status;
  }
}

export default class DicomFileUploader extends PubSubService {
  private _file;
  private _fileId;
  private _dataSource;
  private _patientName;
  private _loadPromise;
  private _abortController = new AbortController();
  private _status: UploadStatus = UploadStatus.NotStarted;
  private _percentComplete = 0;

  constructor(file, dataSource, patientName = '') {
    super(EVENTS);
    this._file = file;
    this._fileId = dicomImageLoader.wadouri.fileManager.add(file);
    this._dataSource = dataSource;
    this._patientName = patientName;
  }

  getFileId(): string {
    return this._fileId;
  }

  getFileName(): string {
    return this._file.name;
  }

  getFileSize(): number {
    return this._file.size;
  }

  cancel(): void {
    this._abortController.abort();
  }

  getStatus(): UploadStatus {
    return this._status;
  }

  getPercentComplete(): number {
    return this._percentComplete;
  }

  async load(): Promise<void> {
    if (this._loadPromise) {
      // Already started loading, return the load promise.
      return this._loadPromise;
    }

    this._loadPromise = new Promise<void>((resolve, reject) => {
      // The upload listeners: fire progress events and/or settle the promise.
      const uploadCallbacks: UploadCallbacks = {
        progress: evt => {
          const progressEvent = evt as ProgressEvent;

          if (!progressEvent.lengthComputable) {
            // Progress computation is not possible.
            return;
          }

          this._status = UploadStatus.InProgress;

          this._percentComplete = Math.round((100 * progressEvent.loaded) / progressEvent.total);
          this._broadcastEvent(EVENTS.PROGRESS, {
            fileId: this._fileId,
            percentComplete: this._percentComplete,
          });
        },
        timeout: () => {
          this._reject(reject, new UploadRejection(UploadStatus.Failed, 'The request timed out.'));
        },
        abort: () => {
          this._reject(reject, new UploadRejection(UploadStatus.Cancelled, 'Cancelled'));
        },
        error: () => {
          this._reject(reject, new UploadRejection(UploadStatus.Failed, 'The request failed.'));
        },
      };

      // First try to load the file.
      dicomImageLoader.wadouri
        .loadFileRequest(this._fileId)
        .then(dicomFile => {
          if (this._abortController.signal.aborted) {
            this._reject(reject, new UploadRejection(UploadStatus.Cancelled, 'Cancelled'));
            return;
          }

          if (!this._checkDicomFile(dicomFile)) {
            // The file is not DICOM
            this._reject(
              reject,
              new UploadRejection(UploadStatus.Failed, 'Not a valid DICOM file.')
            );
            return;
          }

          const request = new XMLHttpRequest();
          this._addRequestCallbacks(request, uploadCallbacks);

          const preparedDicom = this._patientName
            ? this._prepareDicomForUpload(dicomFile, this._patientName)
            : { arrayBuffer: dicomFile };

          // Do the actual upload by supplying the DICOM file and upload callbacks/listeners.
          return this._dataSource.store
            .dicom(preparedDicom.arrayBuffer, request)
            .then(async () => {
              if (this._patientName && preparedDicom.studyInstanceUID) {
                await this._applyStudyLabel(preparedDicom.studyInstanceUID, this._patientName);
              }

              this._status = UploadStatus.Success;
              resolve();
            })
            .catch(reason => {
              this._reject(reject, reason);
            });
        })
        .catch(reason => {
          this._reject(reject, reason);
        });
    });

    return this._loadPromise;
  }

  private _isRejected(): boolean {
    return this._status === UploadStatus.Failed || this._status === UploadStatus.Cancelled;
  }

  private _reject(reject: (reason?: any) => void, reason: any) {
    if (this._isRejected()) {
      return;
    }

    if (reason instanceof UploadRejection) {
      this._status = reason.status;
      reject(reason);
      return;
    }

    this._status = UploadStatus.Failed;

    if (reason.message) {
      reject(new UploadRejection(UploadStatus.Failed, reason.message));
      return;
    }

    reject(new UploadRejection(UploadStatus.Failed, reason));
  }

  private _addRequestCallbacks(request: XMLHttpRequest, uploadCallbacks: UploadCallbacks) {
    const abortCallback = () => request.abort();
    this._abortController.signal.addEventListener('abort', abortCallback);

    for (const [eventName, callback] of Object.entries(uploadCallbacks)) {
      request.upload.addEventListener(eventName, callback);
    }

    const cleanUpCallback = () => {
      this._abortController.signal.removeEventListener('abort', abortCallback);

      for (const [eventName, callback] of Object.entries(uploadCallbacks)) {
        request.upload.removeEventListener(eventName, callback);
      }

      request.removeEventListener('loadend', cleanUpCallback);
    };
    request.addEventListener('loadend', cleanUpCallback);
  }

  private _checkDicomFile(arrayBuffer: ArrayBuffer) {
    if (arrayBuffer.byteLength <= 132) {
      return false;
    }
    const arr = new Uint8Array(arrayBuffer.slice(128, 132));
    // bytes from 128 to 132 must be "DICM"
    return Array.from('DICM').every((char, i) => char.charCodeAt(0) === arr[i]);
  }

  private _prepareDicomForUpload(
    arrayBuffer: ArrayBuffer,
    patientName: string
  ): PreparedDicomUpload {
    const { DicomMessage } = dcmjs.data;
    const dicomData = DicomMessage.readFile(arrayBuffer);
    const studyInstanceUID = this._getDicomStringValue(dicomData.dict['0020000D']);

    dicomData.dict['00100010'] = {
      vr: 'PN',
      Value: [patientName],
    };

    return {
      arrayBuffer: dicomData.write(),
      studyInstanceUID,
    };
  }

  private _getDicomStringValue(element): string | undefined {
    const value = element?.Value?.[0];

    return typeof value === 'string' && value ? value : undefined;
  }

  private async _applyStudyLabel(studyInstanceUID: string, label: string): Promise<void> {
    const orthancRoot = this._getOrthancRoot();

    if (!orthancRoot) {
      return;
    }

    const studiesResponse = await fetch(`${orthancRoot}/tools/find`, {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        Level: 'Study',
        Query: {
          StudyInstanceUID: studyInstanceUID,
        },
      }),
    });

    if (!studiesResponse.ok) {
      throw new Error('Unable to find uploaded Orthanc study for labeling.');
    }

    const studyIds = await studiesResponse.json();
    const studyId = Array.isArray(studyIds) ? studyIds[0] : null;

    if (!studyId) {
      return;
    }

    const labelResponse = await fetch(
      `${orthancRoot}/studies/${encodeURIComponent(studyId)}/labels/${encodeURIComponent(label)}`,
      {
        method: 'PUT',
      }
    );

    if (!labelResponse.ok) {
      throw new Error('Unable to apply Orthanc study label.');
    }
  }

  private _getOrthancRoot(): string | undefined {
    const config = this._dataSource.getConfig?.();
    const dicomWebRoot = config?.qidoRoot || config?.wadoRoot || config?.wadoUriRoot;

    if (typeof dicomWebRoot !== 'string' || !dicomWebRoot) {
      return undefined;
    }

    return dicomWebRoot.replace(/\/dicom-web\/?$/, '').replace(/\/$/, '');
  }
}
