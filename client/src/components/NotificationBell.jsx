import React, { useState, useEffect, useRef } from 'react';
import { useSocket } from '../contexts/SocketContext';
import { useAuth } from '../contexts/AuthContext';
import { Bell, Calendar, Clock, Database, X, ChevronRight } from 'lucide-react';
import { useNavigate } from 'react-router-dom';

const NotificationBell = () => {
  const { socket } = useSocket();
  const { user } = useAuth();
  const navigate = useNavigate();
  const [notifications, setNotifications] = useState([]);
  const [isOpen, setIsOpen] = useState(false);
  const dropdownRef = useRef(null);

  const addNotification = (notif) => {
    setNotifications(prev => {
      // Avoid duplicate workflow notifications for same batch if needed
      if (notif.type === 'workflow' && prev.some(p => p.batchId === notif.batchId)) return prev;
      return [notif, ...prev].slice(0, 20); // Keep last 20
    });
  };

  useEffect(() => {
    if (!socket || !user) return;

    // 1. Appointment Reminders
    socket.on('appointment_reminder', (data) => {
      if (data.agentId === user._id) {
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

    // 2. Callback Reminders
    socket.on('callback_due', (data) => {
      if (data.agentId === user._id) {
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

    // 3. New Workflow Assigned
    socket.on('batch_uploaded', (data) => {
      // data.agentId can be the specific agent or "multi"
      // If multi, we don't know exactly from this event if THIS agent got contacts
      // But for specific assignments, it's clear
      if (data.agentId === user._id) {
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

  const handleNotifClick = (notif) => {
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
        className="btn btn-ghost btn-icon" 
        onClick={() => setIsOpen(!isOpen)}
        style={{ position: 'relative' }}
      >
        <Bell size={20} style={{ color: unreadCount > 0 ? 'var(--primary)' : 'var(--text-muted)' }} />
        {unreadCount > 0 && (
          <span style={{
            position: 'absolute',
            top: 6,
            right: 6,
            background: 'var(--danger)',
            color: '#fff',
            fontSize: '10px',
            fontWeight: 800,
            width: 16,
            height: 16,
            borderRadius: '50%',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            border: '2px solid #fff'
          }}>
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
                    background: n.type === 'appointment' ? 'var(--violet-light)' : n.type === 'callback' ? 'var(--cyan-light)' : 'rgba(37,99,235,0.1)',
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    flexShrink: 0,
                    color: n.type === 'appointment' ? '#8b5cf6' : n.type === 'callback' ? '#06b6d4' : 'var(--primary)',
                  }}>
                    {n.type === 'appointment' ? <Calendar size={14} /> : n.type === 'callback' ? <Clock size={14} /> : <Database size={14} />}
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
        .notif-item {
          padding: 12px 16px;
          display: flex;
          gap: 12px;
          align-items: center;
          cursor: pointer;
          transition: background 0.2s;
          border-bottom: 1px solid var(--border-light);
        }
        .notif-item:hover { background: var(--bg-surface-2); }
        .notif-item:last-child { border-bottom: none; }
      `}</style>
    </div>
  );
};

export default NotificationBell;
