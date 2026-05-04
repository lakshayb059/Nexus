import React, { useEffect, useState, useRef } from 'react';
import { useSocket } from '../contexts/SocketContext';
import { useAuth } from '../contexts/AuthContext';
import { Calendar, Clock, X, AlertTriangle } from 'lucide-react';

const MAX_TOASTS = 5;

// Sound URLs
const SOUNDS = {
  // A professional digital bell/ring
  upcoming: 'https://assets.mixkit.co/active_storage/sfx/2358/2358-preview.mp3',
  // A more urgent digital alert
  late: 'https://assets.mixkit.co/active_storage/sfx/951/951-preview.mp3',
  // A clean "ping" for immediate due
  callback: 'https://assets.mixkit.co/active_storage/sfx/2869/2869-preview.mp3'
};

const AppointmentNotifier = () => {
  const { socket } = useSocket();
  const { isAuthenticated, user } = useAuth();
  const [toasts, setToasts] = useState([]);
  const audioRef = useRef(new Audio());

  const playSound = (type) => {
    try {
      audioRef.current.src = SOUNDS[type] || SOUNDS.upcoming;
      audioRef.current.play().catch(err => console.log('Autoplay blocked or audio error:', err));
    } catch (err) {
      console.error('Sound play failed', err);
    }
  };

  const requestPermission = () => {
    if (Notification.permission === 'default') {
      Notification.requestPermission();
    }
  };

  useEffect(() => {
    requestPermission();
  }, []);

  const notifyBrowser = (title, message) => {
    if (Notification.permission === 'granted') {
      new Notification(title, { body: message });
    }
  };

  const add = (toast) => {
    setToasts(prev => [toast, ...prev].slice(0, MAX_TOASTS));
    playSound(toast.isLate ? 'late' : toast.type);
    notifyBrowser(toast.title, toast.message);
  };

  const remove = (id) =>
    setToasts(prev => prev.filter(t => t.id !== id));

  useEffect(() => {
    if (!socket || !isAuthenticated || !user) return;

    socket.on('appointment_reminder', (data) => {
      // Only notify the assigned agent
      if (data.agentId !== user._id) return;

      const isLate = data.type === 'late';
      add({
        id: Date.now(),
        type: 'appointment',
        isLate,
        title: isLate ? 'LATE APPOINTMENT' : 'Appointment Reminder',
        message: `${data.contactName} — ${isLate ? 'OVERDUE' : `in ${data.minutesUntil} min`}`,
        phone: data.contactPhone
      });
    });

    socket.on('callback_due', (data) => {
      if (data.agentId !== user._id) return;
      add({
        id: Date.now(),
        type: 'callback',
        title: 'Callback Due Now',
        message: data.contactName,
      });
    });

    socket.on('callback_reminder', (data) => {
      if (data.agentId !== user._id) return;
      add({
        id: Date.now(),
        type: 'callback',
        title: 'Callback Reminder',
        message: `${data.contactName} — in 2 min`,
      });
    });
    
    socket.on('requeue_notification', (data) => {
      if (data.agentId !== user._id) return;
      add({
        id: Date.now(),
        type: 'callback',
        title: 'Contact Re-queued',
        message: `${data.contactName} re-added by ${data.adminName}`,
      });
    });

    return () => {
      socket.off('appointment_reminder');
      socket.off('callback_due');
      socket.off('callback_reminder');
      socket.off('requeue_notification');
    };
  }, [socket, isAuthenticated, user]);

  useEffect(() => {
    if (toasts.length === 0) return;
    const oldest = toasts[toasts.length - 1];
    const timer = setTimeout(() => remove(oldest.id), 12000); // Slightly longer for late alerts
    return () => clearTimeout(timer);
  }, [toasts]);

  if (toasts.length === 0) return null;

  return (
    <div style={{
      position: 'fixed',
      top: 76,
      right: 20,
      zIndex: 3000,
      display: 'flex',
      flexDirection: 'column',
      gap: 10,
      maxWidth: 340,
      width: 'calc(100vw - 40px)',
    }}>
      {toasts.map((t) => (
        <div
          key={t.id}
          className={`glass-panel animate-fade-up ${t.isLate ? 'late-pulse' : ''}`}
          style={{
            padding: '14px 16px',
            display: 'flex',
            gap: 12,
            alignItems: 'flex-start',
            borderLeft: `4px solid ${t.isLate ? '#ef4444' : t.type === 'appointment' ? '#8b5cf6' : '#06b6d4'}`,
            background: t.isLate ? 'rgba(239, 68, 68, 0.1)' : 'var(--bg-surface)',
            boxShadow: t.isLate ? '0 8px 32px rgba(239, 68, 68, 0.25)' : 'var(--shadow-lg)',
          }}
        >
          <div style={{
            width: 34, height: 34,
            borderRadius: 'var(--r-sm)',
            background: t.isLate ? '#ef4444' : (t.type === 'appointment' ? 'var(--violet-light)' : 'var(--cyan-light)'),
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            flexShrink: 0,
            color: '#fff',
          }}>
            {t.isLate ? <AlertTriangle size={18} /> : (t.type === 'appointment' ? <Calendar size={16} /> : <Clock size={16} />)}
          </div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ 
              fontSize: '0.72rem', 
              fontWeight: 900, 
              textTransform: 'uppercase', 
              letterSpacing: '0.08em', 
              color: t.isLate ? '#ef4444' : (t.type === 'appointment' ? '#8b5cf6' : '#06b6d4'), 
              marginBottom: 4,
              display: 'flex',
              alignItems: 'center',
              gap: 6
            }}>
              {t.title} {t.isLate && <span className="badge badge-danger" style={{ fontSize: '0.6rem', padding: '2px 5px' }}>URGENT</span>}
            </div>
            <div style={{ fontSize: '0.9rem', fontWeight: 700, color: 'var(--text-primary)', marginBottom: 2 }}>
              {t.message}
            </div>
            {t.phone && <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>Phone: {t.phone}</div>}
          </div>
          <button
            onClick={() => remove(t.id)}
            style={{ background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', padding: 2, flexShrink: 0 }}
          >
            <X size={15} />
          </button>
        </div>
      ))}
      <style>{`
        @keyframes late-pulse {
          0% { transform: scale(1); }
          50% { transform: scale(1.02); }
          100% { transform: scale(1); }
        }
        .late-pulse {
          animation: late-pulse 1s infinite ease-in-out;
        }
      `}</style>
    </div>
  );
};

export default AppointmentNotifier;
