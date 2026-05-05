import React, { useState } from 'react';
import { X, Check, Calendar, MessageSquare, CreditCard, RotateCw } from 'lucide-react';

const LeadStatusModal = ({ lead, newStatus, onClose, onSave, submitting }) => {
  const [formData, setFormData] = useState({
    transactionId: lead.transactionId || '',
    callBackDt: lead.callBackDt ? new Date(lead.callBackDt).toISOString().slice(0, 16) : '',
    statusDetails: lead.statusDetails || '',
  });

  const handleSubmit = (e) => {
    e.preventDefault();
    onSave(formData);
  };

  if (!lead || !newStatus) return null;

  const getTitle = () => {
    switch (newStatus) {
      case 'Converted': return 'Complete Conversion';
      case 'Call Back': return 'Schedule Callback';
      case 'Others': return 'Additional Details';
      default: return `Update Status: ${newStatus}`;
    }
  };

  const getIcon = () => {
    switch (newStatus) {
      case 'Converted': return <CreditCard className="text-success" size={24} />;
      case 'Call Back': return <Calendar className="text-cyan" size={24} />;
      case 'Others': return <MessageSquare className="text-primary" size={24} />;
      default: return <Check className="text-primary" size={24} />;
    }
  };

  return (
    <div className="status-modal-overlay animate-fade-in">
      <div className="status-modal-content animate-scale-up">
        <div className="status-modal-header">
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <div className="status-icon-wrapper">
              {getIcon()}
            </div>
            <div>
              <h3 style={{ margin: 0, fontSize: '1.25rem', fontWeight: 900 }}>{getTitle()}</h3>
              <p style={{ margin: 0, fontSize: '0.85rem', color: 'var(--text-muted)' }}>Updating {lead.fields?.Name || 'Lead'}</p>
            </div>
          </div>
          <button onClick={onClose} className="status-modal-close">
            <X size={20} />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="status-modal-body">
          {newStatus === 'Converted' && (
            <div className="input-group">
              <label htmlFor="modalTransactionId">Transaction ID / UTR *</label>
              <div style={{ position: 'relative' }}>
                <input 
                  id="modalTransactionId"
                  type="text" 
                  className="input-field" 
                  value={formData.transactionId} 
                  onChange={e => setFormData(p => ({ ...p, transactionId: e.target.value }))}
                  required
                  placeholder="Enter payment reference..."
                  autoFocus
                />
              </div>
            </div>
          )}

          {newStatus === 'Call Back' && (
            <div className="input-group">
              <label htmlFor="modalCallBackDt">Next Callback Date & Time *</label>
              <input 
                id="modalCallBackDt"
                type="datetime-local" 
                className="input-field" 
                value={formData.callBackDt} 
                onChange={e => setFormData(p => ({ ...p, callBackDt: e.target.value }))}
                required
                autoFocus
              />
            </div>
          )}

          {newStatus === 'Others' && (
            <div className="input-group">
              <label htmlFor="modalStatusDetails">Please specify details *</label>
              <textarea 
                id="modalStatusDetails"
                className="input-field" 
                rows="3"
                value={formData.statusDetails} 
                onChange={e => setFormData(p => ({ ...p, statusDetails: e.target.value }))}
                required
                placeholder="Enter additional information..."
                autoFocus
              />
            </div>
          )}

          <div className="status-modal-footer">
            <button type="button" onClick={onClose} className="btn btn-outline" disabled={submitting}>Cancel</button>
            <button type="submit" className="btn btn-primary" disabled={submitting}>
              {submitting ? <RotateCw className="animate-spin" size={18} /> : 'Save Changes'}
            </button>
          </div>
        </form>
      </div>

      <style>{`
        .status-modal-overlay {
          position: fixed;
          inset: 0;
          background: rgba(15, 23, 42, 0.75);
          backdrop-filter: blur(8px);
          display: flex;
          align-items: center;
          justify-content: center;
          z-index: 10000;
          padding: 20px;
        }
        .status-modal-content {
          background: var(--bg-surface);
          width: 100%;
          max-width: 450px;
          border-radius: 24px;
          box-shadow: 0 25px 50px -12px rgba(0, 0, 0, 0.5);
          border: 1px solid var(--border);
          overflow: hidden;
        }
        .status-modal-header {
          padding: 24px;
          border-bottom: 1px solid var(--border);
          display: flex;
          justify-content: space-between;
          align-items: center;
        }
        .status-icon-wrapper {
          width: 48px;
          height: 48px;
          border-radius: 14px;
          background: var(--bg-surface-2);
          display: flex;
          align-items: center;
          justify-content: center;
        }
        .status-modal-close {
          background: none;
          border: none;
          color: var(--text-muted);
          cursor: pointer;
          padding: 8px;
          border-radius: 10px;
          transition: all 0.2s;
        }
        .status-modal-close:hover {
          background: var(--bg-surface-2);
          color: var(--text-primary);
        }
        .status-modal-body {
          padding: 24px;
        }
        .status-modal-footer {
          margin-top: 24px;
          display: flex;
          gap: 12px;
          justify-content: flex-end;
        }
        .animate-scale-up {
          animation: scaleUp 0.3s cubic-bezier(0.34, 1.56, 0.64, 1);
        }
        @keyframes scaleUp {
          from { transform: scale(0.95); opacity: 0; }
          to { transform: scale(1); opacity: 1; }
        }
        .text-success { color: #10b981; }
        .text-cyan { color: #06b6d4; }
      `}</style>
    </div>
  );
};

export default LeadStatusModal;
