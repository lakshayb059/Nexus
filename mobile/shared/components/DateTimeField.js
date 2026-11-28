import React, { useState } from 'react';
import { View, Text, TouchableOpacity, Platform, Modal, StyleSheet } from 'react-native';
import DateTimePicker, { DateTimePickerAndroid } from '@react-native-community/datetimepicker';
import { COLORS } from '../theme';
import { Calendar, X } from 'lucide-react-native';

function formatDisplay(val, mode) {
  if (!val) return '';
  const d = new Date(val);
  if (isNaN(d.getTime())) return String(val);
  if (mode === 'date') {
    return d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
  }
  return d.toLocaleString([], {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: true,
  });
}

function toYmd(d) {
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

const DateTimeField = ({
  value,
  onChange,
  mode = 'datetime', // 'datetime' | 'date'
  placeholder = 'Select date & time',
  minimumDate,
  style,
}) => {
  const [iosOpen, setIosOpen] = useState(false);
  const [draftDate, setDraftDate] = useState(value ? new Date(value) : new Date());

  const currentDate = (() => {
    if (!value) return new Date();
    const d = new Date(value);
    return isNaN(d.getTime()) ? new Date() : d;
  })();

  const emitValue = (d) => {
    if (mode === 'date') {
      onChange(toYmd(d));
    } else {
      onChange(d.toISOString());
    }
  };

  const openPicker = () => {
    if (Platform.OS === 'android') {
      DateTimePickerAndroid.open({
        value: currentDate,
        mode: 'date',
        minimumDate,
        onChange: (event, selectedDate) => {
          if (event.type !== 'set' || !selectedDate) return;
          if (mode === 'date') {
            emitValue(selectedDate);
            return;
          }
          DateTimePickerAndroid.open({
            value: selectedDate,
            mode: 'time',
            is24Hour: false,
            onChange: (timeEvt, selectedTime) => {
              if (timeEvt.type !== 'set' || !selectedTime) return;
              const combined = new Date(selectedDate);
              combined.setHours(selectedTime.getHours(), selectedTime.getMinutes(), 0, 0);
              emitValue(combined);
            },
          });
        },
      });
    } else {
      setDraftDate(currentDate);
      setIosOpen(true);
    }
  };

  return (
    <>
      <View style={[styles.row, style]}>
        <TouchableOpacity onPress={openPicker} activeOpacity={0.8} style={styles.btn}>
          <Calendar size={16} color={COLORS.primary} />
          <Text style={[styles.text, !value && styles.placeholder]} numberOfLines={1}>
            {value ? formatDisplay(value, mode) : placeholder}
          </Text>
        </TouchableOpacity>
        {!!value && (
          <TouchableOpacity onPress={() => onChange('')} style={styles.clearBtn}>
            <X size={15} color={COLORS.textMuted} />
          </TouchableOpacity>
        )}
      </View>

      {Platform.OS === 'ios' && (
        <Modal visible={iosOpen} transparent animationType="slide" onRequestClose={() => setIosOpen(false)}>
          <View style={styles.iosOverlay}>
            <View style={styles.iosBox}>
              <View style={styles.iosHeader}>
                <TouchableOpacity onPress={() => setIosOpen(false)}>
                  <Text style={styles.iosCancel}>Cancel</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  onPress={() => {
                    emitValue(draftDate);
                    setIosOpen(false);
                  }}
                >
                  <Text style={styles.iosDone}>Done</Text>
                </TouchableOpacity>
              </View>
              <DateTimePicker
                value={draftDate}
                mode={mode === 'date' ? 'date' : 'datetime'}
                display="spinner"
                minimumDate={minimumDate}
                onChange={(_, d) => {
                  if (d) setDraftDate(d);
                }}
              />
            </View>
          </View>
        </Modal>
      )}
    </>
  );
};

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginBottom: 12,
  },
  btn: {
    flex: 1,
    height: 43,
    backgroundColor: '#f8fafc',
    borderWidth: 1.5,
    borderColor: '#e2e8f0',
    borderRadius: 10,
    paddingHorizontal: 12,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  text: {
    flex: 1,
    fontSize: 13.5,
    fontWeight: '600',
    color: COLORS.textPrimary,
  },
  placeholder: {
    color: '#94a3b8',
    fontWeight: '500',
  },
  clearBtn: {
    width: 38,
    height: 43,
    borderRadius: 10,
    backgroundColor: '#f1f5f9',
    alignItems: 'center',
    justifyContent: 'center',
  },
  iosOverlay: {
    flex: 1,
    backgroundColor: 'rgba(15, 23, 42, 0.45)',
    justifyContent: 'flex-end',
  },
  iosBox: {
    backgroundColor: '#ffffff',
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    paddingBottom: 20,
  },
  iosHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingHorizontal: 18,
    paddingVertical: 14,
    borderBottomWidth: 1,
    borderBottomColor: '#f1f5f9',
  },
  iosCancel: { fontSize: 15, fontWeight: '600', color: COLORS.textMuted },
  iosDone: { fontSize: 15, fontWeight: '800', color: COLORS.primary },
});

export default DateTimeField;
