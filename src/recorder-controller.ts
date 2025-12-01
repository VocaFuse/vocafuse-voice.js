import { AudioRecorder, type VoicenoteResult } from './recorder.js';
import { VocaFuseUploader, type UploadResult } from './upload.js';
import { HttpClient } from './client.js';
import { TokenManager } from './token.js';
import { ErrorCode, VoicenoteError } from './errors.js';

export interface RecorderOptions {
  maxDuration?: number;
  autoUpload?: boolean; // default true
  onStateChange?: (state: RecorderState) => void;
  onRecordProgress?: (seconds: number) => void;
  onUploadProgress?: (percentage: number) => void;
  onComplete?: (result: UploadResult) => void;
  onError?: (error: unknown) => void;
  onCancel?: () => void;
}

export type RecorderState = 'idle' | 'recording' | 'stopped' | 'uploading' | 'uploaded' | 'error';

export class VoiceRecorder {
  private audioRecorder: AudioRecorder;
  private uploader: VocaFuseUploader;
  private _state: RecorderState = 'idle';
  private _duration: number = 0;
  private recordingResult: VoicenoteResult | null = null;

  constructor(
    httpClient: HttpClient,
    tokenManager: TokenManager,
    private options: RecorderOptions = {}
  ) {
    this.audioRecorder = new AudioRecorder({
      maxDuration: options.maxDuration ?? 60,
      onProgress: (duration) => {
        this._duration = duration;
        this.options.onRecordProgress?.(duration);
      }
    });
    
    this.uploader = new VocaFuseUploader(httpClient, tokenManager, {
      onProgress: options.onUploadProgress,
      onComplete: options.onComplete,
      onError: (error) => this.options.onError?.(error)
    });
  }

  get state(): RecorderState {
    return this._state;
  }

  get duration(): number {
    return this._duration;
  }

  get isRecording(): boolean {
    return this._state === 'recording';
  }

  get isUploading(): boolean {
    return this._state === 'uploading';
  }

  async start(): Promise<void> {
    if (this._state !== 'idle') {
      throw new VoicenoteError(
        ErrorCode.RECORDING_FAILED,
        `Cannot start recording from state: ${this._state}`
      );
    }
    this.setState('recording');
    await this.audioRecorder.start();
  }

  async stop(): Promise<UploadResult | VoicenoteResult> {
    if (this._state !== 'recording') {
      throw new VoicenoteError(
        ErrorCode.RECORDING_FAILED,
        `Cannot stop recording from state: ${this._state}`
      );
    }

    this.recordingResult = await this.audioRecorder.stop();
    this.setState('stopped');
    
    // Auto-upload
    const autoUpload = this.options.autoUpload !== false; // default true
    if (autoUpload) {
      this.setState('uploading');
      const result = await this.uploader.upload(this.recordingResult);
      this.setState('uploaded');
      
      // Reset to idle state for next recording
      this.reset();
      
      return result;
    }
    return this.recordingResult;
  }

  async cancel(): Promise<void> {
    await this.audioRecorder.cancel();
    this.setState('idle');
    this._duration = 0;
    this.recordingResult = null;
    this.options.onCancel?.();
  }

  pause(): void {
    this.audioRecorder.pause();
  }

  resume(): void {
    this.audioRecorder.resume();
  }

  destroy(): void {
    this.audioRecorder.cancel();
  }

  private reset(): void {
    this._duration = 0;
    this.recordingResult = null;
    this.setState('idle');
  }

  private setState(newState: RecorderState): void {
    this._state = newState;
    this.options.onStateChange?.(newState);
  }
}


