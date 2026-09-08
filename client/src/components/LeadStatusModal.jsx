import React, { useState, useRef } from 'react';
import { createPortal } from 'react-dom';
import { X, Check, Calendar, MessageSquare, CreditCard, RotateCw, XCircle, ShieldAlert, UploadCloud, CheckCircle2, AlertCircle, Loader2 } from 'lucide-react';
import api from '../utils/api';

const LeadStatusModal = ({ lead, newStatus, onClose, onSave, submitting }) => {
  const [formData, setFormData] = useState({
    leadAmount: lead?.leadAmount || '',
    transactionId: lead?.transactionId || '',
    callBackDt: (() => {
      try {
        if (!lead?.callBackDt) return '';
        const d = new Date(lead.callBackDt);
        return isNaN(d.getTime()) ? '' : d.toISOString().slice(0, 16);
      } catch (e) {
        return '';
      }
    })(),
    statusDetails: lead?.statusDetails || '',
    remarks: '',
  });

  const [receiptImage, setReceiptImage] = useState('');
  const [receiptName, setReceiptName] = useState('');
  const [scanning, setScanning] = useState(false);
  const [scanStatus, setScanStatus] = useState(null); // 'success' | 'failed' | null
  const [scanMessage, setScanMessage] = useState('');
  const fileInputRef = useRef(null);

  if (!lead || !newStatus) return null;

  const handleFileChange = (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    processImageFile(file);
  };

  const handleDrop = (e) => {
    e.preventDefault();
    const file = e.dataTransfer.files?.[0];
    if (file) processImageFile(file);
  };

  const processImageFile = (file) => {
    if (!file.type.startsWith('image/')) {
      alert('Please select an image file (PNG, JPG, or JPEG).');
      return;
    }
    setReceiptName(file.name);
    const reader = new FileReader();
    reader.onloadend = async () => {
      const base64 = reader.result;
      setReceiptImage(base64);
      runOcrExtraction(base64);
    };
    reader.readAsDataURL(file);
  };

  const runOcrExtraction = async (base64) => {
    setScanning(true);
    setScanStatus(null);
    setScanMessage('');
    try {
      const res = await api.post('/leads/extract-transaction', { imageBase64: base64 });
      if (res.data.success && res.data.transactionId && res.data.transactionId !== 'NOT_FOUND') {
        const txId = res.data.transactionId;
        const amount = res.data.amount;
        setFormData(prev => ({
          ...prev,
          transactionId: txId,
          leadAmount: amount || prev.leadAmount,
          remarks: prev.remarks || `[Auto-converted via receipt scan] Transaction ID: ${txId}${amount ? ` (Amount: ₹${amount})` : ''}`
        }));
        setScanStatus('success');
        setScanMessage(`Transaction ID detected: ${txId}${amount ? ` | Amount: ₹${amount}` : ''}`);
      } else {
        setScanStatus('failed');
        setScanMessage('Could not detect Transaction ID automatically. Please verify and fill in details manually.');
      }
    } catch (err) {
      console.warn('OCR extraction error:', err);
      setScanStatus('failed');
      setScanMessage('AI scanning unavailable. Please verify and enter Amount and Transaction ID manually.');
    } finally {
      setScanning(false);
    }
  };

  const handleSubmit = (e) => {
    e.preventDefault();
    let payload = { ...formData };
    if (payload.callBackDt) {
      try {
        const d = new Date(payload.callBackDt);
        payload.callBackDt = isNaN(d.getTime()) ? new Date().toISOString() : d.toISOString();
      } catch (e) {
        payload.callBackDt = new Date().toISOString();
      }
    }
    if (payload.leadAmount) {
      payload.leadAmount = parseFloat(payload.leadAmount) || 0;
    }
    if (receiptImage) {
      payload.receiptImage = receiptImage;
    }
    onSave(payload);
  };

  const getTitle = () => {
    switch (newStatus) {
      case 'Converted': return 'Mark as Converted';
      case 'Call Back': return 'Schedule Callback';
      case 'Not Interested': return 'Mark as Not Interested';
      case 'DNC/DND': return 'Mark as DNC / DND';
      case 'Others': return 'Set Status: Others';
      default: return `Update Status to ${newStatus}`;
    }
  };

  const getIcon = () => {
    switch (newStatus) {
      case 'Converted': return <CreditCard className="text-success" size={24} color="#10b981" />;
      case 'Call Back': return <Calendar className="text-cyan" size={24} color="#06b6d4" />;
      case 'Not Interested': return <XCircle size={24} color="#ef4444" />;
      case 'DNC/DND': return <ShieldAlert size={24} color="#f59e0b" />;
      case 'Others': return <MessageSquare className="text-primary" size={24} color="#6366f1" />;
      default: return <Check className="text-primary" size={24} color="#6366f1" />;
    }
  };

  const leadName = lead.fields?.Name || lead.fields?.name || lead.fields?.['Full Name'] || lead.name || 'Lead';

  return createPortal(
    <div className="detail-modal-overlay animate-fade-in" onClick={onClose}>
      <div className="detail-modal-content animate-scale-up" onClick={e => e.stopPropagation()}>
        <div className="detail-modal-header">
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <div className="status-icon-wrapper" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', width: 44, height: 44, borderRadius: 12, background: 'var(--bg-surface-2)' }}>
              {getIcon()}
            </div>
            <div>
              <h3 style={{ margin: 0, fontSize: '1.15rem', fontWeight: 800 }}>{getTitle()}</h3>
              <p style={{ margin: 0, fontSize: '0.8rem', color: 'var(--text-muted)' }}>Updating {leadName}</p>
            </div>
          </div>
          <button onClick={onClose} className="detail-modal-close" type="button">
            <X size={20} />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="detail-modal-body">
          {newStatus === 'Converted' && (
            <>
              {/* Optional Receipt Image Upload */}
              <div style={{ marginBottom: 14 }}>
                <label style={{ fontSize: '0.8rem', fontWeight: 700, marginBottom: 6, display: 'block' }}>
                  Payment Receipt / Screenshot (Optional)
                </label>
                <input 
                  type="file" 
                  ref={fileInputRef} 
                  style={{ position: 'fixed', top: -1000, left: -1000, opacity: 0, width: 0, height: 0, pointerEvents: 'none' }} 
                  accept="image/*" 
                  onChange={handleFileChange} 
                  onClick={e => e.stopPropagation()}
                />

                {!receiptImage ? (
                  <div 
                    onClick={() => fileInputRef.current?.click()}
                    onDragOver={e => { e.preventDefault(); e.stopPropagation(); }}
                    onDrop={handleDrop}
                    style={{
                      border: '2px dashed var(--border)',
                      borderRadius: 14,
                      padding: '20px 14px',
                      textAlign: 'center',
                      cursor: 'pointer',
                      background: 'var(--bg-surface-2)',
                      transition: 'all 0.2s ease'
                    }}
                  >
                    <UploadCloud size={30} color="var(--primary)" style={{ margin: '0 auto 8px', display: 'block', opacity: 0.8 }} />
                    <div style={{ fontSize: '0.82rem', fontWeight: 700, color: 'var(--text-primary)' }}>
                      Click or drag payment receipt to scan
                    </div>
                    <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)', marginTop: 2 }}>
                      Auto-extracts UTR & Amount using AI OCR
                    </div>
                  </div>
                ) : (
                  <div style={{ display: 'flex', gap: 12, alignItems: 'center', background: 'var(--bg-surface-2)', padding: 10, borderRadius: 12, border: '1px solid var(--border)' }}>
                    <img 
                      src={receiptImage} 
                      alt="Receipt Preview" 
                      style={{ width: 56, height: 56, objectFit: 'cover', borderRadius: 8, border: '1px solid var(--border)' }} 
                    />
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: '0.82rem', fontWeight: 700, color: 'var(--text-primary)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                        {receiptName || 'Receipt Image'}
                      </div>
                      <div style={{ display: 'flex', gap: 10, marginTop: 4 }}>
                        <button 
                          type="button" 
                          onClick={() => fileInputRef.current?.click()} 
                          style={{ fontSize: '0.72rem', color: 'var(--primary)', fontWeight: 600, background: 'none', border: 'none', padding: 0, cursor: 'pointer' }}
                        >
                          Change
                        </button>
                        <button 
                          type="button" 
                          onClick={() => { setReceiptImage(''); setReceiptName(''); setScanStatus(null); }} 
                          style={{ fontSize: '0.72rem', color: 'var(--danger)', fontWeight: 600, background: 'none', border: 'none', padding: 0, cursor: 'pointer' }}
                        >
                          Remove
                        </button>
                      </div>
                    </div>
                  </div>
                )}
              </div>

              {/* AI Scan Feedback */}
              {scanning && (
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, background: 'rgba(99, 102, 241, 0.1)', color: 'var(--primary)', padding: '8px 12px', borderRadius: 8, fontSize: '0.78rem', fontWeight: 600, marginBottom: 14 }}>
                  <Loader2 size={15} className="animate-spin" />
                  <span>AI scanning receipt for transaction details...</span>
                </div>
              )}

              {scanStatus === 'success' && (
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, background: 'rgba(16, 185, 129, 0.1)', color: '#10b981', padding: '8px 12px', borderRadius: 8, fontSize: '0.78rem', fontWeight: 600, marginBottom: 14 }}>
                  <CheckCircle2 size={15} />
                  <span>{scanMessage}</span>
                </div>
              )}

              {scanStatus === 'failed' && (
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, background: 'rgba(245, 158, 11, 0.1)', color: '#f59e0b', padding: '8px 12px', borderRadius: 8, fontSize: '0.78rem', fontWeight: 600, marginBottom: 14 }}>
                  <AlertCircle size={15} />
                  <span>{scanMessage}</span>
                </div>
              )}

              <div className="input-group" style={{ marginBottom: 14 }}>
                <label htmlFor="modalAmount" style={{ fontSize: '0.8rem', fontWeight: 700, marginBottom: 4, display: 'block' }}>Conversion Amount (₹)</label>
                <input 
                  id="modalAmount"
                  type="number" 
                  step="any"
                  className="input-field" 
                  value={formData.leadAmount} 
                  onChange={e => setFormData(p => ({ ...p, leadAmount: e.target.value }))}
                  placeholder="e.g. 3000"
                  style={{ marginBottom: 0 }}
                />
              </div>
              <div className="input-group" style={{ marginBottom: 14 }}>
                <label htmlFor="modalTransactionId" style={{ fontSize: '0.8rem', fontWeight: 700, marginBottom: 4, display: 'block' }}>Transaction ID / UTR *</label>
                <input 
                  id="modalTransactionId"
                  type="text" 
                  className="input-field" 
                  value={formData.transactionId} 
                  onChange={e => setFormData(p => ({ ...p, transactionId: e.target.value }))}
                  required
                  placeholder="Enter payment reference ID / UTR..."
                  autoFocus
                  style={{ marginBottom: 0 }}
                />
              </div>
            </>
          )}

          {newStatus === 'Call Back' && (
            <div className="input-group" style={{ marginBottom: 14 }}>
              <label htmlFor="modalCallBackDt" style={{ fontSize: '0.8rem', fontWeight: 700, marginBottom: 4, display: 'block' }}>Next Callback Date & Time *</label>
              <input 
                id="modalCallBackDt"
                type="datetime-local" 
                className="input-field" 
                value={formData.callBackDt} 
                min={new Date(new Date().getTime() - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 16)}
                onChange={e => setFormData(p => ({ ...p, callBackDt: e.target.value }))}
                required
                autoFocus
                style={{ marginBottom: 0 }}
              />
            </div>
          )}

          <div className="input-group" style={{ marginBottom: 0 }}>
            <label htmlFor="modalRemarks" style={{ fontSize: '0.8rem', fontWeight: 700, marginBottom: 4, display: 'block' }}>
              {newStatus === 'Not Interested' || newStatus === 'DNC/DND' ? 'Reason / Remarks *' : 'Remarks / Notes *'}
            </label>
            <textarea 
              id="modalRemarks"
              className="input-field" 
              rows="3"
              value={formData.remarks} 
              onChange={e => setFormData(p => ({ ...p, remarks: e.target.value }))}
              required
              placeholder={
                newStatus === 'Not Interested' ? 'Why is the customer not interested? (e.g. Financial issue, high price, etc.)' :
                newStatus === 'DNC/DND' ? 'Enter DNC / Do Not Call reason...' :
                newStatus === 'Call Back' ? 'Notes for next follow-up call...' :
                'Enter detailed remarks regarding this lead...'
              }
              autoFocus={newStatus !== 'Converted' && newStatus !== 'Call Back'}
              style={{ marginBottom: 0, resize: 'vertical' }}
            />
          </div>

          <div className="detail-modal-footer">
            <button type="button" onClick={onClose} className="btn btn-outline" disabled={submitting}>Cancel</button>
            <button type="submit" className="btn btn-primary" disabled={submitting || scanning}>
              {submitting ? <RotateCw className="animate-spin" size={18} /> : 'Save Status & Remarks'}
            </button>
          </div>
        </form>
      </div>

      <style>{`
        .detail-modal-overlay {
          position: fixed;
          top: 0;
          left: 0;
          right: 0;
          bottom: 0;
          width: 100vw;
          height: 100vh;
          background: rgba(15, 23, 42, 0.75);
          backdrop-filter: blur(8px);
          display: flex;
          align-items: center;
          justify-content: center;
          z-index: 1000000;
          padding: 20px 16px;
          overflow-y: auto;
          box-sizing: border-box;
        }
        .detail-modal-content {
          background: var(--bg-surface);
          width: 100%;
          max-width: 480px;
          border-radius: 20px;
          box-shadow: 0 30px 90px -10px rgba(0, 0, 0, 0.5);
          border: 1px solid var(--border);
          margin: auto;
          max-height: calc(100vh - 40px);
          overflow-y: auto;
        }
        .detail-modal-header {
          padding: 20px 24px;
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
          padding: 6px;
          border-radius: 8px;
          transition: all 0.2s;
        }
        .detail-modal-close:hover {
          background: var(--bg-surface-2);
          color: var(--text-primary);
        }
        .detail-modal-body {
          padding: 20px 24px;
        }
        .detail-modal-footer {
          margin-top: 20px;
          display: flex;
          gap: 10px;
          justify-content: flex-end;
        }
      `}</style>
    </div>,
    document.body
  );
};

export default LeadStatusModal;
