import React, { useState, useEffect, useRef } from 'react';
import { useSocket } from '../contexts/SocketContext';
import { useAuth } from '../contexts/AuthContext';
import { Bell, Calendar, Clock, Database, X, ChevronRight, Star } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import api from '../utils/api';

const NotificationBell = () => {
  const { socket } = useSocket();
  const { user } = useAuth();
  const navigate = useNavigate();
  const [notifications, setNotifications] = useState(() => {
    const saved = localStorage.getItem(`notifications_${user?._id}`);
    return saved ? JSON.parse(saved) : [];
  });
  const [isOpen, setIsOpen] = useState(false);
  const dropdownRef = useRef(null);

  useEffect(() => {
    if (user) {
      localStorage.setItem(`notifications_${user._id}`, JSON.stringify(notifications));
    }
  }, [notifications, user]);

  const addNotification = (notif) => {
    setNotifications(prev => {
      if (notif.type === 'workflow' && prev.some(p => p.batchId === notif.batchId)) return prev;
      return [notif, ...prev].slice(0, 20);
    });
  };

  useEffect(() => {
    if (user) {
      const sessionKey = `welcomed_${user._id}_${new Date().toDateString()}`;
      if (!sessionStorage.getItem(sessionKey)) {
        addNotification({
          id: `welcome_${Date.now()}`,
          type: 'welcome',
          title: 'Welcome Back!',
          message: `Hello ${user.name}, welcome to your dashboard.`,
          time: new Date(),
          path: '/dashboard'
        });
        sessionStorage.setItem(sessionKey, 'true');
      }
    }
  }, [user?._id]);

  const playSound = () => {
    try {
      const audio = new Audio('https://assets.mixkit.co/active_storage/sfx/2869/2869-preview.mp3');
      audio.play().catch(e => console.log('Sound blocked by browser policy'));
    } catch (e) {
      console.error('Audio playback failed', e);
    }
  };

  useEffect(() => {
    if (!socket || !user) return;

    socket.on('appointment_reminder', (data) => {
      if (data.agentId === user._id) {
        playSound();
        addNotification({
          id: `appt_${Date.now()}`,
          type: 'appointment',
          title: data.type === 'late' ? 'LATE APPOINTMENT' : 'Appointment Reminder',
          message: `${data.contactName} - ${data.type === 'late' ? 'OVERDUE' : `in ${data.minutesUntil} min`}`,
          time: new Date(),
          path: '/appointments'
        });
      }
    });

    socket.on('callback_due', (data) => {
      if (data.agentId === user._id) {
        // No sound for due - only for reminder
        addNotification({
          id: `cb_${Date.now()}`,
          type: 'callback',
          title: 'Callback Due Now',
          message: data.contactName,
          time: new Date(),
          path: '/callbacks'
        });
      }
    });

    socket.on('callback_reminder', (data) => {
      if (data.agentId === user._id) {
        playSound();
        addNotification({
          id: `cbr_${Date.now()}`,
          type: 'callback',
          title: 'Callback in 2 min',
          message: `${data.contactName} - Prepare for call`,
          time: new Date(),
          path: '/callbacks'
        });
      }
    });

    socket.on('requeue_notification', (data) => {
      if (data.agentId === user._id) {
        // No sound for requeue
        addNotification({
          id: `rq_${Date.now()}`,
          type: 'callback',
          title: 'Contact Re-queued',
          message: `${data.contactName} re-added by ${data.adminName}`,
          time: new Date(),
          path: '/workflow'
        });
      }
    });

    socket.on('batch_uploaded', (data) => {
      if (data.agentId === user._id) {
        // No sound for batch
        addNotification({
          id: `wf_${Date.now()}`,
          type: 'workflow',
          batchId: data.batchId,
          title: 'New Data Assigned',
          message: `${data.totalUploaded} new contacts added to your workflow`,
          time: new Date(),
          path: '/workflow'
        });
      }
    });

    return () => {
      socket.off('appointment_reminder');
      socket.off('callback_due');
      socket.off('callback_reminder');
      socket.off('requeue_notification');
      socket.off('batch_uploaded');
    };
  }, [socket, user]);

  // Close dropdown on click outside
  useEffect(() => {
    const handleClickOutside = (e) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target)) {
        setIsOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const unreadCount = notifications.length;

  const handleNotifClick = async (notif) => {
    if (notif.path) navigate(notif.path);



    setNotifications(prev => prev.filter(n => n.id !== notif.id));
    setIsOpen(false);
  };

  const clearAll = () => {
    setNotifications([]);
    setIsOpen(false);
  };

  return (
    <div style={{ position: 'relative' }} ref={dropdownRef}>
      <button
        className="btn btn-ghost btn-icon bell-btn-responsive"
        onClick={() => setIsOpen(!isOpen)}
        style={{ position: 'relative' }}
      >
        <Bell className="bell-icon-responsive" style={{ color: unreadCount > 0 ? 'var(--primary)' : 'var(--text-muted)' }} />
        {unreadCount > 0 && (
          <span className="bell-badge-responsive">
            {unreadCount}
          </span>
        )}
      </button>

      {isOpen && (
        <div className="glass-panel notification-dropdown animate-fade-down" style={{
          position: 'absolute',
          top: '100%',
          right: 0,
          marginTop: 10,
          width: 320,
          maxHeight: 400,
          overflowY: 'auto',
          zIndex: 2000,
          padding: 0,
          boxShadow: 'var(--shadow-xl)'
        }}>
          <div style={{
            padding: '12px 16px',
            borderBottom: '1px solid var(--border)',
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            background: 'var(--bg-surface-2)'
          }}>
            <h3 style={{ fontSize: '0.85rem', fontWeight: 800 }}>Notifications</h3>
            {unreadCount > 0 && (
              <button onClick={clearAll} style={{ fontSize: '0.7rem', color: 'var(--primary)', fontWeight: 700, background: 'none', border: 'none', cursor: 'pointer' }}>
                Clear All
              </button>
            )}
          </div>

          {notifications.length === 0 ? (
            <div style={{ padding: '40px 20px', textAlign: 'center', color: 'var(--text-muted)' }}>
              <Bell size={32} style={{ opacity: 0.1, marginBottom: 12 }} />
              <div style={{ fontSize: '0.8rem' }}>No new notifications</div>
            </div>
          ) : (
            <div>
              {notifications.map(n => (
                <div
                  key={n.id}
                  className="notif-item"
                  onClick={() => handleNotifClick(n)}
                >
                  <div style={{
                    width: 32, height: 32,
                    borderRadius: 'var(--r-sm)',
                    background: n.type === 'appointment' ? 'var(--violet-light)' : n.type === 'callback' ? 'var(--cyan-light)' : n.type === 'welcome' ? 'var(--success-light)' : 'rgba(37,99,235,0.1)',
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    flexShrink: 0,
                    color: n.type === 'appointment' ? '#8b5cf6' : n.type === 'callback' ? '#06b6d4' : n.type === 'welcome' ? 'var(--success)' : 'var(--primary)',
                  }}>
                    {n.type === 'appointment' ? <Calendar size={14} /> : n.type === 'callback' ? <Clock size={14} /> : n.type === 'welcome' ? <Star size={14} /> : <Database size={14} />}
                  </div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: '0.75rem', fontWeight: 800, color: 'var(--text-primary)', marginBottom: 2 }}>{n.title}</div>
                    <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{n.message}</div>
                    <div style={{ fontSize: '0.6rem', color: 'var(--text-muted)', marginTop: 4 }}>
                      {new Date(n.time).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                    </div>
                  </div>
                  <ChevronRight size={14} style={{ color: 'var(--border)', flexShrink: 0 }} />
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      <style>{`
        .notification-dropdown {
          border: 1px solid var(--border);
          border-radius: var(--r-lg);
          background: #fff;
        }
        .notif-item:last-child { border-bottom: none; }

        .bell-icon-responsive { width: 20px; height: 20px; }
        .bell-badge-responsive {
          position: absolute;
          top: 6px; right: 6px;
          background: var(--danger);
          color: #fff;
          font-size: 10px;
          fontWeight: 800;
          width: 16px; height: 16px;
          border-radius: 50%;
          display: flex; alignItems: center; justify-content: center;
          border: 2px solid #fff;
        }

        @media (max-width: 640px) {
          .bell-btn-responsive { width: 44px!important; height: 44px!important; }
          .bell-icon-responsive { width: 32px!important; height: 32px!important; }
          .bell-badge-responsive {
            top: 4px; right: 4px;
            font-size: 11px;
            width: 19px; height: 19px;
            border-width: 2.5px;
            box-shadow: var(--shadow-md);
            z-index: 10;
          }
        }
      `}</style>
    </div>
  );
};

export default NotificationBell;
