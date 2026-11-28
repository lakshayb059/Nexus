import React, { createContext, useContext, useState, useEffect, useCallback, useRef } from 'react';
import { AppState } from 'react-native';
import api, {
  loadStoredSession,
  saveAuthSession,
  clearAuthSession,
  getRefreshToken,
  setUnauthorizedHandler,
  getServerUrl,
  setServerUrl as persistServerUrl,
} from '../services/api';

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
  const inactivityTimerRef = useRef(null);

  const logout = useCallback(async () => {
    try {
      const refreshToken = getRefreshToken();
      await api.post('/auth/logout', { refreshToken, clientType: 'mobile' });
    } catch {
      // Ignore network failure during logout
    }
    await clearAuthSession();
    setUser(null);
    setActiveBreak(null);
  }, []);

  const logoutAll = useCallback(async () => {
    try {
      await api.post('/auth/logout-all');
    } catch {
      // Ignore network failure
    }
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

  // Restore session from encrypted SecureStore and verify against server
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
          const res = await api.get('/auth/me');
          const verifiedUser = res.data?.user;
          if (verifiedUser && allowedRoles.includes(verifiedUser.role)) {
            await saveAuthSession({ user: verifiedUser });
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
  }, []);

  useEffect(() => {
    if (user && user.role === 'agent') {
      initSession();
    } else {
      setActiveBreak(null);
    }
  }, [user, initSession]);

  // Agent activity ping and 10-minute inactivity auto-logout
  const recordActivity = useCallback(() => {
    if (!user || user.role !== 'agent') return;

    if (activeBreak) {
      if (inactivityTimerRef.current) clearTimeout(inactivityTimerRef.current);
      return;
    }

    if (inactivityTimerRef.current) clearTimeout(inactivityTimerRef.current);
    inactivityTimerRef.current = setTimeout(() => {
      logout();
    }, 10 * 60 * 1000);

    const now = Date.now();
    if (now - lastPingRef.current > 30 * 1000) {
      lastPingRef.current = now;
      api.post('/agent-logs/ping').catch(() => {});
    }
  }, [user, activeBreak, logout]);

  useEffect(() => {
    if (!user || user.role !== 'agent') return;
    recordActivity();

    const subscription = AppState.addEventListener('change', (nextState) => {
      if (nextState === 'active') {
        recordActivity();
      }
    });

    return () => {
      if (inactivityTimerRef.current) clearTimeout(inactivityTimerRef.current);
      subscription.remove();
    };
  }, [user, recordActivity]);

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
