import { useState, useCallback, useEffect } from 'react';
import { getApiClient } from '../api/client';
import type { AuthInitResponse, AuthVerifyResponse } from '../api/types';

export interface AuthState {
  isAuthenticated: boolean;
  isLoading: boolean;
  error: string | null;
  tempToken: string | null;
  expiresAt: string | null;
}

export function useAuth() {
  const [state, setState] = useState<AuthState>({
    isAuthenticated: getApiClient().hasApiKey(),
    isLoading: false,
    error: null,
    tempToken: null,
    expiresAt: null,
  });

  const client = getApiClient();

  const initAuth = useCallback(async (): Promise<AuthInitResponse> => {
    setState((s) => ({ ...s, isLoading: true, error: null }));
    try {
      const result = await client.authInit();
      setState((s) => ({
        ...s,
        isLoading: false,
        tempToken: result.tempToken,
        expiresAt: result.expiresAt,
      }));
      return result;
    } catch (err) {
      const error = err instanceof Error ? err.message : 'Auth init failed';
      setState((s) => ({ ...s, isLoading: false, error }));
      throw err;
    }
  }, [client]);

  const verifyAuth = useCallback(
    async (tempToken: string): Promise<AuthVerifyResponse> => {
      setState((s) => ({ ...s, isLoading: true, error: null }));
      try {
        const result = await client.authVerify(tempToken);
        setState((s) => ({
          ...s,
          isLoading: false,
          isAuthenticated: true,
          tempToken: null,
          expiresAt: null,
        }));
        return result;
      } catch (err) {
        const error = err instanceof Error ? err.message : 'Auth verify failed';
        setState((s) => ({ ...s, isLoading: false, error }));
        throw err;
      }
    },
    [client]
  );

  const validateAuth = useCallback(async (): Promise<boolean> => {
    if (!client.hasApiKey()) {
      setState((s) => ({ ...s, isAuthenticated: false }));
      return false;
    }

    try {
      await client.authValidate();
      setState((s) => ({ ...s, isAuthenticated: true }));
      return true;
    } catch {
      client.clearApiKey();
      setState((s) => ({ ...s, isAuthenticated: false }));
      return false;
    }
  }, [client]);

  const requireAuth = useCallback(async (): Promise<void> => {
    if (state.isAuthenticated && client.hasApiKey()) {
      try {
        await client.authValidate();
        return;
      } catch {
        client.clearApiKey();
      }
    }
    const { tempToken } = await initAuth();
    await verifyAuth(tempToken);
  }, [client, state.isAuthenticated, initAuth, verifyAuth]);

  const logout = useCallback(() => {
    client.clearApiKey();
    setState({
      isAuthenticated: false,
      isLoading: false,
      error: null,
      tempToken: null,
      expiresAt: null,
    });
  }, [client]);

  // Check auth status on mount
  useEffect(() => {
    validateAuth();
  }, [validateAuth]);

  return {
    ...state,
    initAuth,
    verifyAuth,
    validateAuth,
    requireAuth,
    logout,
  };
}
