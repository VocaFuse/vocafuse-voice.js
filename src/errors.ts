/**
 * VocaFuse SDK Error Types
 * 
 * Extensible error framework for handling different types of failures
 * in the voice recording and upload process.
 */

export enum ErrorCode {
  // Authentication errors
  AUTHENTICATION_FAILED = 'AUTHENTICATION_FAILED',
  TOKEN_EXPIRED = 'TOKEN_EXPIRED',
  TOKEN_REFRESH_FAILED = 'TOKEN_REFRESH_FAILED',
  
  // Network errors
  NETWORK_ERROR = 'NETWORK_ERROR',
  REQUEST_TIMEOUT = 'REQUEST_TIMEOUT',
  REQUEST_FAILED = 'REQUEST_FAILED',
  
  // Recording errors
  MICROPHONE_ACCESS_DENIED = 'MICROPHONE_ACCESS_DENIED',
  RECORDING_NOT_SUPPORTED = 'RECORDING_NOT_SUPPORTED',
  RECORDING_FAILED = 'RECORDING_FAILED',
  RECORDING_TOO_LONG = 'RECORDING_TOO_LONG',
  
  // Upload errors
  UPLOAD_FAILED = 'UPLOAD_FAILED',
  FILE_TOO_LARGE = 'FILE_TOO_LARGE',
  INVALID_FILE_FORMAT = 'INVALID_FILE_FORMAT',
  
  // Configuration errors
  INVALID_CONFIG = 'INVALID_CONFIG',
  MISSING_TOKEN_ENDPOINT = 'MISSING_TOKEN_ENDPOINT',
  
  // General errors
  UNKNOWN_ERROR = 'UNKNOWN_ERROR',
  VALIDATION_ERROR = 'VALIDATION_ERROR'
}

export interface ErrorDetails {
  code: ErrorCode;
  message: string;
  originalError?: Error;
  context?: Record<string, unknown>;
  retryable?: boolean;
  userMessage?: string;
}

/**
 * Base SDK error class with enhanced context and retry information
 */
export class VocaFuseError extends Error {
  public readonly code: ErrorCode;
  public readonly originalError?: Error;
  public readonly context: Record<string, unknown>;
  public readonly retryable: boolean;
  public readonly userMessage: string;

  constructor(details: ErrorDetails) {
    super(details.message);
    this.name = 'VocaFuseError';
    this.code = details.code;
    this.originalError = details.originalError;
    this.context = details.context || {};
    this.retryable = details.retryable || false;
    this.userMessage = details.userMessage || this.getDefaultUserMessage();

    // Maintain proper stack trace for where our error was thrown
    if (typeof (Error as unknown as Record<string, unknown>).captureStackTrace === 'function') {
      ((Error as unknown as Record<string, unknown>).captureStackTrace as CallableFunction)(this, VocaFuseError);
    }
  }

  private getDefaultUserMessage(): string {
    switch (this.code) {
      case ErrorCode.MICROPHONE_ACCESS_DENIED:
        return 'Please allow microphone access to record audio.';
      case ErrorCode.RECORDING_NOT_SUPPORTED:
        return 'Audio recording is not supported in this browser.';
      case ErrorCode.NETWORK_ERROR:
        return 'Network connection failed. Please check your internet connection.';
      case ErrorCode.TOKEN_EXPIRED:
        return 'Your session has expired. Please refresh and try again.';
      case ErrorCode.FILE_TOO_LARGE:
        return 'The audio file is too large to upload.';
      case ErrorCode.RECORDING_TOO_LONG:
        return 'Recording is too long. Maximum duration is 60 seconds.';
      default:
        return 'An unexpected error occurred. Please try again.';
    }
  }

  /**
   * Create a JSON representation of the error for logging/debugging
   */
  toJSON(): Record<string, unknown> {
    return {
      name: this.name,
      code: this.code,
      message: this.message,
      userMessage: this.userMessage,
      retryable: this.retryable,
      context: this.context,
      stack: this.stack,
      originalError: this.originalError ? {
        name: this.originalError.name,
        message: this.originalError.message,
        stack: this.originalError.stack
      } : undefined
    };
  }
}

/**
 * Authentication-specific error
 */
export class AuthenticationError extends VocaFuseError {
  constructor(message: string, originalError?: Error, context?: Record<string, unknown>) {
    super({
      code: ErrorCode.AUTHENTICATION_FAILED,
      message,
      originalError,
      context,
      retryable: false,
      userMessage: 'Authentication failed. Please check your credentials.'
    });
    this.name = 'AuthenticationError';
  }
}

/**
 * Network-related error with retry capability
 */
export class NetworkError extends VocaFuseError {
  constructor(message: string, originalError?: Error, retryable = true, context?: Record<string, unknown>) {
    super({
      code: ErrorCode.NETWORK_ERROR,
      message,
      originalError,
      context,
      retryable,
      userMessage: 'Network error occurred. Please check your connection and try again.'
    });
    this.name = 'NetworkError';
  }
}

/**
 * Recording-specific error
 */
export class RecordingError extends VocaFuseError {
  constructor(code: ErrorCode, message: string, originalError?: Error, context?: Record<string, unknown>) {
    super({
      code,
      message,
      originalError,
      context,
      retryable: false
    });
    this.name = 'RecordingError';
  }
}

/**
 * Upload-specific error with retry capability
 */
export class UploadError extends VocaFuseError {
  constructor(message: string, originalError?: Error, retryable = true, context?: Record<string, unknown>) {
    super({
      code: ErrorCode.UPLOAD_FAILED,
      message,
      originalError,
      context,
      retryable,
      userMessage: 'Upload failed. Please try again.'
    });
    this.name = 'UploadError';
  }
}

/**
 * Configuration error
 */
export class ConfigurationError extends VocaFuseError {
  constructor(message: string, context?: Record<string, unknown>) {
    super({
      code: ErrorCode.INVALID_CONFIG,
      message,
      context,
      retryable: false,
      userMessage: 'SDK configuration error. Please contact support.'
    });
    this.name = 'ConfigurationError';
  }
}

/**
 * Helper function to create errors from API responses
 */
export function createErrorFromResponse(
  response: Response, 
  responseBody?: unknown,
  context?: Record<string, unknown>
): VocaFuseError {
  const status = response.status;
  const statusText = response.statusText;
  
  let code: ErrorCode;
  let retryable = false;
  
  if (status === 401) {
    code = ErrorCode.AUTHENTICATION_FAILED;
  } else if (status === 403) {
    code = ErrorCode.AUTHENTICATION_FAILED;
  } else if (status === 413) {
    code = ErrorCode.FILE_TOO_LARGE;
  } else if (status === 429) {
    code = ErrorCode.REQUEST_FAILED;
    retryable = true;
  } else if (status >= 500) {
    code = ErrorCode.REQUEST_FAILED;
    retryable = true;
  } else {
    code = ErrorCode.REQUEST_FAILED;
  }
  
  return new VocaFuseError({
    code,
    message: `HTTP ${status}: ${statusText}`,
    context: {
      ...context,
      status,
      statusText,
      responseBody
    },
    retryable
  });
}

/**
 * Helper function to wrap unknown errors
 */
export function wrapUnknownError(error: unknown, context?: Record<string, unknown>): VocaFuseError {
  if (error instanceof VocaFuseError) {
    return error;
  }
  
  if (error instanceof Error) {
    return new VocaFuseError({
      code: ErrorCode.UNKNOWN_ERROR,
      message: error.message,
      originalError: error,
      context
    });
  }
  
  return new VocaFuseError({
    code: ErrorCode.UNKNOWN_ERROR,
    message: 'An unknown error occurred',
    context: {
      ...context,
      originalValue: error
    }
  });
}


