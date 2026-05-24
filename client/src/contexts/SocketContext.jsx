import React, { createContext, useContext, useEffect, useState } from 'react';
import { io } from 'socket.io-client';
import { useAuth } from './AuthContext';

const SocketContext = createContext();

export const useSocket = () => useContext(SocketContext);

export const SocketProvider = ({ children }) => {
  const [socket, setSocket] = useState(null);
  const { isAuthenticated, user } = useAuth();

  useEffect(() => {
    if (isAuthenticated && user) {
      // Connect to socket when authenticated
      const newSocket = io(import.meta.env.VITE_SERVER_URL || 'http://localhost:3000', {
        auth: {
          token: localStorage.getItem('crm_token')
        }
      });

      newSocket.on('connect', () => {
        console.log('Connected to real-time server');
      });

      setSocket(newSocket);

      return () => {
        newSocket.disconnect();
      };
    } else if (socket) {
      // Disconnect when logged out
      socket.disconnect();
      setSocket(null);
    }
  }, [isAuthenticated, user]);

  return (
    <SocketContext.Provider value={{ socket }}>
      {children}
    </SocketContext.Provider>
  );
};
