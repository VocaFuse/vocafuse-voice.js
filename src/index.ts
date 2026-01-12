import { HttpClient } from './client.js';
import { TokenManager } from './token.js';
import { VoiceRecorder, type RecorderOptions } from './recorder-controller.js';
import { ConfigurationError } from './errors.js';

export { VoiceRecorder } from './recorder-controller.js';
export type { RecorderOptions, RecorderState } from './recorder-controller.js';
export type { UploadResult } from './upload.js';
export type { RecordingResult } from './recorder.js';
export { ErrorCode, VocaFuseError, AuthenticationError, NetworkError, RecordingError, UploadError } from './errors.js';

export interface SDKConfig {
  tokenEndpoint: string;
  apiBaseUrl?: string;
  timeout?: number;
  retries?: number;
  debug?: boolean;
}

export interface SDKInfo {
  version: string;
  recordingSupported: boolean;
  tokenEndpoint: string;
  apiBaseUrl: string;
  identity: string;
}

interface InternalSDKConfig {
  tokenEndpoint: string;
  apiBaseUrl: string;
  timeout: number;
  retries: number;
  debug: boolean;
}

export const VERSION = '1.0.0';

class VocaFuseSDKBase {
  protected readonly config: InternalSDKConfig;
  protected readonly tokenManager: TokenManager;
  protected readonly httpClient: HttpClient;

  constructor(config: SDKConfig) {
    if (!config.tokenEndpoint) {
      throw new ConfigurationError('tokenEndpoint is required in SDK configuration');
    }

    this.config = {
      apiBaseUrl: 'https://api.vocafuse.com',
      timeout: 30000,
      retries: 3,
      debug: false,
      ...config
    };

    this.tokenManager = new TokenManager({
      tokenEndpoint: this.config.tokenEndpoint,
      maxRetries: this.config.retries
    });

    this.httpClient = new HttpClient({
      baseUrl: this.config.apiBaseUrl,
      timeout: this.config.timeout,
      retries: {
        maxRetries: this.config.retries,
        baseDelay: 1000,
        maxDelay: 10000,
        backoffFactor: 2
      }
    });
  }

  async init(): Promise<void> {
    await this.tokenManager.getToken();
  }

  async getTokenInfo() {
    return this.tokenManager.getTokenInfo();
  }

  reset(): void {
    this.tokenManager.clearToken();
  }
}

export class VocaFuseSDK extends VocaFuseSDKBase {
  createRecorder(options?: RecorderOptions): VoiceRecorder {
    return new VoiceRecorder(this.httpClient, this.tokenManager, options);
  }

  isRecordingSupported(): boolean {
    return typeof MediaRecorder !== 'undefined' && 
           typeof navigator.mediaDevices?.getUserMedia === 'function';
  }

  getInfo(): SDKInfo {
    return {
      version: VERSION,
      recordingSupported: this.isRecordingSupported(),
      tokenEndpoint: this.config.tokenEndpoint,
      apiBaseUrl: this.config.apiBaseUrl,
      identity: 'managed_by_backend'
    };
  }
}


