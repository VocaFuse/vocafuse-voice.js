/**
 * VocaFuse Token Management
 */
import { AuthenticationError, ConfigurationError, wrapUnknownError } from './errors.js';

export interface TokenData {
  jwt_token: string;
  id_token?: string;
  token_type: string;
  expires_in: number;
  tenant_id: string;
  service_account?: string;
  scopes: string[];
}

export interface TokenResponse {
  success: boolean;
  data: TokenData;
  message: string;
}

export interface TokenConfig {
  tokenEndpoint: string;
  refreshBuffer?: number; // Seconds before expiry to refresh (default: 300 = 5 minutes)
  maxRetries?: number;
}

interface CachedToken {
  data: TokenData;
  expiresAt: number;
  fetchedAt: number;
}

export class TokenManager {
  private readonly config: Required<TokenConfig>;
  private cachedToken: CachedToken | null = null;
  private actualJwtToken: string | null = null;
  private refreshPromise: Promise<void> | null = null;

  constructor(config: TokenConfig) {
    if (!config.tokenEndpoint) {
      throw new ConfigurationError('Token endpoint is required', { config });
    }

    this.config = {
      refreshBuffer: 300,
      maxRetries: 3,
      ...config
    } as Required<TokenConfig>;
  }

  async getToken(): Promise<string> {
    try {
      if (this.actualJwtToken && this.cachedToken && this.isTokenValid()) {
        return this.actualJwtToken;
      }
      return this.fetchNewToken();
    } catch (error) {
      throw wrapUnknownError(error, { operation: 'getToken' });
    }
  }

  private isTokenValid(): boolean {
    if (!this.cachedToken) return false;
    const now = Date.now();
    const expiresAt = this.cachedToken.expiresAt;
    const bufferMs = this.config.refreshBuffer * 1000;
    return expiresAt > (now + bufferMs);
  }

  async refreshToken(): Promise<string> {
    if (this.refreshPromise) {
      await this.refreshPromise;
      return this.actualJwtToken || '';
    }
    this.refreshPromise = this.fetchTokenData();
    try {
      await this.refreshPromise;
      return this.actualJwtToken || '';
    } finally {
      this.refreshPromise = null;
    }
  }

  clearToken(): void {
    this.cachedToken = null;
    this.actualJwtToken = null;
    this.refreshPromise = null;
  }

  async getTokenInfo(): Promise<{ 
    isValid: boolean; 
    expiresAt?: Date; 
    tenantId?: string; 
    scopes?: string[];
  }> {
    if (!this.actualJwtToken || !this.cachedToken || !this.isTokenValid()) {
      return { isValid: false };
    }
    return {
      isValid: true,
      expiresAt: new Date(this.cachedToken.expiresAt),
      tenantId: this.cachedToken.data.tenant_id,
      scopes: this.cachedToken.data.scopes
    };
  }

  private async fetchNewToken(): Promise<string> {
    await this.fetchTokenData();
    return this.actualJwtToken || '';
  }

  private async fetchTokenData(): Promise<void> {
    try {
      // NOTE: The 'scopes' field in the request is not used by the token endpoint.
      // Scopes are controlled server-side by the Pre-Token Generation Lambda and are
      // hardcoded to: ['voice-api.upload_recording', 'voice-api.read_recording']
      // This field is kept for backwards compatibility but has no effect.
      const requestBody = {
        scopes: ['voice-api.upload']
      };

      const response = await fetch(this.config.tokenEndpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(requestBody)
      });

      if (!response.ok) {
        throw new AuthenticationError(`HTTP ${response.status}: ${response.statusText}`);
      }

      const tokenData = await response.json() as TokenResponse;

      const idToken = tokenData.data?.id_token;
      if (tokenData.success && tokenData.data && idToken) {
        this.actualJwtToken = idToken;
        this.cachedToken = {
          data: {
            jwt_token: idToken,
            token_type: tokenData.data.token_type || 'Bearer',
            expires_in: tokenData.data.expires_in || 3600,
            tenant_id: tokenData.data.tenant_id || '',
            // Server returns actual scopes: ['voice-api.upload_recording', 'voice-api.read_recording']
            scopes: tokenData.data.scopes || ['voice-api.upload_recording', 'voice-api.read_recording']
          },
          expiresAt: Date.now() + (tokenData.data.expires_in || 3600) * 1000,
          fetchedAt: Date.now()
        };
      } else {
        throw new AuthenticationError('No authentication token received from server');
      }
    } catch (error) {
      if (error instanceof AuthenticationError) {
        throw error;
      }
      throw new AuthenticationError('Failed to fetch token from endpoint', error instanceof Error ? error : undefined, { endpoint: this.config.tokenEndpoint });
    }
  }
}

export function decodeJwtPayload(token: string): Record<string, unknown> | null {
  try {
    const parts = token.split('.');
    if (parts.length !== 3) {
      return null;
    }
    const payload = parts[1];
    const paddedPayload = payload + '='.repeat((4 - payload.length % 4) % 4);
    const decoded = atob(paddedPayload);
    return JSON.parse(decoded);
  } catch (_error) {
    return null;
  }
}

export function isJwtExpired(token: string): boolean {
  const payload = decodeJwtPayload(token) as { exp?: number } | null;
  if (!payload || typeof payload.exp !== 'number') {
    return true;
  }
  const now = Math.floor(Date.now() / 1000);
  return payload.exp <= now;
}


