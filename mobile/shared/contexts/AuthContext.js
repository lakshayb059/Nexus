import React, { createContext, useContext, useState, useEffect, useCallback, useRef } from 'react';
import { AppState } from 'react-native';
import * as SecureStore from 'expo-secure-store';
import api, {
  loadStoredSession,
  saveAuthSession,
  clearAuthSession,
  getRefreshToken,
  setUnauthorizedHandler,
  getServerUrl,
  setServerUrl as persistServerUrl,
} from '../services/api';

const INACTIVITY_LIMIT_MS = 15 * 60 * 1000;
const LAST_ACTIVITY_KEY = 'nexus_last_activity_at';

const AuthContext = createContext();

export const useAuth = () => useContext(AuthContext);

export const AuthProvider = ({
  children,
  allowedRoles = ['agent', 'tl', 'admin', 'superadmin'],
  appName = 'Nexus CRM',
  wrongAppMessage = 'This account does not belong to this app.',
}) => {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);
  const [serverUrl, setServerUrlState] = useState(getServerUrl());
  const [activeBreak, setActiveBreak] = useState(null);
  const lastPingRef = useRef(0);
  const lastActivityAtRef = useRef(Date.now());
  const lastSavedActivityRef = useRef(0);
  const inactivityTimerRef = useRef(null);

  const persistLastActivity = useCallback((ts = Date.now(), force = false) => {
    lastActivityAtRef.current = ts;
    if (force || ts - lastSavedActivityRef.current >= 10 * 1000) {
      lastSavedActivityRef.current = ts;
      SecureStore.setItemAsync(LAST_ACTIVITY_KEY, String(ts)).catch(() => {});
    }
  }, []);

  const logout = useCallback(async () => {
    if (inactivityTimerRef.current) {
      clearTimeout(inactivityTimerRef.current);
      inactivityTimerRef.current = null;
    }
    try {
      const refreshToken = getRefreshToken();
      await api.post('/auth/logout', { refreshToken, clientType: 'mobile' });
    } catch {
      // Ignore network failure during logout
    }
    await SecureStore.deleteItemAsync(LAST_ACTIVITY_KEY).catch(() => {});
    await clearAuthSession();
    setUser(null);
    setActiveBreak(null);
  }, []);

  const logoutAll = useCallback(async () => {
    if (inactivityTimerRef.current) {
      clearTimeout(inactivityTimerRef.current);
      inactivityTimerRef.current = null;
    }
    try {
      await api.post('/auth/logout-all');
    } catch {
      // Ignore network failure
    }
    await SecureStore.deleteItemAsync(LAST_ACTIVITY_KEY).catch(() => {});
    await clearAuthSession();
    setUser(null);
    setActiveBreak(null);
  }, []);

  const initSession = useCallback(async () => {
    try {
      const res = await api.post('/agent-logs/session-init');
      const session = res.data;
      if (session?.activeBreakType && session?.activeBreakStart) {
        setActiveBreak({
          type: session.activeBreakType,
          startTime: session.activeBreakStart,
        });
      } else {
        setActiveBreak(null);
      }
    } catch {
      // Non-blocking
    }
  }, []);

  // Restore session from encrypted SecureStore and verify 15-minute inactivity + server validity
  useEffect(() => {
    setUnauthorizedHandler(() => {
      setUser(null);
      setActiveBreak(null);
    });

    let cancelled = false;
    async function bootstrap() {
      try {
        const stored = await loadStoredSession();
        if (!cancelled) {
          setServerUrlState(stored.serverUrl);
        }

        if (stored.accessToken || stored.refreshToken) {
          const rawLastActive = await SecureStore.getItemAsync(LAST_ACTIVITY_KEY).catch(() => null);
          const lastActiveMs = rawLastActive ? Number(rawLastActive) : null;
          if (lastActiveMs && Number.isFinite(lastActiveMs) && Date.now() - lastActiveMs >= INACTIVITY_LIMIT_MS) {
            try {
              await api.post('/auth/logout', { refreshToken: stored.refreshToken, clientType: 'mobile' });
            } catch {
              // Non-blocking
            }
            await SecureStore.deleteItemAsync(LAST_ACTIVITY_KEY).catch(() => {});
            await clearAuthSession();
            if (!cancelled) setUser(null);
            return;
          }

          const res = await api.get('/auth/me');
          const verifiedUser = res.data?.user;
          if (verifiedUser && allowedRoles.includes(verifiedUser.role)) {
            await saveAuthSession({ user: verifiedUser });
            persistLastActivity(Date.now(), true);
            if (!cancelled) setUser(verifiedUser);
          } else {
            await clearAuthSession();
            if (!cancelled) setUser(null);
          }
        }
      } catch {
        await clearAuthSession();
        if (!cancelled) setUser(null);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    bootstrap();
    return () => {
      cancelled = true;
      setUnauthorizedHandler(null);
    };
  }, [persistLastActivity]);

  useEffect(() => {
    if (user && user.role === 'agent') {
      initSession();
    } else {
      setActiveBreak(null);
    }
  }, [user, initSession]);

  // Global 15-minute inactivity auto-logout for ALL authenticated users (+ agent ping)
  const recordActivity = useCallback(() => {
    if (!user) return;

    const now = Date.now();
    persistLastActivity(now, false);

    if (activeBreak) {
      if (inactivityTimerRef.current) clearTimeout(inactivityTimerRef.current);
      return;
    }

    if (inactivityTimerRef.current) clearTimeout(inactivityTimerRef.current);
    inactivityTimerRef.current = setTimeout(() => {
      logout();
    }, INACTIVITY_LIMIT_MS);

    if (user.role === 'agent' && now - lastPingRef.current > 30 * 1000) {
      lastPingRef.current = now;
      api.post('/agent-logs/ping').catch(() => {});
    }
  }, [user, activeBreak, logout, persistLastActivity]);

  useEffect(() => {
    if (!user) return;
    recordActivity();

    const intervalId = setInterval(() => {
      if (!activeBreak && Date.now() - lastActivityAtRef.current >= INACTIVITY_LIMIT_MS) {
        logout();
      }
    }, 15 * 1000);

    const subscription = AppState.addEventListener('change', (nextState) => {
      if (nextState === 'active') {
        if (!activeBreak && Date.now() - lastActivityAtRef.current >= INACTIVITY_LIMIT_MS) {
          logout();
        } else {
          recordActivity();
        }
      }
    });

    return () => {
      clearInterval(intervalId);
      if (inactivityTimerRef.current) clearTimeout(inactivityTimerRef.current);
      subscription.remove();
    };
  }, [user, activeBreak, logout, recordActivity]);

  const updateServerUrl = async (nextUrl) => {
    const updated = await persistServerUrl(nextUrl);
    setServerUrlState(updated);
    return updated;
  };

  const login = async (identifier, password, turnstileToken = null) => {
    try {
      const payload = {
        identifier,
        password,
        clientType: 'mobile',
      };
      if (turnstileToken) payload.turnstileToken = turnstileToken;
      const response = await api.post('/auth/login', payload);

      const { accessToken, refreshToken, user: loggedInUser } = response.data || {};
      if (!loggedInUser || !accessToken) {
        return { success: false, error: response.data?.error || 'Invalid credentials.' };
      }

      if (!allowedRoles.includes(loggedInUser.role)) {
        try {
          await api.post(
            '/auth/logout',
            { refreshToken, clientType: 'mobile' },
            { headers: { Authorization: `Bearer ${accessToken}` } }
          );
        } catch {
          // Ignore logout failure
        }
        await clearAuthSession();
        return { success: false, error: wrongAppMessage };
      }

      await saveAuthSession({ accessToken, refreshToken, user: loggedInUser });
      persistLastActivity(Date.now(), true);
      setUser(loggedInUser);
      return { success: true };
    } catch (error) {
      let errorMessage = 'Invalid credentials.';
      if (error.response?.status === 502 || error.message === 'Network Error' || !error.response) {
        errorMessage = 'Cannot reach server. Check your internet or Backend Server URL.';
      } else if (error.response?.data?.error) {
        errorMessage = error.response.data.error;
      }
      return { success: false, error: errorMessage };
    }
  };

  const register = async ({ name, email, password, turnstileToken = null }) => {
    try {
      const payload = {
        name,
        email,
        password,
        clientType: 'mobile',
      };
      if (turnstileToken) payload.turnstileToken = turnstileToken;
      const res = await api.post('/auth/register', payload);
      return { success: true, message: res.data?.message || 'Account registered successfully.' };
    } catch (error) {
      return {
        success: false,
        error: error.response?.data?.error || 'Unable to register account.',
      };
    }
  };

  const forgotPassword = async (email, turnstileToken = null) => {
    try {
      const payload = { email, clientType: 'mobile' };
      if (turnstileToken) payload.turnstileToken = turnstileToken;
      const res = await api.post('/auth/forgot-password', payload);
      return {
        success: true,
        message: res.data?.message || 'If an account matching that email exists, a password reset link has been sent.',
      };
    } catch (error) {
      return {
        success: false,
        error: error.response?.data?.error || 'Unable to process password reset request.',
      };
    }
  };

  const resetPassword = async (token, newPassword, turnstileToken = null) => {
    try {
      const res = await api.post('/auth/reset-password', { token, newPassword, turnstileToken });
      return { success: true, message: res.data?.message || 'Password reset successfully.' };
    } catch (error) {
      return {
        success: false,
        error: error.response?.data?.error || 'Invalid or expired reset token.',
      };
    }
  };

  const changePassword = async (currentPassword, newPassword) => {
    try {
      const res = await api.post('/auth/change-password', {
        currentPassword,
        newPassword,
        clientType: 'mobile',
      });
      const { accessToken, refreshToken, user: nextUser } = res.data || {};
      await saveAuthSession({
        ...(accessToken ? { accessToken } : {}),
        ...(refreshToken ? { refreshToken } : {}),
        ...(nextUser ? { user: nextUser } : {}),
      });
      if (nextUser) setUser(nextUser);
      return { success: true, message: res.data?.message || 'Password updated successfully.' };
    } catch (error) {
      return {
        success: false,
        error: error.response?.data?.error || 'Failed to update password.',
      };
    }
  };

  const updateUser = async (updates) => {
    const nextUser = user ? { ...user, ...updates } : updates;
    setUser(nextUser);
    await saveAuthSession({ user: nextUser });
  };

  return (
    <AuthContext.Provider
      value={{
        appName,
        user,
        loading,
        serverUrl,
        updateServerUrl,
        login,
        register,
        logout,
        logoutAll,
        forgotPassword,
        resetPassword,
        changePassword,
        updateUser,
        isAuthenticated: !!user,
        activeBreak,
        setActiveBreak,
        initSession,
        recordActivity,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
};
