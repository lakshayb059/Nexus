import React from 'react';
import { Modal, View, Text, TouchableOpacity, FlatList, StyleSheet } from 'react-native';
import { COLORS } from '../theme';
import { Bell, BellRing, X, Calendar, Clock, Star, Database, Trash2, ShieldCheck } from 'lucide-react-native';
import { formatDateTime } from './UI';
import { openAppNotificationSettings } from '../services/notifications';

const NotificationsModal = ({
  visible,
  onClose,
  notifications,
  onClear,
  onNavigate,
  permissionGranted = true,
  canAskPermission = true,
  onRequestPermission,
}) => {
  const getIcon = (type) => {
    if (type === 'appointment') return { Icon: Calendar, color: COLORS.violet };
    if (type === 'callback') return { Icon: Clock, color: COLORS.cyan };
    if (type === 'lead') return { Icon: Star, color: COLORS.success };
    if (type === 'workflow') return { Icon: Database, color: COLORS.primary };
    return { Icon: Bell, color: COLORS.primary };
  };

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <View style={styles.overlay}>
        <View style={styles.sheet}>
          <View style={styles.header}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
              <Bell size={19} color={COLORS.primary} />
              <Text style={styles.title}>Notifications</Text>
            </View>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
              {notifications.length > 0 && (
                <TouchableOpacity onPress={onClear} style={styles.clearBtn}>
                  <Trash2 size={14} color={COLORS.danger} />
                  <Text style={styles.clearText}>Clear</Text>
                </TouchableOpacity>
              )}
              <TouchableOpacity onPress={onClose}>
                <X size={20} color={COLORS.textMuted} />
              </TouchableOpacity>
            </View>
          </View>

          {!permissionGranted ? (
            <View style={styles.permBanner}>
              <View style={styles.permIcon}>
                <BellRing size={17} color={COLORS.warning} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.permTitle}>Phone Notifications Disabled</Text>
                <Text style={styles.permSub}>
                  Allow phone alerts for appointments, callbacks & updates.
                </Text>
              </View>
              <TouchableOpacity
                onPress={canAskPermission ? onRequestPermission : openAppNotificationSettings}
                style={styles.permBtn}
              >
                <Text style={styles.permBtnText}>
                  {canAskPermission ? 'Allow' : 'Settings'}
                </Text>
              </TouchableOpacity>
            </View>
          ) : (
            <View style={styles.permActiveRow}>
              <ShieldCheck size={14} color={COLORS.success} />
              <Text style={styles.permActiveText}>Phone notifications enabled</Text>
            </View>
          )}

          <FlatList
            data={notifications}
            keyExtractor={(item) => item.id}
            contentContainerStyle={{ paddingBottom: 20 }}
            ListEmptyComponent={
              <View style={styles.empty}>
                <Bell size={38} color={COLORS.textMuted} style={{ opacity: 0.3, marginBottom: 8 }} />
                <Text style={styles.emptyTitle}>All caught up</Text>
                <Text style={styles.emptySub}>Real-time reminders and alerts appear here.</Text>
              </View>
            }
            renderItem={({ item }) => {
              const { Icon, color } = getIcon(item.type);
              return (
                <TouchableOpacity
                  style={styles.item}
                  onPress={() => {
                    onClose();
                    if (onNavigate && item.path) onNavigate(item.path);
                  }}
                >
                  <View style={[styles.iconWrap, { backgroundColor: `${color}15` }]}>
                    <Icon size={17} color={color} />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.itemTitle}>{item.title}</Text>
                    <Text style={styles.itemMsg}>{item.message}</Text>
                    <Text style={styles.itemTime}>{formatDateTime(item.time)}</Text>
                  </View>
                </TouchableOpacity>
              );
            }}
          />
        </View>
      </View>
    </Modal>
  );
};

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(15, 23, 42, 0.55)',
    justifyContent: 'flex-end',
  },
  sheet: {
    backgroundColor: '#ffffff',
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    maxHeight: '80%',
    padding: 18,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingBottom: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#f1f5f9',
    marginBottom: 10,
  },
  title: { fontSize: 17, fontWeight: '800', color: COLORS.textPrimary },
  clearBtn: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  clearText: { fontSize: 12.5, fontWeight: '700', color: COLORS.danger },
  permBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    backgroundColor: 'rgba(217, 119, 6, 0.09)',
    borderWidth: 1,
    borderColor: 'rgba(217, 119, 6, 0.25)',
    borderRadius: 12,
    padding: 10,
    marginBottom: 10,
  },
  permIcon: {
    width: 34,
    height: 34,
    borderRadius: 10,
    backgroundColor: 'rgba(217, 119, 6, 0.14)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  permTitle: { fontSize: 12.5, fontWeight: '800', color: COLORS.textPrimary },
  permSub: { fontSize: 11, color: COLORS.textSecondary, marginTop: 1 },
  permBtn: {
    backgroundColor: COLORS.primary,
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: 9,
  },
  permBtnText: { color: '#fff', fontSize: 12, fontWeight: '800' },
  permActiveRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingVertical: 4,
    paddingHorizontal: 2,
    marginBottom: 4,
  },
  permActiveText: { fontSize: 11.5, fontWeight: '700', color: COLORS.success },
  empty: { alignItems: 'center', paddingVertical: 40 },
  emptyTitle: { fontSize: 15, fontWeight: '700', color: COLORS.textPrimary },
  emptySub: { fontSize: 12.5, color: COLORS.textMuted, marginTop: 4 },
  item: {
    flexDirection: 'row',
    gap: 12,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#f8fafc',
  },
  iconWrap: {
    width: 36,
    height: 36,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  itemTitle: { fontSize: 13.5, fontWeight: '800', color: COLORS.textPrimary },
  itemMsg: { fontSize: 12.5, color: COLORS.textSecondary, marginTop: 2 },
  itemTime: { fontSize: 11, color: COLORS.textMuted, marginTop: 4 },
});

export default NotificationsModal;
