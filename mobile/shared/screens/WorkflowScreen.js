import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
  View,
  Text,
  ScrollView,
  TextInput,
  TouchableOpacity,
  Alert,
  RefreshControl,
  ActivityIndicator,
  Image,
  StyleSheet,
} from 'react-native';
import * as Clipboard from 'expo-clipboard';
import { LinearGradient } from 'expo-linear-gradient';
import { useAuth } from '../contexts/AuthContext';
import { useSocket } from '../contexts/SocketContext';
import api from '../services/api';
import { COLORS, GRADIENTS, DISPOSITIONS, LEAD_STATUS_OPTIONS } from '../theme';
import {
  GlassCard,
  GradientButton,
  Badge,
  getContactName,
  getContactPhone,
  openDialer,
  openWhatsApp,
  formatDateTime,
  formatDateOnly,
  formatCurrency,
} from '../components/UI';
import DateTimeField from '../components/DateTimeField';
import { pickAndExtractReceipt } from '../components/ReceiptModals';
import {
  PhoneCall,
  MessageCircle,
  RotateCw,
  Camera,
  Image as ImageIcon,
  CheckCircle2,
  TrendingUp,
  Clock,
  Calendar,
  AlertCircle,
  Copy,
  Check,
  Sparkles,
  ArrowRight,
  RefreshCw,
} from 'lucide-react-native';

function getEntryMeta(label = '') {
  const norm = label.toLowerCase();
  if (norm.includes('lead') || norm.includes('convert')) return { color: '#10b981', bg: 'rgba(16,185,129,0.12)' };
  if (norm.includes('appointment')) return { color: '#8b5cf6', bg: 'rgba(139,92,246,0.12)' };
  if (norm.includes('not answered')) return { color: '#f59e0b', bg: 'rgba(245,158,11,0.12)' };
  if (norm.includes('hung up')) return { color: '#f43f5e', bg: 'rgba(244,63,94,0.12)' };
  if (norm.includes('invalid') || norm.includes('wrong')) return { color: '#ef4444', bg: 'rgba(239,68,68,0.12)' };
  if (norm.includes('do not call') || norm.includes('dnc')) return { color: '#b91c1c', bg: 'rgba(185,28,28,0.12)' };
  if (norm.includes('not interested')) return { color: '#ef4444', bg: 'rgba(239,68,68,0.12)' };
  if (norm.includes('language barrier')) return { color: '#3b82f6', bg: 'rgba(59,130,246,0.12)' };
  if (norm.includes('call back') || norm.includes('callback')) return { color: '#06b6d4', bg: 'rgba(6,182,212,0.12)' };
  if (norm.includes('requeued')) return { color: '#3b82f6', bg: 'rgba(59,130,246,0.12)' };
  return { color: COLORS.primary, bg: COLORS.primaryLight };
}

function getDeduplicated(contacts, type, dateField) {
  const map = new Map();
  (contacts || [])
    .filter((c) => c.disposition === type)
    .forEach((c) => {
      const phone = getContactPhone(c.fields) || c._id || c.id;
      const existing = map.get(phone);
      if (!existing || new Date(c[dateField]) < new Date(existing[dateField])) {
        map.set(phone, c);
      }
    });
  return Array.from(map.values());
}

const INITIAL_FORM = {
  disposition: '',
  remarks: '',
  appointmentDt: '',
  callBackDt: '',
  leadAmount: '',
  status: '',
  statusDetails: '',
  transactionId: '',
  receiptImage: '',
};

const WorkflowScreen = ({ targetContactId, onClearTargetContact }) => {
  const { user, recordActivity } = useAuth();
  const { socket } = useSocket();

  const [queueData, setQueueData] = useState(null);
  const queueRef = useRef(queueData);
  queueRef.current = queueData;

  const [customer360, setCustomer360] = useState(null);
  const [loading360, setLoading360] = useState(false);
  const [emptySchedule, setEmptySchedule] = useState([]);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [requeuingId, setRequeuingId] = useState(null);
  const [scanningReceipt, setScanningReceipt] = useState(false);
  const [copiedKey, setCopiedKey] = useState(null);
  const [toast, setToast] = useState(null);
  const [form, setForm] = useState(INITIAL_FORM);

  const showToast = (message, type = 'success') => {
    setToast({ message, type });
    setTimeout(() => setToast(null), 4500);
  };

  const resetForm = () => setForm(INITIAL_FORM);

  const fetchCustomer360 = async (phone) => {
    try {
      setLoading360(true);
      const res = await api.get(`/contacts/customer-360/${encodeURIComponent(phone)}`);
      setCustomer360(res.data);
    } catch {
      setCustomer360(null);
    } finally {
      setLoading360(false);
    }
  };

  const fetchNext = useCallback(async (explicitContactId) => {
    setLoading(true);
    try {
      const cid = explicitContactId || targetContactId;
      const url = cid ? `/contacts/queue?contactId=${cid}` : '/contacts/queue';
      const res = await api.get(url);
      setQueueData(res.data);

      if (res.data?.contact) {
        const phone = getContactPhone(res.data.contact.fields);
        if (phone) {
          fetchCustomer360(phone);
        } else {
          setCustomer360(null);
        }
        setEmptySchedule([]);
      } else {
        setCustomer360(null);
        const [appts, cbs] = await Promise.all([
          api.get('/contacts?disposition=Appointment'),
          api.get('/contacts?disposition=CallBack'),
        ]);
        const merged = [
          ...(Array.isArray(appts.data) ? appts.data : appts.data?.contacts || []),
          ...(Array.isArray(cbs.data) ? cbs.data : cbs.data?.contacts || []),
        ];
        setEmptySchedule(merged);
      }
    } catch {
      Alert.alert('Queue Error', 'Unable to fetch next contact from queue.');
    } finally {
      setLoading(false);
    }
  }, [targetContactId]);

  useEffect(() => {
    fetchNext();
  }, [fetchNext]);

  useEffect(() => {
    if (!socket) return;
    const uid = user?._id || user?.id;

    const onRefresh = (evt) => {
      const activeId = queueRef.current?.contact?._id || queueRef.current?.contact?.id;
      if (activeId) {
        if (evt?.contactId && evt.contactId === activeId) fetchNext();
        return;
      }
      fetchNext();
    };

    const onEmailStatus = (data) => {
      if (data && data.agentId === uid) {
        if (data.success) showToast('Receipt email sent successfully!', 'success');
        else showToast(`Email sending failed: ${data.reason}`, 'error');
      }
    };

    socket.on('contacts_updated', onRefresh);
    socket.on('batch_uploaded', onRefresh);
    socket.on('contact_disposed', onRefresh);
    socket.on('email_status', onEmailStatus);
    return () => {
      socket.off('contacts_updated', onRefresh);
      socket.off('batch_uploaded', onRefresh);
      socket.off('contact_disposed', onRefresh);
      socket.off('email_status', onEmailStatus);
    };
  }, [socket, user, fetchNext]);

  const copyText = async (val, key) => {
    if (!val) return;
    try {
      await Clipboard.setStringAsync(String(val));
      setCopiedKey(key);
      setTimeout(() => setCopiedKey(null), 1600);
    } catch {
      // Ignore
    }
  };

  const handleReceiptScan = async (useCamera) => {
    const picked = await pickAndExtractReceipt(useCamera);
    if (!picked) return;
    setForm((p) => ({ ...p, receiptImage: picked.base64DataUrl }));
    setScanningReceipt(true);
    try {
      const res = await api.post('/leads/extract-transaction', { imageBase64: picked.base64DataUrl });
      if (res.data?.success && res.data.transactionId && res.data.transactionId !== 'NOT_FOUND') {
        setForm((p) => ({
          ...p,
          transactionId: res.data.transactionId,
          leadAmount: res.data.amount ? String(res.data.amount) : p.leadAmount,
          status: 'Converted',
          remarks:
            p.remarks ||
            `[Auto-converted via receipt scan] Transaction ID: ${res.data.transactionId}${
              res.data.amount ? ` (Amount: ₹${res.data.amount})` : ''
            }`,
        }));
        showToast(`Detected UTR: ${res.data.transactionId}`, 'success');
      } else {
        showToast('Receipt attached. Enter Transaction ID manually.', 'error');
      }
    } catch {
      showToast('OCR unavailable. Please enter Transaction ID manually.', 'error');
    } finally {
      setScanningReceipt(false);
    }
  };

  const finishDisposeSuccess = async (msg) => {
    resetForm();
    if (onClearTargetContact) onClearTargetContact();
    if (msg) showToast(msg, 'success');
    await fetchNext();
  };

  const submitDisposePayload = async (cid, payload) => {
    await api.post(`/contacts/${cid}/dispose`, payload);
    await finishDisposeSuccess('Disposition saved! Loading next contact.');
  };

  const handleDispose = async () => {
    if (!queueData?.contact) return;
    recordActivity();

    if (!form.disposition) {
      Alert.alert('Required', 'Please select a call disposition.');
      return;
    }

    const now = new Date();
    if (form.disposition === 'Lead') {
      if (!form.leadAmount) return Alert.alert('Required', 'Lead Amount is required.');
      if (!form.status) return Alert.alert('Required', 'Lead Status is required.');
      if (form.status === 'Converted' && !form.transactionId.trim()) {
        return Alert.alert('Required', 'Transaction ID / UTR is required for Converted leads.');
      }
      if (form.status === 'Call Back') {
        if (!form.callBackDt) return Alert.alert('Required', 'Callback Date & Time is required.');
        if (new Date(form.callBackDt) < now) {
          return Alert.alert('Invalid Date', 'Callback cannot be scheduled for a past date/time.');
        }
      }
    } else if (form.disposition === 'Appointment') {
      if (!form.appointmentDt) return Alert.alert('Required', 'Appointment Date & Time is required.');
      if (new Date(form.appointmentDt) < now) {
        return Alert.alert('Invalid Date', 'Appointment cannot be scheduled for a past date/time.');
      }
    } else if (form.disposition === 'CallBack') {
      if (!form.callBackDt) return Alert.alert('Required', 'Callback Date & Time is required.');
      if (new Date(form.callBackDt) < now) {
        return Alert.alert('Invalid Date', 'Callback cannot be scheduled for a past date/time.');
      }
    }

    const remarkWords = form.remarks.trim().split(/\s+/).filter(Boolean);
    if (remarkWords.length < 1) {
      return Alert.alert('Required', 'Remarks are mandatory (min 1 word).');
    }

    const cid = queueData.contact._id || queueData.contact.id;
    const payload = {
      ...form,
      ...(form.leadAmount ? { leadAmount: parseFloat(form.leadAmount) } : {}),
      ...(form.appointmentDt ? { appointmentDt: new Date(form.appointmentDt).toISOString() } : {}),
      ...(form.callBackDt ? { callBackDt: new Date(form.callBackDt).toISOString() } : {}),
    };

    setSubmitting(true);
    try {
      // Check for existing callback if disposition is CallBack (matches web Workflow.jsx)
      if (payload.disposition === 'CallBack') {
        const checkRes = await api.get(`/contacts/${cid}/check-callback`);
        if (checkRes.data?.exists && checkRes.data?.callback) {
          const existing = checkRes.data.callback;
          const existingId = existing._id || existing.id;
          setSubmitting(false);
          Alert.alert(
            'Existing Callback Found',
            `A callback already exists for this contact scheduled for ${formatDateTime(existing.callBackDt)}.\n\nWould you like to update the existing callback or create a new one?`,
            [
              { text: 'Cancel', style: 'cancel' },
              {
                text: 'Create New',
                onPress: async () => {
                  setSubmitting(true);
                  try {
                    await submitDisposePayload(cid, payload);
                  } catch (e) {
                    Alert.alert('Dispose Error', e.response?.data?.error || 'Disposition failed.');
                  } finally {
                    setSubmitting(false);
                  }
                },
              },
              {
                text: 'Update Existing',
                onPress: async () => {
                  setSubmitting(true);
                  try {
                    await api.put(`/leads/callbacks/${existingId}`, {
                      callBackDt: payload.callBackDt,
                      remarks: payload.remarks,
                    });
                    await finishDisposeSuccess('Existing callback updated successfully!');
                  } catch (e) {
                    Alert.alert('Update Error', e.response?.data?.error || 'Failed to update callback.');
                  } finally {
                    setSubmitting(false);
                  }
                },
              },
            ]
          );
          return;
        }
      }

      await submitDisposePayload(cid, payload);
    } catch (err) {
      if (err.response?.status === 409 && err.response?.data?.error === 'EXISTING_LEAD') {
        const targetSection = form.status === 'Call Back' ? 'Callback' : 'Appointment';
        Alert.alert(
          'Existing Lead Record',
          `A lead record already exists for this contact.\n\nWould you like to save this update in the ${targetSection} section instead?`,
          [
            { text: 'Cancel', style: 'cancel' },
            {
              text: `Save to ${targetSection}`,
              onPress: async () => {
                setSubmitting(true);
                try {
                  const retryPayload = { ...payload };
                  if (retryPayload.status === 'Call Back') {
                    retryPayload.disposition = 'CallBack';
                  } else {
                    retryPayload.disposition = 'Appointment';
                    if (!retryPayload.appointmentDt) {
                      retryPayload.appointmentDt = retryPayload.callBackDt || new Date().toISOString();
                    }
                  }
                  await submitDisposePayload(cid, retryPayload);
                } catch (retryErr) {
                  Alert.alert('Error', retryErr.response?.data?.error || 'Failed to save redirected task.');
                } finally {
                  setSubmitting(false);
                }
              },
            },
          ]
        );
      } else {
        Alert.alert('Dispose Error', err.response?.data?.error || 'Failed to save disposition.');
      }
    } finally {
      setSubmitting(false);
    }
  };

  const handleRequeue = async (cid) => {
    setRequeuingId(cid);
    try {
      await api.post(`/contacts/${cid}/requeue`);
      await fetchNext(cid);
    } catch {
      Alert.alert('Error', 'Unable to requeue contact.');
    } finally {
      setRequeuingId(null);
    }
  };

  const contact = queueData?.contact;
  const total = queueData?.total || 0;
  const pending = queueData?.pending || 0;
  const disposed = queueData?.disposed ?? Math.max(0, total - pending);
  const progressPercent = total > 0 ? Math.round(((total - pending) / total) * 100) : 0;

  if (loading && !queueData) {
    return (
      <View style={styles.centerLoader}>
        <ActivityIndicator size="large" color={COLORS.primary} />
        <Text style={styles.loaderTxt}>Loading Calling Queue...</Text>
      </View>
    );
  }

  const fields = contact?.fields || {};
  const contactName = getContactName(fields);
  const contactPhone = getContactPhone(fields);
  const emptyAppts = getDeduplicated(emptySchedule, 'Appointment', 'appointmentDt');
  const emptyCbs = getDeduplicated(emptySchedule, 'CallBack', 'callBackDt');

  return (
    <View style={{ flex: 1, backgroundColor: COLORS.bgBase }}>
      {!!toast && (
        <View
          style={[
            styles.toastBanner,
            { backgroundColor: toast.type === 'error' ? COLORS.danger : COLORS.success },
          ]}
        >
          <Text style={styles.toastText}>{toast.message}</Text>
        </View>
      )}

      <ScrollView
        style={styles.container}
        contentContainerStyle={styles.content}
        refreshControl={<RefreshControl refreshing={loading} onRefresh={() => fetchNext()} />}
      >
        {/* Properly Aligned Queue Progress Header */}
        <GlassCard style={styles.progressCard}>
          <View style={styles.progressTopRow}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
              <View style={styles.queueIconBox}>
                <PhoneCall size={16} color={COLORS.primary} />
              </View>
              <View>
                <Text style={styles.queueTitle}>Calling Queue</Text>
                <Text style={styles.queueSub}>
                  {disposed} of {total} contacts processed
                </Text>
              </View>
            </View>
            <View style={{ alignItems: 'flex-end' }}>
              <Text style={styles.pctBig}>{contact ? progressPercent : 100}%</Text>
              <Text style={styles.pctSub}>COMPLETE</Text>
            </View>
          </View>

          <View style={styles.progressTrack}>
            <LinearGradient
              colors={contact ? GRADIENTS.primaryCta : GRADIENTS.successCta}
              start={{ x: 0, y: 0 }}
              end={{ x: 1, y: 0 }}
              style={[styles.progressFill, { width: `${contact ? progressPercent : 100}%` }]}
            />
          </View>

          <View style={styles.queueStatsRow}>
            <View style={styles.queueStatChip}>
              <Text style={styles.queueStatLabel}>Total Queue</Text>
              <Text style={styles.queueStatVal}>{total}</Text>
            </View>
            <View style={[styles.queueStatChip, { borderColor: 'rgba(217,119,6,0.25)', backgroundColor: 'rgba(217,119,6,0.06)' }]}>
              <Text style={[styles.queueStatLabel, { color: COLORS.warning }]}>Pending</Text>
              <Text style={[styles.queueStatVal, { color: COLORS.warning }]}>{pending}</Text>
            </View>
            <View style={[styles.queueStatChip, { borderColor: 'rgba(5,150,105,0.25)', backgroundColor: 'rgba(5,150,105,0.06)' }]}>
              <Text style={[styles.queueStatLabel, { color: COLORS.success }]}>Disposed</Text>
              <Text style={[styles.queueStatVal, { color: COLORS.success }]}>{disposed}</Text>
            </View>
          </View>
        </GlassCard>

        {!contact ? (
          <>
            <GlassCard style={styles.emptyCard}>
              <CheckCircle2 size={52} color={COLORS.success} style={{ marginBottom: 12 }} />
              <Text style={styles.emptyTitle}>Queue Complete!</Text>
              <Text style={styles.emptySub}>
                You&apos;ve handled all pending contacts in your queue. Pull to refresh or pick a scheduled task below.
              </Text>
              <GradientButton
                title="Refresh Queue"
                icon={RotateCw}
                onPress={() => {
                  if (onClearTargetContact) onClearTargetContact();
                  fetchNext();
                }}
                style={{ marginTop: 16, width: 190 }}
              />
            </GlassCard>

            {/* Appointments List */}
            <GlassCard style={{ borderTopWidth: 3, borderTopColor: COLORS.violet }}>
              <View style={styles.schedHeader}>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                  <Calendar size={17} color={COLORS.violet} />
                  <Text style={[styles.sectionHeading, { marginBottom: 0, color: COLORS.violet }]}>
                    Appointments
                  </Text>
                </View>
                <Badge label={String(emptyAppts.length)} color={COLORS.violet} bg={COLORS.violetLight} />
              </View>
              {emptyAppts.length === 0 ? (
                <Text style={styles.emptyListTxt}>No appointments scheduled.</Text>
              ) : (
                emptyAppts.map((item) => {
                  const id = item._id || item.id;
                  return (
                    <View key={id} style={styles.schedRow}>
                      <View style={{ flex: 1 }}>
                        <Text style={styles.contactName}>{getContactName(item.fields)}</Text>
                        <Text style={styles.metaText}>{formatDateTime(item.appointmentDt)}</Text>
                      </View>
                      <TouchableOpacity
                        onPress={() => handleRequeue(id)}
                        disabled={requeuingId === id}
                        style={styles.requeueIconBtn}
                      >
                        {requeuingId === id ? (
                          <ActivityIndicator size="small" color="#fff" />
                        ) : (
                          <ArrowRight size={15} color="#fff" />
                        )}
                      </TouchableOpacity>
                    </View>
                  );
                })
              )}
            </GlassCard>

            {/* Callbacks List */}
            <GlassCard style={{ borderTopWidth: 3, borderTopColor: COLORS.cyan }}>
              <View style={styles.schedHeader}>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                  <Clock size={17} color={COLORS.cyan} />
                  <Text style={[styles.sectionHeading, { marginBottom: 0, color: COLORS.cyan }]}>
                    Callbacks
                  </Text>
                </View>
                <Badge label={String(emptyCbs.length)} color={COLORS.cyan} bg={COLORS.cyanLight} />
              </View>
              {emptyCbs.length === 0 ? (
                <Text style={styles.emptyListTxt}>No callbacks scheduled.</Text>
              ) : (
                emptyCbs.map((item) => {
                  const id = item._id || item.id;
                  return (
                    <View key={id} style={styles.schedRow}>
                      <View style={{ flex: 1 }}>
                        <Text style={styles.contactName}>{getContactName(item.fields)}</Text>
                        <Text style={styles.metaText}>{formatDateTime(item.callBackDt)}</Text>
                      </View>
                      <TouchableOpacity
                        onPress={() => handleRequeue(id)}
                        disabled={requeuingId === id}
                        style={styles.requeueIconBtn}
                      >
                        {requeuingId === id ? (
                          <ActivityIndicator size="small" color="#fff" />
                        ) : (
                          <ArrowRight size={15} color="#fff" />
                        )}
                      </TouchableOpacity>
                    </View>
                  );
                })
              )}
            </GlassCard>
          </>
        ) : (
          <>
            {/* Client Details Card */}
            <GlassCard>
              <View style={styles.customerHeader}>
                <View style={{ flex: 1 }}>
                  <View style={{ flexDirection: 'row', gap: 6, flexWrap: 'wrap' }}>
                    {queueData.type === 'rechurn' && (
                      <Badge
                        label={`Rechurn ${queueData.rechurnNum || 1}/3 Attempt`}
                        color={COLORS.warning}
                        bg={COLORS.warningLight}
                      />
                    )}
                    {queueData.type === 'callback_due' && (
                      <Badge label="Callback Due" color={COLORS.cyan} bg={COLORS.cyanLight} />
                    )}
                    {(!queueData.type || queueData.type === 'regular') && (
                      <Badge label="Regular Queue" color={COLORS.primary} bg={COLORS.primaryLight} />
                    )}
                  </View>
                  <Text style={styles.contactNameLarge}>{contactName}</Text>
                  <TouchableOpacity
                    onPress={() => copyText(contactPhone, 'main_phone')}
                    style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 3 }}
                  >
                    <Text style={styles.phoneLarge}>{contactPhone || 'No Phone'}</Text>
                    {!!contactPhone && (
                      copiedKey === 'main_phone'
                        ? <Check size={14} color={COLORS.success} />
                        : <Copy size={13} color={COLORS.textMuted} />
                    )}
                  </TouchableOpacity>
                </View>
              </View>

              {/* Prominent Call & WhatsApp Actions */}
              <View style={styles.callActionsRow}>
                <TouchableOpacity
                  onPress={() => {
                    recordActivity();
                    openDialer(contactPhone);
                  }}
                  style={[styles.nativeActionBtn, { backgroundColor: COLORS.success }]}
                >
                  <PhoneCall size={18} color="#ffffff" />
                  <Text style={styles.nativeActionText}>Call Customer</Text>
                </TouchableOpacity>

                <TouchableOpacity
                  onPress={() => {
                    recordActivity();
                    openWhatsApp(contactPhone);
                  }}
                  style={[styles.nativeActionBtn, { backgroundColor: '#16a34a' }]}
                >
                  <MessageCircle size={18} color="#ffffff" />
                  <Text style={styles.nativeActionText}>WhatsApp</Text>
                </TouchableOpacity>
              </View>

              {/* All Client Custom Columns / Fields */}
              <Text style={styles.subGroupTitle}>CLIENT DETAILS</Text>
              <View style={styles.fieldsGrid}>
                {Object.entries(fields).map(([k, v]) => {
                  const isPhone = k.toLowerCase().includes('phone') || k.toLowerCase().includes('mobile');
                  const strVal = v !== null && v !== undefined && String(v) !== '' ? String(v) : '—';
                  return (
                    <TouchableOpacity
                      key={k}
                      activeOpacity={0.75}
                      onPress={() => copyText(strVal, k)}
                      style={styles.fieldChip}
                    >
                      <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
                        <Text style={styles.fieldKey} numberOfLines={1}>{k}</Text>
                        {copiedKey === k && <Check size={12} color={COLORS.success} />}
                      </View>
                      <Text style={styles.fieldVal}>{strVal}</Text>
                      {isPhone && strVal !== '—' && (
                        <View style={styles.inlinePhoneBtns}>
                          <TouchableOpacity onPress={() => openDialer(strVal)} style={styles.miniPhoneIcon}>
                            <PhoneCall size={12} color={COLORS.primary} />
                          </TouchableOpacity>
                          <TouchableOpacity onPress={() => openWhatsApp(strVal)} style={[styles.miniPhoneIcon, { backgroundColor: 'rgba(22,163,74,0.12)' }]}>
                            <MessageCircle size={12} color="#16a34a" />
                          </TouchableOpacity>
                        </View>
                      )}
                    </TouchableOpacity>
                  );
                })}
              </View>

              {!!contact.lastCallAttempt && (
                <View style={styles.lastAttemptRow}>
                  <AlertCircle size={14} color={COLORS.textMuted} />
                  <Text style={styles.lastAttemptTxt}>
                    Last attempt was on {formatDateTime(contact.lastCallAttempt)}
                  </Text>
                </View>
              )}
            </GlassCard>

            {/* Full Customer 360 Panel */}
            {!!contactPhone && (
              <GlassCard>
                <View style={styles.c360Header}>
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 7 }}>
                    <TrendingUp size={16} color={COLORS.primary} />
                    <Text style={styles.c360Title}>Customer 360</Text>
                  </View>
                  {customer360?.timeline && (
                    <Badge
                      label={`${customer360.timeline.length} Events`}
                      color={COLORS.primary}
                      bg={COLORS.primaryLight}
                    />
                  )}
                </View>

                {loading360 ? (
                  <View style={{ paddingVertical: 18, alignItems: 'center', gap: 8 }}>
                    <ActivityIndicator size="small" color={COLORS.primary} />
                    <Text style={{ fontSize: 12, color: COLORS.textMuted, fontWeight: '600' }}>
                      Loading Customer 360 history...
                    </Text>
                  </View>
                ) : !customer360 ? (
                  <Text style={styles.emptyListTxt}>No Customer 360 history found.</Text>
                ) : (
                  <>
                    {/* Customer 360 Lifetime Metrics */}
                    <View style={styles.c360MetricsRow}>
                      <View style={styles.c360Metric}>
                        <Text style={[styles.c360MetricVal, { color: COLORS.primary }]}>{customer360.leadsCount || 0}</Text>
                        <Text style={styles.c360MetricLbl}>Leads</Text>
                      </View>
                      <View style={styles.c360Metric}>
                        <Text style={styles.c360MetricVal}>{customer360.contactsCount || 0}</Text>
                        <Text style={styles.c360MetricLbl}>Contacts</Text>
                      </View>
                      <View style={styles.c360Metric}>
                        <Text style={[styles.c360MetricVal, { color: COLORS.cyan }]}>{customer360.callbacksCount || 0}</Text>
                        <Text style={styles.c360MetricLbl}>Callbacks</Text>
                      </View>
                      <View style={styles.c360Metric}>
                        <Text style={[styles.c360MetricVal, { color: COLORS.violet }]}>{customer360.appointmentsCount || 0}</Text>
                        <Text style={styles.c360MetricLbl}>Appts</Text>
                      </View>
                    </View>

                    {/* Converted Lead History Banner */}
                    {customer360.hasConvertedLead && Array.isArray(customer360.convertedLeads) && customer360.convertedLeads.length > 0 && (
                      <View style={styles.convertedBanner}>
                        <View style={styles.convertedBannerTitleRow}>
                          <Sparkles size={15} color={COLORS.success} />
                          <Text style={styles.convertedBannerTitle}>
                            Converted Lead History Found ({customer360.convertedLeads.length})
                          </Text>
                        </View>
                        {customer360.convertedLeads.map((lead, idx) => {
                          const amt =
                            lead.isCharityConfirmed && lead.charityAmount !== null && lead.charityAmount !== undefined
                              ? lead.charityAmount
                              : lead.leadAmount;
                          return (
                            <View key={lead.id || idx} style={styles.convertedCard}>
                              <Text style={styles.convertedAmt}>Amt: {formatCurrency(amt)}</Text>
                              {lead.isCharityConfirmed && lead.utrCharity ? (
                                <>
                                  <Text style={styles.convertedUtr}>UTR-Internal: {lead.transactionId || 'N/A'}</Text>
                                  <Text style={[styles.convertedUtr, { color: COLORS.success, fontWeight: '800' }]}>
                                    ✓ UTR-Charity: {lead.utrCharity}
                                  </Text>
                                </>
                              ) : (
                                <Text style={styles.convertedUtr}>UTR-Internal: {lead.transactionId || 'N/A'}</Text>
                              )}
                              <Text style={styles.convertedMeta}>
                                By {lead.agentName || 'Agent'} on {formatDateOnly(lead.createdAt)}
                              </Text>
                            </View>
                          );
                        })}
                      </View>
                    )}

                    {/* Timeline */}
                    {!customer360.timeline || customer360.timeline.length === 0 ? (
                      <Text style={styles.emptyListTxt}>No past remarks or interaction history found.</Text>
                    ) : (
                      <View style={styles.timelineWrap}>
                        {customer360.timeline.map((entry, idx) => {
                          const meta = getEntryMeta(entry.label || entry.type || '');
                          return (
                            <View key={idx} style={styles.timelineItem}>
                              <View style={[styles.timelineDot, { borderColor: meta.color }]} />
                              <View style={[styles.timelineBody, { borderLeftColor: meta.color }]}>
                                <View style={styles.timelineMetaRow}>
                                  <View style={[styles.timelinePill, { backgroundColor: meta.bg, borderColor: meta.color }]}>
                                    <Text style={[styles.timelinePillTxt, { color: meta.color }]}>
                                      {entry.label || 'Remark'}
                                    </Text>
                                  </View>
                                  {!!entry.agent && (
                                    <Text style={styles.timelineAgent}>
                                      by <Text style={{ color: COLORS.primary }}>{entry.agent}</Text>
                                    </Text>
                                  )}
                                </View>
                                {!!entry.date && (
                                  <Text style={styles.timelineDate}>{formatDateTime(entry.date)}</Text>
                                )}
                                {!!entry.content && (
                                  <Text style={styles.timelineContent}>{entry.content}</Text>
                                )}
                              </View>
                            </View>
                          );
                        })}
                      </View>
                    )}
                  </>
                )}
              </GlassCard>
            )}

            {/* Dispose Call Form */}
            <GlassCard>
              <Text style={styles.sectionHeading}>Dispose Call</Text>
              <View style={styles.dispGrid}>
                {DISPOSITIONS.map((d) => {
                  const active = form.disposition === d.key;
                  return (
                    <TouchableOpacity
                      key={d.key}
                      onPress={() =>
                        setForm((p) => ({
                          ...p,
                          disposition: d.key,
                          status: '',
                          statusDetails: '',
                          transactionId: '',
                          leadAmount: '',
                          appointmentDt: '',
                          callBackDt: '',
                          receiptImage: '',
                        }))
                      }
                      style={[
                        styles.dispBtn,
                        active && { backgroundColor: d.color, borderColor: d.color },
                      ]}
                    >
                      <Text style={[styles.dispText, active && { color: '#fff' }]}>{d.label}</Text>
                    </TouchableOpacity>
                  );
                })}
              </View>

              {form.disposition === 'Lead' && (
                <View style={{ marginTop: 6 }}>
                  <View style={{ flexDirection: 'row', gap: 10, marginBottom: 10 }}>
                    <TouchableOpacity onPress={() => handleReceiptScan(true)} style={styles.scanBtn}>
                      <Camera size={16} color={COLORS.primary} />
                      <Text style={styles.scanBtnText}>Camera OCR</Text>
                    </TouchableOpacity>
                    <TouchableOpacity onPress={() => handleReceiptScan(false)} style={styles.scanBtn}>
                      <ImageIcon size={16} color={COLORS.primary} />
                      <Text style={styles.scanBtnText}>Gallery OCR</Text>
                    </TouchableOpacity>
                  </View>
                  {scanningReceipt && (
                    <View style={styles.scanRow}>
                      <ActivityIndicator size="small" color={COLORS.primary} />
                      <Text style={styles.scanInfo}>Scanning receipt with AI OCR...</Text>
                    </View>
                  )}
                  {!!form.receiptImage && (
                    <Image source={{ uri: form.receiptImage }} style={styles.receiptPreview} resizeMode="contain" />
                  )}

                  <Text style={styles.label}>LEAD AMOUNT (₹) *</Text>
                  <TextInput
                    keyboardType="numeric"
                    value={form.leadAmount}
                    onChangeText={(v) => setForm((p) => ({ ...p, leadAmount: v }))}
                    placeholder="Amount"
                    placeholderTextColor="#94a3b8"
                    style={styles.input}
                  />

                  <Text style={styles.label}>LEAD STATUS *</Text>
                  <View style={styles.dispGrid}>
                    {LEAD_STATUS_OPTIONS.map((st) => (
                      <TouchableOpacity
                        key={st}
                        onPress={() => setForm((p) => ({ ...p, status: st }))}
                        style={[
                          styles.dispBtn,
                          form.status === st && { backgroundColor: COLORS.primary, borderColor: COLORS.primary },
                        ]}
                      >
                        <Text style={[styles.dispText, form.status === st && { color: '#fff' }]}>{st}</Text>
                      </TouchableOpacity>
                    ))}
                  </View>

                  {form.status === 'Converted' && (
                    <>
                      <Text style={styles.label}>TRANSACTION ID / UTR *</Text>
                      <TextInput
                        value={form.transactionId}
                        onChangeText={(v) => setForm((p) => ({ ...p, transactionId: v }))}
                        placeholder="UTR / Transaction Reference"
                        placeholderTextColor="#94a3b8"
                        style={styles.input}
                      />
                    </>
                  )}

                  {form.status === 'Call Back' && (
                    <>
                      <Text style={styles.label}>CALLBACK SCHEDULE *</Text>
                      <DateTimeField
                        value={form.callBackDt}
                        onChange={(v) => setForm((p) => ({ ...p, callBackDt: v }))}
                        minimumDate={new Date()}
                        placeholder="Pick callback date & time"
                      />
                    </>
                  )}

                  {form.status === 'Others' && (
                    <>
                      <Text style={styles.label}>STATUS DETAILS</Text>
                      <TextInput
                        value={form.statusDetails}
                        onChangeText={(v) => setForm((p) => ({ ...p, statusDetails: v }))}
                        placeholder="Specify details..."
                        placeholderTextColor="#94a3b8"
                        style={styles.input}
                      />
                    </>
                  )}
                </View>
              )}

              {form.disposition === 'Appointment' && (
                <View>
                  <Text style={styles.label}>APPOINTMENT DATE & TIME *</Text>
                  <DateTimeField
                    value={form.appointmentDt}
                    onChange={(v) => setForm((p) => ({ ...p, appointmentDt: v }))}
                    minimumDate={new Date()}
                    placeholder="Pick appointment date & time"
                  />
                </View>
              )}

              {form.disposition === 'CallBack' && (
                <View>
                  <Text style={styles.label}>CALLBACK DATE & TIME *</Text>
                  <DateTimeField
                    value={form.callBackDt}
                    onChange={(v) => setForm((p) => ({ ...p, callBackDt: v }))}
                    minimumDate={new Date()}
                    placeholder="Pick callback date & time"
                  />
                </View>
              )}

              <Text style={styles.label}>REMARKS (MIN 1 WORD) *</Text>
              <TextInput
                multiline
                numberOfLines={3}
                value={form.remarks}
                onChangeText={(v) => setForm((p) => ({ ...p, remarks: v }))}
                placeholder="Write detailed call notes..."
                placeholderTextColor="#94a3b8"
                style={[styles.input, { height: 84, textAlignVertical: 'top', paddingTop: 10 }]}
              />

              <GradientButton
                title="Submit Disposition"
                icon={Check}
                onPress={handleDispose}
                loading={submitting}
                disabled={!form.disposition}
              />
            </GlassCard>
          </>
        )}
      </ScrollView>
    </View>
  );
};

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: COLORS.bgBase },
  content: { padding: 14, paddingBottom: 32, gap: 12 },
  centerLoader: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: COLORS.bgBase },
  loaderTxt: { marginTop: 10, color: COLORS.textMuted, fontWeight: '600' },
  toastBanner: {
    marginHorizontal: 14,
    marginTop: 8,
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 12,
  },
  toastText: { color: '#fff', fontSize: 12.5, fontWeight: '800', textAlign: 'center' },
  progressCard: { gap: 10 },
  progressTopRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  queueIconBox: {
    width: 34,
    height: 34,
    borderRadius: 10,
    backgroundColor: COLORS.primaryLight,
    alignItems: 'center',
    justifyContent: 'center',
  },
  queueTitle: { fontSize: 15.5, fontWeight: '900', color: COLORS.textPrimary },
  queueSub: { fontSize: 11.5, color: COLORS.textMuted, fontWeight: '600' },
  pctBig: { fontSize: 19, fontWeight: '900', color: COLORS.primary },
  pctSub: { fontSize: 9, fontWeight: '800', color: COLORS.textMuted, letterSpacing: 0.6 },
  progressTrack: {
    height: 10,
    borderRadius: 999,
    backgroundColor: '#e2e8f0',
    overflow: 'hidden',
  },
  progressFill: { height: '100%', borderRadius: 999 },
  queueStatsRow: { flexDirection: 'row', gap: 8 },
  queueStatChip: {
    flex: 1,
    paddingVertical: 8,
    paddingHorizontal: 10,
    borderRadius: 10,
    backgroundColor: COLORS.surfaceMuted,
    borderWidth: 1,
    borderColor: COLORS.borderSlate,
    alignItems: 'center',
  },
  queueStatLabel: { fontSize: 10, fontWeight: '800', color: COLORS.textMuted, textTransform: 'uppercase' },
  queueStatVal: { fontSize: 15.5, fontWeight: '900', color: COLORS.textPrimary, marginTop: 2 },
  emptyCard: { alignItems: 'center', paddingVertical: 28, paddingHorizontal: 18 },
  emptyTitle: { fontSize: 20, fontWeight: '900', color: COLORS.textPrimary },
  emptySub: { fontSize: 13, color: COLORS.textMuted, textAlign: 'center', marginTop: 6, lineHeight: 19 },
  schedHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 },
  schedRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 10,
    borderTopWidth: 1,
    borderTopColor: '#f1f5f9',
  },
  emptyListTxt: { fontSize: 12.5, color: COLORS.textMuted, textAlign: 'center', paddingVertical: 10 },
  requeueIconBtn: {
    width: 34,
    height: 34,
    borderRadius: 10,
    backgroundColor: COLORS.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  customerHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start' },
  contactNameLarge: { fontSize: 22, fontWeight: '900', color: COLORS.textPrimary, marginTop: 8 },
  phoneLarge: { fontSize: 16, fontWeight: '800', color: COLORS.primary },
  callActionsRow: { flexDirection: 'row', gap: 10, marginTop: 14, marginBottom: 14 },
  nativeActionBtn: {
    flex: 1,
    height: 44,
    borderRadius: 12,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
  nativeActionText: { color: '#fff', fontWeight: '800', fontSize: 14 },
  subGroupTitle: {
    fontSize: 10.5,
    fontWeight: '800',
    color: COLORS.textMuted,
    letterSpacing: 0.7,
    marginBottom: 8,
  },
  fieldsGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  fieldChip: {
    minWidth: '47%',
    flex: 1,
    backgroundColor: '#f8fafc',
    borderRadius: 10,
    padding: 10,
    borderWidth: 1,
    borderColor: '#e2e8f0',
  },
  fieldKey: { fontSize: 10, fontWeight: '800', color: COLORS.textMuted, textTransform: 'uppercase' },
  fieldVal: { fontSize: 13, fontWeight: '700', color: COLORS.textPrimary, marginTop: 2 },
  inlinePhoneBtns: { flexDirection: 'row', gap: 6, marginTop: 6 },
  miniPhoneIcon: {
    width: 26,
    height: 26,
    borderRadius: 8,
    backgroundColor: COLORS.primaryLight,
    alignItems: 'center',
    justifyContent: 'center',
  },
  lastAttemptRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginTop: 12,
    paddingTop: 10,
    borderTopWidth: 1,
    borderTopColor: '#f1f5f9',
  },
  lastAttemptTxt: { fontSize: 12, color: COLORS.textMuted, fontWeight: '600' },
  c360Header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 },
  c360Title: { fontSize: 15, fontWeight: '900', color: COLORS.textPrimary },
  c360MetricsRow: { flexDirection: 'row', gap: 6, marginBottom: 12 },
  c360Metric: {
    flex: 1,
    backgroundColor: '#f8fafc',
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#e2e8f0',
    paddingVertical: 8,
    alignItems: 'center',
  },
  c360MetricVal: { fontSize: 16, fontWeight: '900', color: COLORS.textPrimary },
  c360MetricLbl: { fontSize: 10, fontWeight: '700', color: COLORS.textMuted, marginTop: 1 },
  convertedBanner: {
    backgroundColor: 'rgba(16,185,129,0.08)',
    borderWidth: 1,
    borderColor: 'rgba(16,185,129,0.28)',
    borderRadius: 14,
    padding: 12,
    marginBottom: 12,
    gap: 8,
  },
  convertedBannerTitleRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  convertedBannerTitle: { fontSize: 12.5, fontWeight: '900', color: COLORS.success, textTransform: 'uppercase' },
  convertedCard: {
    backgroundColor: '#ffffff',
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#d1fae5',
    padding: 10,
    gap: 2,
  },
  convertedAmt: { fontSize: 13.5, fontWeight: '900', color: COLORS.textPrimary },
  convertedUtr: { fontSize: 12, fontWeight: '700', color: COLORS.textSecondary },
  convertedMeta: { fontSize: 11, color: COLORS.textMuted, marginTop: 2 },
  timelineWrap: {
    paddingLeft: 14,
    borderLeftWidth: 2,
    borderLeftColor: '#e2e8f0',
    gap: 12,
  },
  timelineItem: { position: 'relative' },
  timelineDot: {
    position: 'absolute',
    left: -21,
    top: 4,
    width: 12,
    height: 12,
    borderRadius: 6,
    backgroundColor: '#ffffff',
    borderWidth: 3,
  },
  timelineBody: {
    backgroundColor: '#f8fafc',
    borderRadius: 10,
    padding: 10,
    borderLeftWidth: 3,
    gap: 4,
  },
  timelineMetaRow: { flexDirection: 'row', alignItems: 'center', gap: 8, flexWrap: 'wrap' },
  timelinePill: {
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 999,
    borderWidth: 1,
  },
  timelinePillTxt: { fontSize: 10, fontWeight: '800', textTransform: 'uppercase' },
  timelineAgent: { fontSize: 11.5, fontWeight: '700', color: COLORS.textSecondary },
  timelineDate: { fontSize: 10.5, color: COLORS.textMuted },
  timelineContent: { fontSize: 12.5, color: COLORS.textPrimary, lineHeight: 18 },
  sectionHeading: { fontSize: 15.5, fontWeight: '800', color: COLORS.textPrimary, marginBottom: 10 },
  dispGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 7, marginBottom: 10 },
  dispBtn: {
    paddingHorizontal: 11,
    paddingVertical: 8,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: '#cbd5e1',
    backgroundColor: '#f8fafc',
  },
  dispText: { fontSize: 12, fontWeight: '700', color: COLORS.textSecondary },
  scanBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    height: 40,
    borderRadius: 10,
    backgroundColor: COLORS.primaryLight,
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  scanBtnText: { fontSize: 12.5, fontWeight: '700', color: COLORS.primary },
  scanRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 10 },
  scanInfo: { fontSize: 12, color: COLORS.primary, fontWeight: '600' },
  receiptPreview: { width: '100%', height: 130, borderRadius: 10, backgroundColor: '#f8fafc', marginBottom: 10 },
  label: { fontSize: 10.5, fontWeight: '800', color: COLORS.textSecondary, letterSpacing: 0.6, marginBottom: 5 },
  input: {
    height: 43,
    backgroundColor: '#f8fafc',
    borderWidth: 1.5,
    borderColor: '#e2e8f0',
    borderRadius: 10,
    paddingHorizontal: 12,
    fontSize: 13.5,
    color: COLORS.textPrimary,
    marginBottom: 12,
  },
  contactName: { fontSize: 14.5, fontWeight: '800', color: COLORS.textPrimary },
  metaText: { fontSize: 12, color: COLORS.textMuted, marginTop: 2 },
});

export default WorkflowScreen;
