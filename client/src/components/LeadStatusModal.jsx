import React, { useState, useEffect } from 'react';
import { X, Check, Calendar, MessageSquare, CreditCard, RotateCw } from 'lucide-react';

const LeadStatusModal = ({ lead, newStatus, onClose, onSave, submitting }) => {
  const [formData, setFormData] = useState({
    transactionId: lead.transactionId || '',
    callBackDt: lead.callBackDt ? new Date(lead.callBackDt).toISOString().slice(0, 16) : '',
    statusDetails: lead.statusDetails || '',
    remarks: lead.remarks || '',
  });

  useEffect(() => {
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = '';
    };
  }, []);

  const handleSubmit = (e) => {
    e.preventDefault();
    let payload = { ...formData };
    if (payload.callBackDt) {
      payload.callBackDt = new Date(payload.callBackDt).toISOString();
    }
    onSave(payload);
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
    <div className="detail-modal-overlay animate-fade-in">
      <div className="detail-modal-content animate-scale-up">
        <div className="detail-modal-header">
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <div className="status-icon-wrapper">
              {getIcon()}
            </div>
            <div>
              <h3 style={{ margin: 0, fontSize: '1.25rem', fontWeight: 900 }}>{getTitle()}</h3>
              <p style={{ margin: 0, fontSize: '0.85rem', color: 'var(--text-muted)' }}>Updating {lead.fields?.Name || 'Lead'}</p>
            </div>
          </div>
          <button onClick={onClose} className="detail-modal-close">
            <X size={20} />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="detail-modal-body">
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
            <>
              <div className="input-group">
                <label htmlFor="modalCallBackDt">Next Callback Date & Time *</label>
                <input 
                  id="modalCallBackDt"
                  type="datetime-local" 
                  className="input-field" 
                  value={formData.callBackDt} 
                  min={new Date(new Date().getTime() - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 16)}
                  onChange={e => setFormData(p => ({ ...p, callBackDt: e.target.value }))}
                  required
                  autoFocus
                />
              </div>
              <div className="input-group">
                <label htmlFor="modalRemarks">Remarks / Notes *</label>
                <textarea 
                  id="modalRemarks"
                  className="input-field" 
                  rows="3"
                  value={formData.remarks} 
                  onChange={e => setFormData(p => ({ ...p, remarks: e.target.value }))}
                  required
                  placeholder="Enter followup notes..."
                />
              </div>
            </>
          )}

          {newStatus === 'Others' && (
            <div className="input-group">
              <label htmlFor="modalRemarks">Remarks / Details *</label>
              <textarea 
                id="modalRemarks"
                className="input-field" 
                rows="3"
                value={formData.remarks} 
                onChange={e => setFormData(p => ({ ...p, remarks: e.target.value }))}
                required
                placeholder="Enter details or remarks..."
                autoFocus
              />
            </div>
          )}

          <div className="detail-modal-footer">
            <button type="button" onClick={onClose} className="btn btn-outline" disabled={submitting}>Cancel</button>
            <button type="submit" className="btn btn-primary" disabled={submitting}>
              {submitting ? <RotateCw className="animate-spin" size={18} /> : 'Save Changes'}
            </button>
          </div>
        </form>
      </div>

      <style>{`
        .detail-modal-overlay {
          position: fixed;
          inset: 0;
          background: rgba(15, 23, 42, 0.85);
          backdrop-filter: blur(12px);
          display: flex;
          align-items: flex-start;
          justify-content: center;
          z-index: 99999; /* Extremely high to beat any other modal */
          padding: 40px 16px;
          overflow-y: auto;
        }
        .detail-modal-content {
          background: var(--bg-surface);
          width: 100%;
          max-width: 450px;
          border-radius: 24px;
          box-shadow: 0 40px 100px -12px rgba(0, 0, 0, 0.6);
          border: 1px solid var(--border);
          margin: 0 auto;
        }
        .detail-modal-header {
          padding: 24px;
          border-bottom: 1px solid var(--border);
          display: flex;
          justify-content: space-between;
          align-items: center;
        }
        .detail-modal-close {
          background: none;
          border: none;
          color: var(--text-muted);
          cursor: pointer;
          padding: 8px;
          border-radius: 10px;
          transition: all 0.2s;
        }
        .detail-modal-close:hover {
          background: var(--bg-surface-2);
          color: var(--text-primary);
        }
        .detail-modal-body {
          padding: 24px;
        }
        .detail-modal-footer {
          margin-top: 24px;
          display: flex;
          gap: 12px;
          justify-content: flex-end;
        }
      `}</style>
    </div>
  );
};

export default LeadStatusModal;
