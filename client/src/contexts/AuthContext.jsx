import React, { createContext, useContext, useState, useEffect } from 'react';
import api from '../utils/api';

const AuthContext = createContext();

export const useAuth = () => useContext(AuthContext);

export const AuthProvider = ({ children }) => {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);

  const logout = () => {
    localStorage.removeItem('crm_token');
    localStorage.removeItem('crm_user');
    localStorage.removeItem('crm_login_time');
    setUser(null);
  };

  const checkSession = React.useCallback(() => {
    const loginTime = localStorage.getItem('crm_login_time');
    if (loginTime) {
      const twoHours = 2 * 60 * 60 * 1000;
      const elapsed = Date.now() - parseInt(loginTime);
      
      if (elapsed >= twoHours) {
        console.log('Session expired due to 2h limit');
        logout();
        window.location.href = '/login?expired=true';
      }
    }
  }, []);

  useEffect(() => {
    // Initial load: Check if user is logged in
    const token = localStorage.getItem('crm_token');
    const storedUser = localStorage.getItem('crm_user');
    
    if (token && storedUser) {
      try {
        setUser(JSON.parse(storedUser));
        checkSession();
      } catch (e) {
        console.error('Failed to parse stored user', e);
      }
    }
    setLoading(false);

    // Setup a background interval to check for expiration every 30 seconds
    const interval = setInterval(checkSession, 30000);
    return () => clearInterval(interval);
  }, [checkSession]);

  const login = async (username, password) => {
    try {
      const response = await api.post('/auth/login', { username, password });
      const { token, user, pastDueAlerts } = response.data;
      
      localStorage.setItem('crm_token', token);
      localStorage.setItem('crm_user', JSON.stringify(user));
      localStorage.setItem('crm_login_time', Date.now().toString());

      // Store past-due alerts so NotificationBell picks them up immediately
      if (pastDueAlerts && pastDueAlerts.length > 0) {
        const existing = JSON.parse(localStorage.getItem(`notifications_${user._id}`) || '[]');
        const newAlerts = pastDueAlerts.map((a, i) => ({
          id: `pastdue_${Date.now()}_${i}`,
          type: a.type,
          title: a.title,
          message: a.message,
          time: new Date(),
          path: a.path
        }));
        const merged = [...newAlerts, ...existing].slice(0, 20);
        localStorage.setItem(`notifications_${user._id}`, JSON.stringify(merged));
      }

      setUser(user);
      return { success: true };
    } catch (error) {
      return { 
        success: false, 
        error: error.response?.data?.error || 'Login failed. Please check credentials.' 
      };
    }
  };

  const value = {
    user,
    login,
    logout,
    isAuthenticated: !!user
  };

  return (
    <AuthContext.Provider value={value}>
      {!loading && children}
    </AuthContext.Provider>
  );
};
