import React, { createContext, useContext, useEffect, useState, useRef, useCallback } from 'react';
import { AppState } from 'react-native';
import { io } from 'socket.io-client';
import { useAuth } from './AuthContext';
import { getAccessToken, getServerUrl, rotateMobileTokens } from '../services/api';

const SocketContext = createContext();

export const useSocket = () => useContext(SocketContext);

export const SocketProvider = ({ children }) => {
  const [socket, setSocket] = useState(null);
  const [connected, setConnected] = useState(false);
  const [connecting, setConnecting] = useState(false);
  const [lastSyncAt, setLastSyncAt] = useState(null);
  const { isAuthenticated, user, serverUrl } = useAuth();
  const socketRef = useRef(null);
  const retryingAuthRef = useRef(false);

  const userId = user?._id || user?.id;

  const reconnect = useCallback(async () => {
    const sock = socketRef.current;
    if (!sock) return;
    setConnecting(true);
    if (!getAccessToken()) {
      try {
        await rotateMobileTokens();
      } catch {
        // Ignore if session ended
      }
    }
    if (sock.disconnected) {
      sock.connect();
    }
  }, []);

  useEffect(() => {
    if (isAuthenticated && userId) {
      const targetUrl = serverUrl || getServerUrl();
      setConnecting(true);

      const newSocket = io(targetUrl, {
        transports: ['polling', 'websocket'],
        upgrade: true,
        forceNew: true,
        reconnection: true,
        reconnectionAttempts: Infinity,
        reconnectionDelay: 1500,
        reconnectionDelayMax: 8000,
        timeout: 20000,
        auth: { token: getAccessToken() || '' },
      });

      socketRef.current = newSocket;

      newSocket.on('connect', () => {
        setConnected(true);
        setConnecting(false);
        setLastSyncAt(new Date().toISOString());
      });

      newSocket.on('disconnect', () => {
        setConnected(false);
      });

      newSocket.on('connect_error', async (err) => {
        setConnected(false);
        const latestToken = getAccessToken();
        if (latestToken) {
          newSocket.auth = { token: latestToken };
        }
        const msg = String(err?.message || '').toLowerCase();
        if (
          (msg.includes('token') || msg.includes('auth')) &&
          !retryingAuthRef.current
        ) {
          retryingAuthRef.current = true;
          try {
            await rotateMobileTokens();
            const refreshedToken = getAccessToken();
            if (refreshedToken) {
              newSocket.auth = { token: refreshedToken };
            }
            setTimeout(() => {
              if (socketRef.current && socketRef.current.disconnected) {
                socketRef.current.connect();
              }
            }, 300);
          } catch {
            // Token rotation failed; AuthContext handles logout on next API call
          } finally {
            setTimeout(() => {
              retryingAuthRef.current = false;
            }, 2500);
          }
        }
      });

      const syncEvents = [
        'contact_disposed',
        'lead_disposed',
        'lead_created',
        'lead_updated',
        'contacts_updated',
        'dashboard_update',
        'users_updated',
        'agent_status_changed',
        'batch_uploaded',
      ];
      const markSync = () => setLastSyncAt(new Date().toISOString());
      syncEvents.forEach((ev) => newSocket.on(ev, markSync));

      setSocket(newSocket);

      const appSub = AppState.addEventListener('change', (state) => {
        if (state === 'active' && socketRef.current && socketRef.current.disconnected) {
          socketRef.current.connect();
        }
      });

      return () => {
        appSub.remove();
        syncEvents.forEach((ev) => newSocket.off(ev, markSync));
        newSocket.disconnect();
        socketRef.current = null;
        setSocket(null);
        setConnected(false);
        setConnecting(false);
      };
    } else if (socketRef.current) {
      socketRef.current.disconnect();
      socketRef.current = null;
      setSocket(null);
      setConnected(false);
      setConnecting(false);
    }
  }, [isAuthenticated, userId, serverUrl]);

  return (
    <SocketContext.Provider value={{ socket, connected, connecting, lastSyncAt, reconnect }}>
      {children}
    </SocketContext.Provider>
  );
};
