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
      const fifteenMinutes = 15 * 60 * 1000;
      const elapsed = Date.now() - parseInt(loginTime);
      
      if (elapsed >= fifteenMinutes) {
        console.log('Session expired due to 15m limit');
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
      const { token, user } = response.data;
      
      localStorage.setItem('crm_token', token);
      localStorage.setItem('crm_user', JSON.stringify(user));
      localStorage.setItem('crm_login_time', Date.now().toString());
      
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
