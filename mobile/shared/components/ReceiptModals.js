import React, { useState, useEffect } from 'react';
import {
  Modal,
  View,
  Text,
  TextInput,
  TouchableOpacity,
  ScrollView,
  Image,
  Alert,
  ActivityIndicator,
  Platform,
  StyleSheet,
} from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import * as Clipboard from 'expo-clipboard';
import api from '../services/api';
import { useAuth } from '../contexts/AuthContext';
import { COLORS, LEAD_STATUS_OPTIONS } from '../theme';
import {
  GradientButton,
  Badge,
  getContactName,
  getContactPhone,
  getContactEmail,
  formatCurrency,
  formatDateTime,
  formatDateOnly,
  openDialer,
  openWhatsApp,
} from './UI';
import DateTimeField from './DateTimeField';
import {
  X,
  Camera,
  Image as ImageIcon,
  ShieldCheck,
  PhoneCall,
  MessageCircle,
  Plus,
  CheckCircle2,
  Star,
  TrendingUp,
  Clock,
  FileText,
  Layers,
  Copy,
  Check,
  Edit3,
  Trash2,
  AlertTriangle,
  ArrowLeft,
  XCircle,
  Mail,
  Sparkles,
} from 'lucide-react-native';

export async function pickAndExtractReceipt(useCamera = false) {
  if (useCamera) {
    const perm = await ImagePicker.requestCameraPermissionsAsync();
    if (!perm.granted) {
      Alert.alert('Permission Required', 'Please grant camera access to capture payment receipts.');
      return null;
    }
  } else if (Platform.OS === 'ios') {
    const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!perm.granted) {
      Alert.alert('Permission Required', 'Please grant photo library access to select payment receipts.');
      return null;
    }
  }

  const pickerRes = useCamera
    ? await ImagePicker.launchCameraAsync({ base64: true, quality: 0.75 })
    : await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], base64: true, quality: 0.75 });

  if (pickerRes.canceled || !pickerRes.assets?.[0]?.base64) {
    return null;
  }

  const asset = pickerRes.assets[0];
  const mime = asset.mimeType || 'image/jpeg';
  const base64DataUrl = `data:${mime};base64,${asset.base64}`;
  return { uri: asset.uri, base64DataUrl };
}

export const ReceiptUploadModal = ({ lead, onClose, onSuccess }) => {
  const [imageBase64, setImageBase64] = useState('');
  const [scanning, setScanning] = useState(false);
  const [scanMsg, setScanMsg] = useState('');
  const [leadAmount, setLeadAmount] = useState('');
  const [transactionId, setTransactionId] = useState('');
  const [remarks, setRemarks] = useState('[Auto-converted via payment receipt upload]');
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (lead) {
      setImageBase64('');
      setScanMsg('');
      setLeadAmount(String(lead.leadAmount || ''));
      setTransactionId(lead.transactionId || '');
      setRemarks('[Auto-converted via payment receipt upload]');
    }
  }, [lead]);

  if (!lead) return null;

  const handlePick = async (useCamera) => {
    const picked = await pickAndExtractReceipt(useCamera);
    if (!picked) return;
    setImageBase64(picked.base64DataUrl);
    setScanning(true);
    setScanMsg('');
    try {
      const res = await api.post('/leads/extract-transaction', { imageBase64: picked.base64DataUrl });
      if (res.data?.success && res.data.transactionId && res.data.transactionId !== 'NOT_FOUND') {
        setTransactionId(res.data.transactionId);
        if (res.data.amount) setLeadAmount(String(res.data.amount));
        setRemarks(
          `[Auto-converted via receipt scan] Transaction ID: ${res.data.transactionId}${
            res.data.amount ? ` (Amount: ₹${res.data.amount})` : ''
          }`
        );
        setScanMsg(`Detected ID: ${res.data.transactionId}`);
      } else {
        setScanMsg('Could not auto-detect Transaction ID. Please enter manually.');
      }
    } catch {
      setScanMsg('AI OCR unavailable. Please enter Transaction ID manually.');
    } finally {
      setScanning(false);
    }
  };

  const handleSubmit = async () => {
    if (!transactionId.trim()) {
      Alert.alert('Required', 'Please enter Transaction ID / UTR.');
      return;
    }
    setSubmitting(true);
    try {
      const parsedAmount = parseFloat(leadAmount) || lead.leadAmount || 0;
      const payload = {
        status: 'Converted',
        leadAmount: parsedAmount,
        transactionId: transactionId.trim(),
        remarks: remarks.trim(),
        receiptImage: imageBase64 || undefined,
      };
      const leadId = lead._id || lead.id;
      await api.put(`/leads/${leadId}`, payload);
      const contactId = lead.contactId || leadId;
      if (contactId) {
        await api.put(`/contacts/${contactId}/status`, payload).catch(() => {});
      }
      if (onSuccess) onSuccess({ ...lead, ...payload });
      onClose();
    } catch (err) {
      Alert.alert('Error', err.response?.data?.error || 'Failed to save conversion.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Modal visible={!!lead} transparent animationType="slide" onRequestClose={onClose}>
      <View style={styles.overlay}>
        <View style={styles.sheet}>
          <View style={styles.header}>
            <Text style={styles.title}>Upload Receipt & Convert</Text>
            <TouchableOpacity onPress={onClose}><X size={20} color={COLORS.textMuted} /></TouchableOpacity>
          </View>
          <ScrollView showsVerticalScrollIndicator={false}>
            <Text style={styles.sub}>Lead: {getContactName(lead.fields)}</Text>
            <View style={styles.rowBtns}>
              <TouchableOpacity onPress={() => handlePick(true)} style={styles.pickerBtn}>
                <Camera size={16} color={COLORS.primary} />
                <Text style={styles.pickerBtnText}>Camera</Text>
              </TouchableOpacity>
              <TouchableOpacity onPress={() => handlePick(false)} style={styles.pickerBtn}>
                <ImageIcon size={16} color={COLORS.primary} />
                <Text style={styles.pickerBtnText}>Gallery</Text>
              </TouchableOpacity>
            </View>
            {scanning && (
              <View style={styles.scanRow}>
                <ActivityIndicator size="small" color={COLORS.primary} />
                <Text style={styles.scanText}>Scanning receipt with AI OCR...</Text>
              </View>
            )}
            {!!scanMsg && <Text style={styles.scanMsg}>{scanMsg}</Text>}
            {!!imageBase64 && <Image source={{ uri: imageBase64 }} style={styles.previewImg} resizeMode="contain" />}

            <Text style={styles.label}>TRANSACTION ID / UTR *</Text>
            <TextInput value={transactionId} onChangeText={setTransactionId} placeholder="UTR / Ref No." placeholderTextColor="#94a3b8" style={styles.input} />
            <Text style={styles.label}>AMOUNT (₹)</Text>
            <TextInput keyboardType="numeric" value={leadAmount} onChangeText={setLeadAmount} placeholder="0" placeholderTextColor="#94a3b8" style={styles.input} />
            <Text style={styles.label}>REMARKS</Text>
            <TextInput value={remarks} onChangeText={setRemarks} multiline style={[styles.input, { height: 70, paddingTop: 10, textAlignVertical: 'top' }]} />

            <GradientButton title="Convert & Save" onPress={handleSubmit} loading={submitting} />
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
};

export const LeadStatusModal = ({ lead, newStatus, onClose, onSave, submitting }) => {
  const [leadAmount, setLeadAmount] = useState('');
  const [transactionId, setTransactionId] = useState('');
  const [callBackDt, setCallBackDt] = useState('');
  const [statusDetails, setStatusDetails] = useState('');
  const [remarks, setRemarks] = useState('');
  const [receiptImage, setReceiptImage] = useState('');
  const [scanning, setScanning] = useState(false);
  const [scanMsg, setScanMsg] = useState('');

  useEffect(() => {
    if (lead && newStatus) {
      setLeadAmount(String(lead.leadAmount || ''));
      setTransactionId(lead.transactionId || '');
      setCallBackDt(lead.callBackDt ? new Date(lead.callBackDt).toISOString() : '');
      setStatusDetails(lead.statusDetails || '');
      setRemarks('');
      setReceiptImage('');
      setScanMsg('');
    }
  }, [lead, newStatus]);

  if (!lead || !newStatus) return null;

  const handleScan = async (useCamera) => {
    const picked = await pickAndExtractReceipt(useCamera);
    if (!picked) return;
    setReceiptImage(picked.base64DataUrl);
    setScanning(true);
    setScanMsg('');
    try {
      const res = await api.post('/leads/extract-transaction', { imageBase64: picked.base64DataUrl });
      if (res.data?.success && res.data.transactionId && res.data.transactionId !== 'NOT_FOUND') {
        setTransactionId(res.data.transactionId);
        if (res.data.amount) setLeadAmount(String(res.data.amount));
        if (!remarks) {
          setRemarks(
            `[Auto-converted via receipt scan] Transaction ID: ${res.data.transactionId}${
              res.data.amount ? ` (Amount: ₹${res.data.amount})` : ''
            }`
          );
        }
        setScanMsg(`Detected UTR: ${res.data.transactionId}`);
      } else {
        setScanMsg('Could not detect Transaction ID automatically. Enter manually.');
      }
    } catch {
      setScanMsg('AI OCR unavailable. Enter Transaction ID manually.');
    } finally {
      setScanning(false);
    }
  };

  const handleSave = () => {
    if (newStatus === 'Converted' && !transactionId.trim()) {
      Alert.alert('Required', 'Transaction ID / UTR is required.');
      return;
    }
    if (newStatus === 'Call Back' && !callBackDt) {
      Alert.alert('Required', 'Callback Date & Time is required.');
      return;
    }
    if (!remarks.trim()) {
      Alert.alert('Required', 'Remarks are required.');
      return;
    }
    const payload = {
      leadAmount: parseFloat(leadAmount) || 0,
      transactionId: transactionId.trim(),
      statusDetails: statusDetails.trim(),
      remarks: remarks.trim(),
      ...(receiptImage ? { receiptImage } : {}),
      ...(newStatus === 'Converted' ? { conversionDate: new Date().toISOString() } : {}),
      ...(callBackDt ? { callBackDt: new Date(callBackDt).toISOString() } : {}),
    };
    onSave(payload);
  };

  return (
    <Modal visible={!!lead && !!newStatus} transparent animationType="slide" onRequestClose={onClose}>
      <View style={styles.overlay}>
        <View style={styles.sheet}>
          <View style={styles.header}>
            <Text style={styles.title}>Update Status: {newStatus}</Text>
            <TouchableOpacity onPress={onClose}><X size={20} color={COLORS.textMuted} /></TouchableOpacity>
          </View>
          <ScrollView showsVerticalScrollIndicator={false}>
            <Text style={styles.sub}>Updating {getContactName(lead.fields)}</Text>
            {newStatus === 'Converted' && (
              <>
                <View style={styles.rowBtns}>
                  <TouchableOpacity onPress={() => handleScan(true)} style={styles.pickerBtn}>
                    <Camera size={16} color={COLORS.primary} />
                    <Text style={styles.pickerBtnText}>Scan Camera</Text>
                  </TouchableOpacity>
                  <TouchableOpacity onPress={() => handleScan(false)} style={styles.pickerBtn}>
                    <ImageIcon size={16} color={COLORS.primary} />
                    <Text style={styles.pickerBtnText}>Upload Receipt</Text>
                  </TouchableOpacity>
                </View>
                {scanning && <ActivityIndicator size="small" color={COLORS.primary} style={{ marginBottom: 8 }} />}
                {!!scanMsg && <Text style={styles.scanMsg}>{scanMsg}</Text>}
                {!!receiptImage && <Image source={{ uri: receiptImage }} style={styles.previewImg} resizeMode="contain" />}

                <Text style={styles.label}>CONVERSION AMOUNT (₹)</Text>
                <TextInput keyboardType="numeric" value={leadAmount} onChangeText={setLeadAmount} placeholder="e.g. 3000" placeholderTextColor="#94a3b8" style={styles.input} />
                <Text style={styles.label}>TRANSACTION ID / UTR *</Text>
                <TextInput value={transactionId} onChangeText={setTransactionId} placeholder="Enter UTR / Transaction ID" placeholderTextColor="#94a3b8" style={styles.input} />
              </>
            )}
            {newStatus === 'Call Back' && (
              <>
                <Text style={styles.label}>NEXT CALLBACK DATE & TIME *</Text>
                <DateTimeField
                  value={callBackDt}
                  onChange={setCallBackDt}
                  minimumDate={new Date()}
                  placeholder="Select callback date & time"
                />
              </>
            )}
            {newStatus === 'Others' && (
              <>
                <Text style={styles.label}>STATUS DETAILS</Text>
                <TextInput value={statusDetails} onChangeText={setStatusDetails} placeholder="Optional details" placeholderTextColor="#94a3b8" style={styles.input} />
              </>
            )}
            <Text style={styles.label}>REMARKS / NOTES *</Text>
            <TextInput
              value={remarks}
              onChangeText={setRemarks}
              multiline
              placeholder="Add update remarks..."
              placeholderTextColor="#94a3b8"
              style={[styles.input, { height: 80, paddingTop: 10, textAlignVertical: 'top' }]}
            />
            <GradientButton title="Save Status & Remarks" onPress={handleSave} loading={submitting} />
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
};

export const CharityConfirmModal = ({ lead, onClose, onSuccess }) => {
  const [utrCharity, setUtrCharity] = useState('');
  const [charityAmount, setCharityAmount] = useState('');
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (lead) {
      setUtrCharity(lead.utrCharity || '');
      setCharityAmount(
        lead.charityAmount !== null && lead.charityAmount !== undefined
          ? String(lead.charityAmount)
          : String(lead.leadAmount || '')
      );
    }
  }, [lead]);

  if (!lead) return null;

  const handleSubmit = async () => {
    if (!utrCharity.trim()) {
      Alert.alert('Required', 'Please enter the UTR / Transaction ID provided by the charity.');
      return;
    }
    const numAmount = parseFloat(charityAmount);
    if (isNaN(numAmount) || numAmount < 0) {
      Alert.alert('Invalid Amount', 'Please enter a valid non-negative amount.');
      return;
    }
    setSubmitting(true);
    try {
      const leadId = lead._id || lead.id || lead.contactId;
      const payload = { utrCharity: utrCharity.trim(), charityAmount: numAmount };
      const res = await api.put(`/leads/${leadId}/confirm-charity`, payload);
      if (res.data?.success) {
        if (onSuccess) {
          onSuccess({
            ...lead,
            ...payload,
            isCharityConfirmed: true,
            charityConfirmedAt: new Date().toISOString(),
          });
        }
        onClose();
      }
    } catch (err) {
      Alert.alert('Error', err.response?.data?.error || 'Charity confirmation failed.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Modal visible={!!lead} transparent animationType="slide" onRequestClose={onClose}>
      <View style={styles.overlay}>
        <View style={styles.sheet}>
          <View style={styles.header}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
              <ShieldCheck size={19} color={COLORS.success} />
              <Text style={styles.title}>Confirm by Charity</Text>
            </View>
            <TouchableOpacity onPress={onClose}><X size={20} color={COLORS.textMuted} /></TouchableOpacity>
          </View>
          <Text style={styles.sub}>
            Donor: {getContactName(lead.fields)} | Agent UTR: {lead.transactionId || 'N/A'} | Agent Amount: {formatCurrency(lead.leadAmount)}
          </Text>
          <Text style={styles.label}>CHARITY UTR / TRANSACTION ID *</Text>
          <TextInput value={utrCharity} onChangeText={setUtrCharity} placeholder="Charity verified UTR" placeholderTextColor="#94a3b8" style={styles.input} />
          <Text style={styles.label}>CONFIRMED CHARITY AMOUNT (₹) *</Text>
          <TextInput keyboardType="numeric" value={charityAmount} onChangeText={setCharityAmount} placeholderTextColor="#94a3b8" style={styles.input} />
          <GradientButton title="Confirm Charity Receipt" onPress={handleSubmit} loading={submitting} />
        </View>
      </View>
    </Modal>
  );
};

export const CreateLeadModal = ({ visible, onClose, onSave, submitting }) => {
  const { user } = useAuth();
  const [agents, setAgents] = useState([]);
  const [form, setForm] = useState({
    name: '',
    phone: '',
    email: '',
    leadAmount: '',
    status: 'Converted',
    transactionId: '',
    callBackDt: '',
    createdAt: new Date().toISOString(),
    remarks: '',
    assignedTo: user?._id || user?.id || '',
  });

  useEffect(() => {
    if (visible) {
      setForm({
        name: '',
        phone: '',
        email: '',
        leadAmount: '',
        status: 'Converted',
        transactionId: '',
        callBackDt: '',
        createdAt: new Date().toISOString(),
        remarks: '',
        assignedTo: user?._id || user?.id || '',
      });
      if (['tl', 'admin', 'superadmin'].includes(user?.role)) {
        const endpoint = user.role === 'tl' ? '/users/my-agents' : '/users';
        api.get(endpoint).then((res) => {
          setAgents((res.data || []).filter((u) => u.active && u.role === 'agent'));
        }).catch(() => {});
      }
    }
  }, [visible, user]);

  if (!visible) return null;

  const handleSave = () => {
    if (!form.name.trim() || !form.phone.trim()) {
      Alert.alert('Required', 'Contact Name and Phone are required.');
      return;
    }
    if (form.status === 'Converted' && !form.transactionId.trim()) {
      Alert.alert('Required', 'Transaction ID / UTR is required for Converted leads.');
      return;
    }
    if (form.status === 'Call Back' && !form.callBackDt) {
      Alert.alert('Required', 'Next Callback Date & Time is required.');
      return;
    }
    const payload = {
      ...form,
      name: form.name.trim(),
      phone: form.phone.trim(),
      email: form.email.trim(),
      leadAmount: parseFloat(form.leadAmount) || 0,
      createdAt: form.createdAt ? new Date(form.createdAt).toISOString() : new Date().toISOString(),
      ...(form.status === 'Call Back' && form.callBackDt ? { callBackDt: new Date(form.callBackDt).toISOString() } : {}),
    };
    onSave(payload);
  };

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <View style={styles.overlay}>
        <View style={styles.sheet}>
          <View style={styles.header}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
              <Plus size={19} color={COLORS.primary} />
              <Text style={styles.title}>Create New Lead</Text>
            </View>
            <TouchableOpacity onPress={onClose}><X size={20} color={COLORS.textMuted} /></TouchableOpacity>
          </View>
          <ScrollView showsVerticalScrollIndicator={false}>
            <Text style={styles.label}>CONTACT NAME *</Text>
            <TextInput value={form.name} onChangeText={(v) => setForm((p) => ({ ...p, name: v }))} placeholder="Enter client's full name" placeholderTextColor="#94a3b8" style={styles.input} />
            <Text style={styles.label}>PHONE NUMBER *</Text>
            <TextInput keyboardType="phone-pad" value={form.phone} onChangeText={(v) => setForm((p) => ({ ...p, phone: v }))} placeholder="Mobile number" placeholderTextColor="#94a3b8" style={styles.input} />
            <Text style={styles.label}>EMAIL</Text>
            <TextInput keyboardType="email-address" autoCapitalize="none" value={form.email} onChangeText={(v) => setForm((p) => ({ ...p, email: v }))} placeholder="client@example.com" placeholderTextColor="#94a3b8" style={styles.input} />
            <Text style={styles.label}>LEAD VALUE (₹) *</Text>
            <TextInput keyboardType="numeric" value={form.leadAmount} onChangeText={(v) => setForm((p) => ({ ...p, leadAmount: v }))} placeholder="Amount in Rupees" placeholderTextColor="#94a3b8" style={styles.input} />
            <Text style={styles.label}>INITIAL STATUS *</Text>
            <View style={styles.chipGrid}>
              {LEAD_STATUS_OPTIONS.map((st) => (
                <TouchableOpacity
                  key={st}
                  onPress={() => setForm((p) => ({ ...p, status: st }))}
                  style={[styles.chip, form.status === st && { backgroundColor: COLORS.primary, borderColor: COLORS.primary }]}
                >
                  <Text style={[styles.chipText, form.status === st && { color: '#fff' }]}>{st}</Text>
                </TouchableOpacity>
              ))}
            </View>
            {form.status === 'Converted' && (
              <>
                <Text style={styles.label}>TRANSACTION ID / UTR *</Text>
                <TextInput value={form.transactionId} onChangeText={(v) => setForm((p) => ({ ...p, transactionId: v }))} placeholder="Enter payment transaction reference" placeholderTextColor="#94a3b8" style={styles.input} />
              </>
            )}
            {form.status === 'Call Back' && (
              <>
                <Text style={styles.label}>NEXT CALLBACK DATE & TIME *</Text>
                <DateTimeField
                  value={form.callBackDt}
                  onChange={(v) => setForm((p) => ({ ...p, callBackDt: v }))}
                  minimumDate={new Date()}
                  placeholder="Select callback date & time"
                />
              </>
            )}
            <Text style={styles.label}>LEAD DATE & TIME (CREATED AT) *</Text>
            <DateTimeField
              value={form.createdAt}
              onChange={(v) => setForm((p) => ({ ...p, createdAt: v }))}
              placeholder="Select lead date & time"
            />
            {['tl', 'admin', 'superadmin'].includes(user?.role) && (
              <>
                <Text style={styles.label}>ASSIGN LEAD TO AGENT *</Text>
                <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginBottom: 10 }}>
                  <TouchableOpacity
                    onPress={() => setForm((p) => ({ ...p, assignedTo: user?._id || user?.id }))}
                    style={[
                      styles.chip,
                      { marginRight: 6 },
                      form.assignedTo === (user?._id || user?.id) && { backgroundColor: COLORS.primary, borderColor: COLORS.primary },
                    ]}
                  >
                    <Text style={[styles.chipText, form.assignedTo === (user?._id || user?.id) && { color: '#fff' }]}>
                      {user?.name || 'Self'} (Self)
                    </Text>
                  </TouchableOpacity>
                  {agents.map((a) => {
                    const aid = a._id || a.id;
                    const active = form.assignedTo === aid;
                    return (
                      <TouchableOpacity
                        key={aid}
                        onPress={() => setForm((p) => ({ ...p, assignedTo: aid }))}
                        style={[styles.chip, { marginRight: 6 }, active && { backgroundColor: COLORS.primary, borderColor: COLORS.primary }]}
                      >
                        <Text style={[styles.chipText, active && { color: '#fff' }]}>{a.name}</Text>
                      </TouchableOpacity>
                    );
                  })}
                </ScrollView>
              </>
            )}
            <Text style={styles.label}>REMARKS & CLIENT NOTES</Text>
            <TextInput value={form.remarks} onChangeText={(v) => setForm((p) => ({ ...p, remarks: v }))} multiline placeholder="Enter conversation details or payment notes..." placeholderTextColor="#94a3b8" style={[styles.input, { height: 74, paddingTop: 10, textAlignVertical: 'top' }]} />
            <GradientButton title="Create Lead" onPress={handleSave} loading={submitting} />
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
};

export const CallActionModal = ({ lead, onClose, onSubmit }) => {
  const [action, setAction] = useState(null); // 'Lead' | 'Not Interested'
  const [scanning, setScanning] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [formData, setFormData] = useState({
    leadAmount: '',
    status: '',
    transactionId: '',
    callBackDt: '',
    remarks: '',
    receiptImage: '',
  });

  useEffect(() => {
    if (lead) {
      setAction(null);
      setFormData({
        leadAmount: '',
        status: '',
        transactionId: '',
        callBackDt: '',
        remarks: '',
        receiptImage: '',
      });
    }
  }, [lead]);

  if (!lead) return null;

  const handleReceiptPick = async (useCamera) => {
    const picked = await pickAndExtractReceipt(useCamera);
    if (!picked) return;
    setFormData((p) => ({ ...p, receiptImage: picked.base64DataUrl }));
    setScanning(true);
    try {
      const res = await api.post('/leads/extract-transaction', { imageBase64: picked.base64DataUrl });
      if (res.data?.success && res.data.transactionId) {
        const txId = res.data.transactionId;
        const amount = res.data.amount;
        setFormData((p) => {
          let updatedRemarks = p.remarks || '';
          const prefix = `[Auto-converted via receipt scan] Transaction ID: ${txId}${amount ? ` (Amount updated to ₹${amount})` : ''}`;
          if (!updatedRemarks.includes('[Auto-converted via receipt scan]')) {
            updatedRemarks = prefix + (updatedRemarks ? ` - ${updatedRemarks}` : '');
          }
          return {
            ...p,
            status: 'Converted',
            transactionId: txId,
            leadAmount: amount ? String(amount) : p.leadAmount,
            remarks: updatedRemarks,
          };
        });
      }
    } catch {
      Alert.alert('OCR Error', 'Could not auto-extract transaction ID. Please enter manually.');
    } finally {
      setScanning(false);
    }
  };

  const handleSave = async () => {
    if (action === 'Lead') {
      if (!formData.leadAmount) return Alert.alert('Required', 'Lead Amount is required.');
      if (!formData.status) return Alert.alert('Required', 'Status is required.');
      if (formData.status === 'Converted' && !formData.transactionId.trim()) {
        return Alert.alert('Required', 'Transaction ID / UTR is required.');
      }
      if (formData.status === 'Call Back' && !formData.callBackDt) {
        return Alert.alert('Required', 'Callback Date & Time is required.');
      }
    }
    if (!formData.remarks.trim()) {
      return Alert.alert('Required', 'Remarks are required.');
    }

    setSubmitting(true);
    try {
      const payload = {
        action,
        ...formData,
        ...(formData.callBackDt ? { callBackDt: new Date(formData.callBackDt).toISOString() } : {}),
      };
      await onSubmit(payload);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Modal visible={!!lead} transparent animationType="slide" onRequestClose={onClose}>
      <View style={styles.overlay}>
        <View style={styles.sheet}>
          <View style={styles.header}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
              <PhoneCall size={19} color={COLORS.primary} />
              <View>
                <Text style={styles.title}>Log Call Action</Text>
                <Text style={{ fontSize: 12, color: COLORS.textMuted }}>{getContactName(lead.fields)}</Text>
              </View>
            </View>
            <TouchableOpacity onPress={onClose}><X size={20} color={COLORS.textMuted} /></TouchableOpacity>
          </View>

          <ScrollView showsVerticalScrollIndicator={false}>
            {!action ? (
              <View style={{ gap: 10, paddingVertical: 6 }}>
                <Text style={styles.sub}>
                  Select an action. A new workflow record will be generated for this contact.
                </Text>
                <TouchableOpacity
                  onPress={() => setAction('Lead')}
                  style={[styles.choiceBtn, { borderColor: COLORS.success, backgroundColor: COLORS.successLight }]}
                >
                  <Star size={20} color={COLORS.success} />
                  <View style={{ flex: 1 }}>
                    <Text style={[styles.choiceTitle, { color: COLORS.success }]}>Convert to Lead</Text>
                    <Text style={styles.choiceSub}>Create a new successful lead record</Text>
                  </View>
                </TouchableOpacity>
                <TouchableOpacity
                  onPress={() => setAction('Not Interested')}
                  style={[styles.choiceBtn, { borderColor: COLORS.danger, backgroundColor: COLORS.dangerLight }]}
                >
                  <XCircle size={20} color={COLORS.danger} />
                  <View style={{ flex: 1 }}>
                    <Text style={[styles.choiceTitle, { color: COLORS.danger }]}>Not Interested</Text>
                    <Text style={styles.choiceSub}>Log a rejection</Text>
                  </View>
                </TouchableOpacity>
              </View>
            ) : (
              <View>
                <TouchableOpacity onPress={() => setAction(null)} style={styles.backStepBtn}>
                  <ArrowLeft size={14} color={COLORS.primary} />
                  <Text style={{ fontSize: 12.5, fontWeight: '800', color: COLORS.primary }}>
                    Back ({action})
                  </Text>
                </TouchableOpacity>

                {action === 'Lead' && (
                  <>
                    <View style={styles.rowBtns}>
                      <TouchableOpacity onPress={() => handleReceiptPick(true)} style={styles.pickerBtn}>
                        <Camera size={16} color={COLORS.primary} />
                        <Text style={styles.pickerBtnText}>Camera OCR</Text>
                      </TouchableOpacity>
                      <TouchableOpacity onPress={() => handleReceiptPick(false)} style={styles.pickerBtn}>
                        <ImageIcon size={16} color={COLORS.primary} />
                        <Text style={styles.pickerBtnText}>Gallery OCR</Text>
                      </TouchableOpacity>
                    </View>
                    {scanning && <ActivityIndicator size="small" color={COLORS.primary} style={{ marginBottom: 8 }} />}

                    <Text style={styles.label}>LEAD AMOUNT (₹) *</Text>
                    <TextInput keyboardType="numeric" value={formData.leadAmount} onChangeText={(v) => setFormData((p) => ({ ...p, leadAmount: v }))} placeholder="Amount" placeholderTextColor="#94a3b8" style={styles.input} />

                    <Text style={styles.label}>STATUS *</Text>
                    <View style={styles.chipGrid}>
                      {LEAD_STATUS_OPTIONS.map((st) => (
                        <TouchableOpacity
                          key={st}
                          onPress={() => setFormData((p) => ({ ...p, status: st }))}
                          style={[styles.chip, formData.status === st && { backgroundColor: COLORS.primary, borderColor: COLORS.primary }]}
                        >
                          <Text style={[styles.chipText, formData.status === st && { color: '#fff' }]}>{st}</Text>
                        </TouchableOpacity>
                      ))}
                    </View>

                    {formData.status === 'Converted' && (
                      <>
                        <Text style={styles.label}>TRANSACTION ID / UTR *</Text>
                        <TextInput value={formData.transactionId} onChangeText={(v) => setFormData((p) => ({ ...p, transactionId: v }))} placeholder="UTR / Transaction ID" placeholderTextColor="#94a3b8" style={styles.input} />
                      </>
                    )}

                    {formData.status === 'Call Back' && (
                      <>
                        <Text style={styles.label}>CALLBACK DATE & TIME *</Text>
                        <DateTimeField
                          value={formData.callBackDt}
                          onChange={(v) => setFormData((p) => ({ ...p, callBackDt: v }))}
                          minimumDate={new Date()}
                          placeholder="Select callback date & time"
                        />
                      </>
                    )}
                  </>
                )}

                <Text style={styles.label}>REMARKS *</Text>
                <TextInput
                  multiline
                  value={formData.remarks}
                  onChangeText={(v) => setFormData((p) => ({ ...p, remarks: v }))}
                  placeholder="Enter call notes..."
                  placeholderTextColor="#94a3b8"
                  style={[styles.input, { height: 78, paddingTop: 10, textAlignVertical: 'top' }]}
                />

                <GradientButton title="Save & Clone Record" onPress={handleSave} loading={submitting} />
              </View>
            )}
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
};

export const LeadDetailModal = ({
  lead,
  rowNumber,
  user,
  onClose,
  onStatusSelect,
  onOpenReceipt,
  onOpenCharityConfirm,
  onOpenCallAction,
  onDelete,
}) => {
  const [activeTab, setActiveTab] = useState('details'); // 'details' | 'c360' | 'history'
  const [c360, setC360] = useState(null);
  const [loadingC360, setLoadingC360] = useState(false);
  const [history, setHistory] = useState([]);
  const [loadingHist, setLoadingHist] = useState(false);
  const [copied, setCopied] = useState(null);

  const phone = getContactPhone(lead?.fields);
  const cleanPhone = String(phone || '').replace(/\D/g, '');

  useEffect(() => {
    if (!lead) return;
    setActiveTab('details');
    if (!cleanPhone) {
      setC360(null);
      setHistory([]);
      return;
    }
    setLoadingC360(true);
    api.get(`/contacts/customer-360/${encodeURIComponent(cleanPhone)}`)
      .then((res) => setC360(res.data))
      .catch(() => setC360(null))
      .finally(() => setLoadingC360(false));

    setLoadingHist(true);
    api.get(`/leads/history/${encodeURIComponent(cleanPhone)}`)
      .then((res) => setHistory(Array.isArray(res.data) ? res.data : []))
      .catch(() => setHistory([]))
      .finally(() => setLoadingHist(false));
  }, [lead?._id, lead?.id, cleanPhone]);

  if (!lead) return null;

  const fields = lead.fields || {};
  const name = getContactName(fields);
  const email = getContactEmail(fields);
  const leadId = lead._id || lead.id;
  const isConverted = lead.status === 'Converted';
  const isLocked = isConverted;
  const isAdmin = user?.role === 'admin' || user?.role === 'superadmin';
  const hasActiveLeadInHistory =
    Array.isArray(lead.historyStatuses) &&
    lead.historyStatuses.some((s) => s !== 'Converted' && s !== 'Not Interested');
  const isCallButtonLocked = hasActiveLeadInHistory && lead.status !== 'Call Back';
  const effAmt =
    lead.isCharityConfirmed && lead.charityAmount !== null && lead.charityAmount !== undefined
      ? lead.charityAmount
      : lead.leadAmount;

  const copyField = async (val, key) => {
    if (!val) return;
    await Clipboard.setStringAsync(String(val)).catch(() => {});
    setCopied(key);
    setTimeout(() => setCopied(null), 1500);
  };

  return (
    <Modal visible={!!lead} transparent animationType="slide" onRequestClose={onClose}>
      <View style={styles.overlay}>
        <View style={[styles.sheet, { maxHeight: '92%' }]}>
          {/* Header */}
          <View style={styles.header}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, flex: 1 }}>
              {rowNumber !== undefined && rowNumber !== null && (
                <Badge label={`#${rowNumber}`} color={COLORS.primary} bg={COLORS.primaryLight} />
              )}
              <View style={{ flex: 1 }}>
                <Text style={styles.title} numberOfLines={1}>{name}</Text>
                <Text style={{ fontSize: 11.5, color: COLORS.textMuted }}>
                  {lead.agentName || 'Agent'} • {formatDateTime(lead.conversionDate || lead.createdAt)}
                </Text>
              </View>
            </View>
            <TouchableOpacity onPress={onClose}><X size={20} color={COLORS.textMuted} /></TouchableOpacity>
          </View>

          {/* Action Toolbar */}
          <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ maxHeight: 44, marginBottom: 10 }} contentContainerStyle={{ gap: 8, alignItems: 'center' }}>
            {!!phone && (
              <>
                <TouchableOpacity
                  disabled={isCallButtonLocked}
                  onPress={() => {
                    onClose();
                    if (onOpenCallAction) onOpenCallAction(lead);
                    openDialer(phone);
                  }}
                  style={[styles.actionPill, { backgroundColor: isCallButtonLocked ? '#e2e8f0' : COLORS.successLight }]}
                >
                  <PhoneCall size={14} color={isCallButtonLocked ? COLORS.textMuted : COLORS.success} />
                  <Text style={{ color: isCallButtonLocked ? COLORS.textMuted : COLORS.success, fontWeight: '800', fontSize: 12 }}>
                    {isCallButtonLocked ? 'Call Locked' : 'Call Lead'}
                  </Text>
                </TouchableOpacity>
                <TouchableOpacity onPress={() => openWhatsApp(phone)} style={[styles.actionPill, { backgroundColor: 'rgba(34,197,94,0.12)' }]}>
                  <MessageCircle size={14} color="#16a34a" />
                  <Text style={{ color: '#16a34a', fontWeight: '800', fontSize: 12 }}>WhatsApp</Text>
                </TouchableOpacity>
              </>
            )}
            {!isLocked && user?.role !== 'admin' && onOpenReceipt && (
              <TouchableOpacity onPress={() => { onClose(); onOpenReceipt(lead); }} style={[styles.actionPill, { backgroundColor: COLORS.primaryLight }]}>
                <ImageIcon size={14} color={COLORS.primary} />
                <Text style={{ color: COLORS.primary, fontWeight: '800', fontSize: 12 }}>Scan Receipt</Text>
              </TouchableOpacity>
            )}
            {!lead.isCharityConfirmed && (lead.status === 'Converted' || lead.transactionId) && onOpenCharityConfirm && (
              <TouchableOpacity onPress={() => { onClose(); onOpenCharityConfirm(lead); }} style={[styles.actionPill, { backgroundColor: COLORS.successLight }]}>
                <ShieldCheck size={14} color={COLORS.success} />
                <Text style={{ color: COLORS.success, fontWeight: '800', fontSize: 12 }}>Confirm by Charity</Text>
              </TouchableOpacity>
            )}
            {!isLocked && onStatusSelect && (
              <TouchableOpacity onPress={() => { onClose(); onStatusSelect(lead, lead.status || 'Others'); }} style={[styles.actionPill, { backgroundColor: '#f1f5f9' }]}>
                <Edit3 size={14} color={COLORS.textSecondary} />
                <Text style={{ color: COLORS.textSecondary, fontWeight: '800', fontSize: 12 }}>Edit Remarks</Text>
              </TouchableOpacity>
            )}
            {isAdmin && onDelete && (
              <TouchableOpacity onPress={() => { onClose(); onDelete(leadId); }} style={[styles.actionPill, { backgroundColor: COLORS.dangerLight }]}>
                <Trash2 size={14} color={COLORS.danger} />
                <Text style={{ color: COLORS.danger, fontWeight: '800', fontSize: 12 }}>Delete</Text>
              </TouchableOpacity>
            )}
          </ScrollView>

          {/* 3 Tabs */}
          <View style={styles.tabsRow}>
            {[
              { key: 'details', label: 'Details', Icon: FileText },
              { key: 'c360', label: `360 (${c360?.timeline?.length || 0})`, Icon: TrendingUp },
              { key: 'history', label: `History (${history.length})`, Icon: Layers },
            ].map(({ key, label, Icon }) => {
              const active = activeTab === key;
              return (
                <TouchableOpacity
                  key={key}
                  onPress={() => setActiveTab(key)}
                  style={[styles.tabBtn, active && styles.tabBtnActive]}
                >
                  <Icon size={13} color={active ? '#fff' : COLORS.textSecondary} />
                  <Text style={[styles.tabBtnTxt, active && { color: '#fff' }]}>{label}</Text>
                </TouchableOpacity>
              );
            })}
          </View>

          <ScrollView showsVerticalScrollIndicator={false}>
            {activeTab === 'details' && (
              <>
                <View style={styles.metricsGrid}>
                  <View style={styles.metricBox}>
                    <Text style={styles.metricLbl}>LEAD AMOUNT</Text>
                    <Text style={[styles.metricVal, { color: COLORS.success }]}>{formatCurrency(effAmt)}</Text>
                    {lead.isCharityConfirmed && (
                      <Text style={styles.metricSub}>Agent: {formatCurrency(lead.leadAmount)}</Text>
                    )}
                  </View>
                  <View style={styles.metricBox}>
                    <Text style={styles.metricLbl}>CHARITY / UTR</Text>
                    <Text style={styles.metricVal} numberOfLines={1}>{lead.utrCharity || lead.transactionId || 'None'}</Text>
                    <Text style={styles.metricSub}>{lead.isCharityConfirmed ? '✓ Confirmed' : 'Internal ref'}</Text>
                  </View>
                  <View style={styles.metricBox}>
                    <Text style={styles.metricLbl}>STATUS</Text>
                    <Text style={[styles.metricVal, { color: COLORS.primary }]}>{lead.status || 'Active'}</Text>
                    <Text style={styles.metricSub}>{formatDateOnly(lead.lastModified || lead.createdAt)}</Text>
                  </View>
                  <View style={styles.metricBox}>
                    <Text style={styles.metricLbl}>SOURCE</Text>
                    <Text style={styles.metricVal}>{fields.manuallyCreated ? 'Manual' : 'Batch'}</Text>
                    <Text style={styles.metricSub}>{lead.agentName || 'Unassigned'}</Text>
                  </View>
                </View>

                <View style={styles.detailCard}>
                  <TouchableOpacity onPress={() => copyField(name, 'name')} style={styles.copyRow}>
                    <Text style={styles.detailRow}>Name: <Text style={{ fontWeight: '700' }}>{name}</Text></Text>
                    {copied === 'name' ? <Check size={14} color={COLORS.success} /> : <Copy size={14} color={COLORS.textMuted} />}
                  </TouchableOpacity>
                  <TouchableOpacity onPress={() => copyField(phone, 'phone')} style={styles.copyRow}>
                    <Text style={styles.detailRow}>Phone: <Text style={{ fontWeight: '700', color: COLORS.primary }}>{phone || '—'}</Text></Text>
                    {copied === 'phone' ? <Check size={14} color={COLORS.success} /> : <Copy size={14} color={COLORS.textMuted} />}
                  </TouchableOpacity>
                  <Text style={styles.detailRow}>Email: {email || '—'}</Text>
                  {!!lead.callBackDt && <Text style={[styles.detailRow, { color: COLORS.cyan }]}>Callback: {formatDateTime(lead.callBackDt)}</Text>}
                  {!!lead.appointmentDt && <Text style={[styles.detailRow, { color: COLORS.violet }]}>Appointment: {formatDateTime(lead.appointmentDt)}</Text>}
                </View>

                {!isLocked && onStatusSelect && (
                  <>
                    <Text style={styles.label}>CHANGE STATUS</Text>
                    <View style={styles.chipGrid}>
                      {LEAD_STATUS_OPTIONS.map((st) => (
                        <TouchableOpacity
                          key={st}
                          onPress={() => { onClose(); onStatusSelect(lead, st); }}
                          style={[styles.chip, lead.status === st && { backgroundColor: COLORS.primary, borderColor: COLORS.primary }]}
                        >
                          <Text style={[styles.chipText, lead.status === st && { color: '#fff' }]}>{st}</Text>
                        </TouchableOpacity>
                      ))}
                    </View>
                  </>
                )}

                <View style={styles.remarksBox}>
                  <Text style={styles.label}>REMARKS</Text>
                  <Text style={{ fontSize: 13, color: COLORS.textSecondary, lineHeight: 19 }}>
                    {lead.remarks || lead.statusDetails || 'No remarks recorded yet.'}
                  </Text>
                </View>

                {/* Additional Dynamic Fields */}
                {Object.entries(fields)
                  .filter(([k]) => !['Name', 'name', 'Phone', 'phone', 'Mobile', 'mobile', 'Email', 'email', 'manuallyCreated', 'createdByName'].includes(k))
                  .length > 0 && (
                  <View style={styles.detailCard}>
                    <Text style={styles.label}>ADDITIONAL FIELDS</Text>
                    {Object.entries(fields)
                      .filter(([k]) => !['Name', 'name', 'Phone', 'phone', 'Mobile', 'mobile', 'Email', 'email', 'manuallyCreated', 'createdByName'].includes(k))
                      .map(([k, v]) => (
                        <Text key={k} style={styles.detailRow}>{k}: {v !== null && v !== undefined && v !== '' ? String(v) : '—'}</Text>
                      ))}
                  </View>
                )}
              </>
            )}

            {activeTab === 'c360' && (
              loadingC360 ? (
                <ActivityIndicator size="small" color={COLORS.primary} style={{ marginVertical: 28 }} />
              ) : !c360 ? (
                <Text style={styles.emptyTxt}>No Customer 360 history found.</Text>
              ) : (
                <View style={{ gap: 10, paddingBottom: 16 }}>
                  <View style={styles.metricsGrid}>
                    <View style={styles.metricBox}><Text style={styles.metricLbl}>LEADS</Text><Text style={styles.metricVal}>{c360.leadsCount || 0}</Text></View>
                    <View style={styles.metricBox}><Text style={styles.metricLbl}>CONTACTS</Text><Text style={styles.metricVal}>{c360.contactsCount || 0}</Text></View>
                    <View style={styles.metricBox}><Text style={styles.metricLbl}>CALLBACKS</Text><Text style={styles.metricVal}>{c360.callbacksCount || 0}</Text></View>
                    <View style={styles.metricBox}><Text style={styles.metricLbl}>APPTS</Text><Text style={styles.metricVal}>{c360.appointmentsCount || 0}</Text></View>
                  </View>
                  {c360.hasConvertedLead && (c360.convertedLeads || []).map((c, i) => (
                    <View key={i} style={[styles.detailCard, { backgroundColor: 'rgba(16,185,129,0.08)', borderWidth: 1, borderColor: '#a7f3d0' }]}>
                      <Text style={{ fontWeight: '900', color: COLORS.success, fontSize: 12.5 }}>
                        🌟 Converted • {formatCurrency(c.isCharityConfirmed && c.charityAmount ? c.charityAmount : c.leadAmount)}
                      </Text>
                      <Text style={styles.detailRow}>UTR: {c.utrCharity || c.transactionId || 'N/A'} • By {c.agentName || 'Agent'}</Text>
                    </View>
                  ))}
                  {(c360.timeline || []).map((entry, idx) => (
                    <View key={idx} style={styles.histCard}>
                      <Text style={{ fontWeight: '800', fontSize: 12.5, color: COLORS.primary }}>
                        {entry.label || 'Interaction'} {entry.agent ? `• ${entry.agent}` : ''}
                      </Text>
                      {!!entry.date && <Text style={{ fontSize: 11, color: COLORS.textMuted }}>{formatDateTime(entry.date)}</Text>}
                      {!!entry.content && <Text style={{ fontSize: 12.5, color: COLORS.textSecondary, marginTop: 3 }}>{entry.content}</Text>}
                    </View>
                  ))}
                </View>
              )
            )}

            {activeTab === 'history' && (
              loadingHist ? (
                <ActivityIndicator size="small" color={COLORS.primary} style={{ marginVertical: 28 }} />
              ) : history.length === 0 ? (
                <Text style={styles.emptyTxt}>No historical conversion records found.</Text>
              ) : (
                <View style={{ gap: 10, paddingBottom: 16 }}>
                  {history.map((h, idx) => (
                    <View key={h._id || h.id || idx} style={styles.histCard}>
                      <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
                        <Badge label={h.status || 'Lead'} color={h.status === 'Converted' ? COLORS.success : COLORS.primary} bg={h.status === 'Converted' ? COLORS.successLight : COLORS.primaryLight} />
                        <Text style={{ fontWeight: '900', color: COLORS.textPrimary }}>
                          {formatCurrency(h.isCharityConfirmed && h.charityAmount !== null ? h.charityAmount : h.leadAmount)}
                        </Text>
                      </View>
                      <Text style={{ fontSize: 12, color: COLORS.textMuted, marginTop: 4 }}>
                        Handled by {h.agentName || 'Agent'} • {formatDateTime(h.createdAt)}
                      </Text>
                      {!!h.transactionId && <Text style={{ fontSize: 12, fontWeight: '700', color: COLORS.success, marginTop: 2 }}>UTR: {h.transactionId}</Text>}
                      {!!h.remarks && <Text style={{ fontSize: 12.5, color: COLORS.textSecondary, marginTop: 4 }}>{h.remarks}</Text>}
                      {h.status !== 'Converted' && (
                        <View style={{ flexDirection: 'row', gap: 8, marginTop: 8 }}>
                          {onStatusSelect && (
                            <TouchableOpacity onPress={() => { onClose(); onStatusSelect(h, h.status || 'Others'); }} style={[styles.miniPill]}>
                              <Text style={styles.miniPillTxt}>Update Status</Text>
                            </TouchableOpacity>
                          )}
                          {onOpenReceipt && user?.role !== 'admin' && (
                            <TouchableOpacity onPress={() => { onClose(); onOpenReceipt(h); }} style={[styles.miniPill]}>
                              <Text style={styles.miniPillTxt}>Receipt OCR</Text>
                            </TouchableOpacity>
                          )}
                        </View>
                      )}
                    </View>
                  ))}
                </View>
              )
            )}
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
};

export const ConversionHistoryModal = ({
  contact,
  historyData = [],
  loading = false,
  user,
  onClose,
  onStatusSelect,
  onOpenReceipt,
  onOpenCharityConfirm,
  onRefreshHistory,
}) => {
  const [selectedIds, setSelectedIds] = useState([]);
  const isAdmin = user?.role === 'admin' || user?.role === 'superadmin';

  useEffect(() => {
    setSelectedIds([]);
  }, [contact]);

  if (!contact) return null;

  const toggleId = (id) => {
    setSelectedIds((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  };

  const handleBulkDelete = () => {
    Alert.alert('Delete History', `Delete ${selectedIds.length} selected history records?`, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: async () => {
          try {
            await api.post('/leads/bulk-delete', { ids: selectedIds });
            setSelectedIds([]);
            if (onRefreshHistory) onRefreshHistory();
          } catch {
            Alert.alert('Error', 'Failed to delete history records.');
          }
        },
      },
    ]);
  };

  return (
    <Modal visible={!!contact} transparent animationType="slide" onRequestClose={onClose}>
      <View style={styles.overlay}>
        <View style={[styles.sheet, { maxHeight: '88%' }]}>
          <View style={styles.header}>
            <View style={{ flex: 1 }}>
              <Text style={styles.title}>Conversion History</Text>
              <Text style={styles.sub}>{contact.name} ({contact.phone})</Text>
            </View>
            {isAdmin && selectedIds.length > 0 && (
              <TouchableOpacity onPress={handleBulkDelete} style={[styles.actionPill, { backgroundColor: COLORS.danger, marginRight: 8 }]}>
                <Trash2 size={14} color="#fff" />
                <Text style={{ color: '#fff', fontSize: 12, fontWeight: '800' }}>({selectedIds.length})</Text>
              </TouchableOpacity>
            )}
            <TouchableOpacity onPress={onClose}><X size={20} color={COLORS.textMuted} /></TouchableOpacity>
          </View>

          <ScrollView showsVerticalScrollIndicator={false}>
            {loading ? (
              <ActivityIndicator size="large" color={COLORS.primary} style={{ marginVertical: 30 }} />
            ) : historyData.length === 0 ? (
              <Text style={styles.emptyTxt}>No historical records found.</Text>
            ) : (
              historyData.map((h, i) => {
                const hid = h._id || h.id;
                const checked = selectedIds.includes(hid);
                return (
                  <View key={hid || i} style={styles.histCard}>
                    <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
                      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                        {isAdmin && (
                          <TouchableOpacity onPress={() => toggleId(hid)} style={[styles.checkBox, checked && styles.checkBoxActive]}>
                            {checked && <Check size={12} color="#fff" />}
                          </TouchableOpacity>
                        )}
                        <Badge label={h.status || 'Lead'} color={h.status === 'Converted' ? COLORS.success : COLORS.primary} bg={h.status === 'Converted' ? COLORS.successLight : COLORS.primaryLight} />
                      </View>
                      <Text style={{ fontWeight: '900', color: COLORS.textPrimary }}>
                        {formatCurrency(h.isCharityConfirmed && h.charityAmount !== null ? h.charityAmount : h.leadAmount)}
                      </Text>
                    </View>
                    <Text style={{ fontSize: 12, color: COLORS.textMuted, marginTop: 4 }}>
                      Handled by: {h.agentName || 'Agent'} • {formatDateTime(h.createdAt)}
                    </Text>
                    {!!h.transactionId && (
                      <Text style={{ fontSize: 12, fontWeight: '700', color: COLORS.success, marginTop: 2 }}>
                        UTR-Internal: {h.transactionId}
                      </Text>
                    )}
                    {h.isCharityConfirmed && !!h.utrCharity && (
                      <Text style={{ fontSize: 12, fontWeight: '800', color: COLORS.success }}>
                        ✓ UTR-Charity: {h.utrCharity}
                      </Text>
                    )}
                    {!!h.remarks && <Text style={{ fontSize: 12.5, color: COLORS.textSecondary, marginTop: 4 }}>{h.remarks}</Text>}

                    <View style={{ flexDirection: 'row', gap: 8, marginTop: 8, flexWrap: 'wrap' }}>
                      {h.status !== 'Converted' && onStatusSelect && (
                        <TouchableOpacity onPress={() => { onClose(); onStatusSelect(h, h.status || 'Others'); }} style={styles.miniPill}>
                          <Text style={styles.miniPillTxt}>Change Status</Text>
                        </TouchableOpacity>
                      )}
                      {h.status !== 'Converted' && onOpenReceipt && user?.role !== 'admin' && (
                        <TouchableOpacity onPress={() => { onClose(); onOpenReceipt(h); }} style={styles.miniPill}>
                          <Text style={styles.miniPillTxt}>Receipt OCR</Text>
                        </TouchableOpacity>
                      )}
                      {!h.isCharityConfirmed && (h.status === 'Converted' || h.transactionId) && onOpenCharityConfirm && (
                        <TouchableOpacity onPress={() => { onClose(); onOpenCharityConfirm(h); }} style={[styles.miniPill, { backgroundColor: COLORS.successLight }]}>
                          <Text style={[styles.miniPillTxt, { color: COLORS.success }]}>✓ Confirm Charity</Text>
                        </TouchableOpacity>
                      )}
                    </View>
                  </View>
                );
              })
            )}
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
};

export const DuplicateLeadModal = ({ duplicateInfo, onClose }) => {
  if (!duplicateInfo) return null;
  const list = Array.isArray(duplicateInfo.duplicates) ? duplicateInfo.duplicates : [];

  return (
    <Modal visible={!!duplicateInfo} transparent animationType="fade" onRequestClose={onClose}>
      <View style={styles.centerOverlay}>
        <View style={[styles.centerBox, { borderWidth: 2, borderColor: COLORS.danger }]}>
          <View style={styles.header}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
              <AlertTriangle size={22} color={COLORS.danger} />
              <Text style={[styles.title, { color: COLORS.danger }]}>Duplicate Lead Detected!</Text>
            </View>
            <TouchableOpacity onPress={onClose}><X size={20} color={COLORS.textMuted} /></TouchableOpacity>
          </View>
          <Text style={styles.sub}>
            Lead created, but {list.length} existing lead(s) matched the same contact, minute, and transaction ID:
          </Text>
          <ScrollView style={{ maxHeight: 200, marginBottom: 12 }}>
            {list.map((d, idx) => (
              <View key={d.id || idx} style={styles.histCard}>
                <Text style={{ fontWeight: '800', color: COLORS.textPrimary }}>Handled by: {d.agentName}</Text>
                <Text style={{ fontSize: 12, color: COLORS.textMuted }}>{formatDateTime(d.createdAt)} • {formatCurrency(d.leadAmount)} ({d.status})</Text>
              </View>
            ))}
          </ScrollView>
          <GradientButton title="I Acknowledge" onPress={onClose} />
        </View>
      </View>
    </Modal>
  );
};

const styles = StyleSheet.create({
  overlay: { flex: 1, backgroundColor: 'rgba(15,23,42,0.6)', justifyContent: 'flex-end' },
  centerOverlay: { flex: 1, backgroundColor: 'rgba(15,23,42,0.65)', justifyContent: 'center', padding: 20 },
  centerBox: { backgroundColor: '#fff', borderRadius: 20, padding: 18 },
  sheet: { backgroundColor: '#fff', borderTopLeftRadius: 24, borderTopRightRadius: 24, maxHeight: '88%', padding: 18 },
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 },
  title: { fontSize: 17, fontWeight: '800', color: COLORS.textPrimary },
  sub: { fontSize: 12.5, color: COLORS.textMuted, marginBottom: 12, lineHeight: 18 },
  rowBtns: { flexDirection: 'row', gap: 10, marginBottom: 12, flexWrap: 'wrap' },
  pickerBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    height: 42,
    borderRadius: 10,
    backgroundColor: COLORS.primaryLight,
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  pickerBtnText: { fontSize: 13, fontWeight: '700', color: COLORS.primary },
  scanRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 8 },
  scanText: { fontSize: 12.5, color: COLORS.primary, fontWeight: '600' },
  scanMsg: { fontSize: 12, color: COLORS.textSecondary, marginBottom: 10 },
  previewImg: { width: '100%', height: 150, borderRadius: 12, backgroundColor: '#f8fafc', marginBottom: 12 },
  label: { fontSize: 10.5, fontWeight: '800', color: COLORS.textSecondary, letterSpacing: 0.6, marginBottom: 5 },
  input: {
    height: 42,
    backgroundColor: '#f8fafc',
    borderWidth: 1.5,
    borderColor: '#e2e8f0',
    borderRadius: 10,
    paddingHorizontal: 12,
    fontSize: 13.5,
    color: COLORS.textPrimary,
    marginBottom: 12,
  },
  chipGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 7, marginBottom: 12 },
  chip: { paddingHorizontal: 11, paddingVertical: 7, borderRadius: 999, borderWidth: 1, borderColor: '#cbd5e1', backgroundColor: '#f8fafc' },
  chipText: { fontSize: 12, fontWeight: '700', color: COLORS.textSecondary },
  detailCard: { backgroundColor: '#f8fafc', borderRadius: 14, padding: 14, marginBottom: 12, gap: 6 },
  detailRow: { fontSize: 13.5, color: COLORS.textPrimary, fontWeight: '500' },
  copyRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  actionPill: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 12, paddingVertical: 8, borderRadius: 10 },
  remarksBox: { backgroundColor: '#f8fafc', borderRadius: 12, padding: 12, marginBottom: 12 },
  choiceBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    padding: 16,
    borderRadius: 14,
    borderWidth: 1.5,
  },
  choiceTitle: { fontSize: 15, fontWeight: '800' },
  choiceSub: { fontSize: 12, color: COLORS.textMuted, marginTop: 2 },
  backStepBtn: { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 12 },
  tabsRow: { flexDirection: 'row', gap: 6, marginBottom: 12 },
  tabBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 5,
    paddingVertical: 9,
    borderRadius: 10,
    backgroundColor: '#f1f5f9',
  },
  tabBtnActive: { backgroundColor: COLORS.primary },
  tabBtnTxt: { fontSize: 12, fontWeight: '700', color: COLORS.textSecondary },
  metricsGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 12 },
  metricBox: {
    flex: 1,
    minWidth: '46%',
    backgroundColor: '#f8fafc',
    borderRadius: 12,
    padding: 10,
    borderWidth: 1,
    borderColor: '#e2e8f0',
  },
  metricLbl: { fontSize: 9.5, fontWeight: '800', color: COLORS.textMuted, letterSpacing: 0.5 },
  metricVal: { fontSize: 15, fontWeight: '900', color: COLORS.textPrimary, marginTop: 2 },
  metricSub: { fontSize: 10.5, color: COLORS.textMuted, marginTop: 1 },
  histCard: {
    backgroundColor: '#f8fafc',
    borderRadius: 12,
    padding: 12,
    borderWidth: 1,
    borderColor: '#e2e8f0',
    marginBottom: 8,
  },
  miniPill: {
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 8,
    backgroundColor: COLORS.primaryLight,
  },
  miniPillTxt: { fontSize: 11.5, fontWeight: '800', color: COLORS.primary },
  emptyTxt: { textAlign: 'center', color: COLORS.textMuted, paddingVertical: 24, fontSize: 13 },
  checkBox: {
    width: 18,
    height: 18,
    borderRadius: 5,
    borderWidth: 1.5,
    borderColor: COLORS.borderSlate,
    alignItems: 'center',
    justifyContent: 'center',
  },
  checkBoxActive: { backgroundColor: COLORS.primary, borderColor: COLORS.primary },
});
