/**
 * Upload functionality for VocaFuse SDK
 */
import { HttpClient } from './client.js';
import { TokenManager } from './token.js';
import { UploadError, NetworkError, wrapUnknownError } from './errors.js';
import type { VoicenoteResult } from './recorder.js';

export interface UploadConfig {
  onProgress?: (progress: number) => void; // deprecated alias
  onUploadProgress?: (progress: number) => void;
  onComplete?: (result: UploadResult) => void;
  onError?: (error: UploadError) => void;
  maxRetries?: number;
  timeout?: number;
}

export interface UploadRequest {
  file_name: string;
  file_size: number;
  audio_format: string;
  duration_seconds: number;
  use_multipart?: boolean;
  sdk_metadata: {
    duration_seconds: number;
    sample_rate?: number;
    channels?: number;
    bit_rate?: number;
    codec: string;
    file_size_bytes: number;
  };
}

export interface PresignedUrlResponse {
  recording_id: string;
  upload_type: 'single' | 'multipart';
  presigned_url?: string;
  s3_key: string;
  expires_in: number;
  processing_strategy: string;
  client_processed: boolean;
  message: string;
  upload_info?: {
    upload_id: string;
    parts: Array<{
      part_number: number;
      presigned_url: string;
      start_byte: number;
      end_byte: number;
      content_length: number;
    }>;
  };
}

export interface UploadResult {
  recording_id: string;
  upload_type: 'single' | 'multipart';
  processing_strategy: string;
  client_processed: boolean;
  s3_key: string;
  file_size: number;
  duration_seconds: number;
  audio_format: string;
}

export interface UploadProgress {
  loaded: number;
  total: number;
  percentage: number;
  phase: 'requesting' | 'uploading' | 'completing';
}

export class VocaFuseUploader {
  private readonly httpClient: HttpClient;
  private readonly tokenManager: TokenManager;
  private readonly config: UploadConfig;

  constructor(httpClient: HttpClient, tokenManager: TokenManager, config: UploadConfig = {}) {
    this.httpClient = httpClient;
    this.tokenManager = tokenManager;
    this.config = {
      maxRetries: 3,
      timeout: 60000,
      ...config
    };
  }

  async upload(voicenote: VoicenoteResult): Promise<UploadResult> {
    try {
      this.notifyProgress({ loaded: 0, total: 100, percentage: 0, phase: 'requesting' });
      const uploadRequest = this.createUploadRequest(voicenote);
      const presignedResponse = await this.requestPresignedUrl(uploadRequest);

      this.notifyProgress({ loaded: 0, total: 100, percentage: 10, phase: 'uploading' });

      if (presignedResponse.upload_type === 'single') {
        await this.uploadSingle(voicenote.blob, presignedResponse);
      } else {
        await this.uploadMultipart(voicenote.blob, presignedResponse);
      }

      this.notifyProgress({ loaded: 100, total: 100, percentage: 100, phase: 'completing' });

      const result: UploadResult = {
        recording_id: presignedResponse.recording_id,
        upload_type: presignedResponse.upload_type,
        processing_strategy: presignedResponse.processing_strategy,
        client_processed: presignedResponse.client_processed,
        s3_key: presignedResponse.s3_key,
        file_size: voicenote.size,
        duration_seconds: voicenote.duration,
        audio_format: voicenote.format
      };

      if (this.config.onComplete) this.config.onComplete(result);
      return result;
    } catch (error) {
      const uploadError = error instanceof UploadError ? error : (wrapUnknownError(error, { operation: 'upload voicenote' }) as UploadError);
      if (this.config.onError) this.config.onError(uploadError);
      throw uploadError;
    }
  }

  private createUploadRequest(voicenote: VoicenoteResult): UploadRequest {
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const extension = this.getFileExtension(voicenote.format);
    const fileName = `voicenote-${timestamp}.${extension}`;
    return {
      file_name: fileName,
      file_size: voicenote.size,
      audio_format: voicenote.format,
      duration_seconds: Math.round(voicenote.duration * 100) / 100,
      use_multipart: voicenote.size > 5 * 1024 * 1024,
      sdk_metadata: {
        duration_seconds: Math.round(voicenote.duration * 100) / 100,
        codec: voicenote.format,
        file_size_bytes: voicenote.size,
        sample_rate: 44100,
        channels: 1,
        bit_rate: 128000
      }
    };
  }

  private async requestPresignedUrl(request: UploadRequest): Promise<PresignedUrlResponse> {
    try {
      const token = await this.tokenManager.getToken();
      const response = await this.httpClient.request<PresignedUrlResponse>('/upload', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: request
      });
      return response.data;
    } catch (error) {
      throw new UploadError('Failed to get presigned upload URL', error instanceof Error ? error : new Error(String(error)));
    }
  }

  private async uploadSingle(blob: Blob, response: PresignedUrlResponse): Promise<void> {
    if (!response.presigned_url) throw new UploadError('No presigned URL provided for single upload');
    const presignedUrl = response.presigned_url!;
    const xhr = new XMLHttpRequest();
    return new Promise((resolve, reject) => {
      xhr.upload.addEventListener('progress', (event) => {
        if (event.lengthComputable) {
          const percentage = 10 + (event.loaded / event.total) * 80;
          this.notifyProgress({ loaded: event.loaded, total: event.total, percentage, phase: 'uploading' });
        }
      });
      xhr.addEventListener('load', () => {
        if (xhr.status >= 200 && xhr.status < 300) resolve();
        else reject(new UploadError(`Upload failed with status ${xhr.status}: ${xhr.statusText}`));
      });
      xhr.addEventListener('error', () => reject(new NetworkError('Network error during upload')));
      xhr.addEventListener('timeout', () => reject(new NetworkError('Upload timed out')));
      xhr.timeout = this.config.timeout || 60000;
      xhr.open('PUT', presignedUrl);
      xhr.setRequestHeader('Content-Type', blob.type);
      xhr.send(blob);
    });
  }

  private async uploadMultipart(blob: Blob, response: PresignedUrlResponse): Promise<void> {
    if (!response.upload_info) throw new UploadError('No multipart upload info provided');
    const parts = response.upload_info.parts;
    const uploadPromises = parts.map(async (part, index) => {
      const start = part.start_byte;
      const end = part.end_byte + 1;
      const chunk = blob.slice(start, end);
      await this.uploadPart(chunk, part.presigned_url, index, parts.length);
    });
    await Promise.all(uploadPromises);
  }

  private async uploadPart(chunk: Blob, presignedUrl: string, partIndex: number, totalParts: number): Promise<void> {
    const xhr = new XMLHttpRequest();
    return new Promise((resolve, reject) => {
      xhr.upload.addEventListener('progress', (event) => {
        if (event.lengthComputable) {
          const partProgress = event.loaded / event.total;
          const overallProgress = ((partIndex + partProgress) / totalParts) * 80 + 10;
          this.notifyProgress({ loaded: event.loaded, total: event.total, percentage: overallProgress, phase: 'uploading' });
        }
      });
      xhr.addEventListener('load', () => {
        if (xhr.status >= 200 && xhr.status < 300) resolve();
        else reject(new UploadError(`Part ${partIndex + 1} upload failed with status ${xhr.status}: ${xhr.statusText}`));
      });
      xhr.addEventListener('error', () => reject(new NetworkError(`Network error during part ${partIndex + 1} upload`)));
      xhr.addEventListener('timeout', () => reject(new NetworkError(`Part ${partIndex + 1} upload timed out`)));
      xhr.timeout = this.config.timeout || 60000;
      xhr.open('PUT', presignedUrl);
      xhr.setRequestHeader('Content-Type', chunk.type);
      xhr.send(chunk);
    });
  }

  private notifyProgress(progress: UploadProgress): void {
    // Prefer new callback; keep alias for backwards compatibility inside new SDK
    if (this.config.onUploadProgress) this.config.onUploadProgress(progress.percentage);
    else if (this.config.onProgress) this.config.onProgress(progress.percentage);
  }

  private getFileExtension(format: string): string {
    switch (format.toLowerCase()) {
      case 'webm': return 'webm';
      case 'ogg': return 'ogg';
      case 'mp4': return 'mp4';
      default: return 'webm';
    }
  }
}


