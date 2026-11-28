import React, { useState, useEffect, useRef } from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { StatusBar } from 'expo-status-bar';
import * as SplashScreen from 'expo-splash-screen';
import { SafeAreaProvider, SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { NavigationContainer, createNavigationContainerRef } from '@react-navigation/native';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { AuthProvider, useAuth } from '../shared/contexts/AuthContext';
import { SocketProvider, useSocket } from '../shared/contexts/SocketContext';
import api from '../shared/services/api';
import {
  requestPhoneNotificationPermission,
  getPhoneNotificationPermission,
  sendLocalPhoneNotification,
  addNotificationResponseListener,
} from '../shared/services/notifications';
import { COLORS } from '../shared/theme';
import { AppTopBar } from '../shared/components/UI';
import AnimatedSplash from '../shared/components/AnimatedSplash';
import SideDrawer from '../shared/components/SideDrawer';
import BreakTimerOverlay from '../shared/components/BreakTimerOverlay';
import NotificationsModal from '../shared/components/NotificationsModal';
import DueTaskModal from '../shared/components/DueTaskModal';
import LoginScreen from '../shared/screens/LoginScreen';
import DashboardScreen from '../shared/screens/DashboardScreen';
import WorkflowScreen from '../shared/screens/WorkflowScreen';
import MyLeadsScreen from '../shared/screens/MyLeadsScreen';
import ContactsScreen from '../shared/screens/ContactsScreen';
import ScheduleScreen from '../shared/screens/ScheduleScreen';
import UploadScreen from '../shared/screens/UploadScreen';
import ReportsScreen from '../shared/screens/ReportsScreen';
import ProfileScreen from '../shared/screens/ProfileScreen';
import {
  LayoutDashboard,
  PhoneCall,
  Star,
  Calendar,
  Database,
  UploadCloud,
  BarChart2,
  UserCircle,
} from 'lucide-react-native';

const Tab = createBottomTabNavigator();
const navigationRef = createNavigationContainerRef();
const STAFF_LOGO = require('./assets/nexus-logo.png');

SplashScreen.preventAutoHideAsync().catch(() => {});

const TLToolsScreen = ({ activeSubTab }) => {
  const [subTab, setSubTab] = useState(activeSubTab || 'upload');

  useEffect(() => {
    if (activeSubTab) setSubTab(activeSubTab);
  }, [activeSubTab]);

  return (
    <View style={{ flex: 1, backgroundColor: COLORS.bgBase }}>
      <View style={styles.subTabBar}>
        <TouchableOpacity
          onPress={() => setSubTab('upload')}
          style={[styles.subTabBtn, subTab === 'upload' && styles.subTabActive]}
        >
          <UploadCloud size={15} color={subTab === 'upload' ? '#fff' : COLORS.textSecondary} />
          <Text style={[styles.subTabTxt, subTab === 'upload' && styles.subTabTxtActive]}>Data Import</Text>
        </TouchableOpacity>
        <TouchableOpacity
          onPress={() => setSubTab('reports')}
          style={[styles.subTabBtn, subTab === 'reports' && styles.subTabActive]}
        >
          <BarChart2 size={15} color={subTab === 'reports' ? '#fff' : COLORS.textSecondary} />
          <Text style={[styles.subTabTxt, subTab === 'reports' && styles.subTabTxtActive]}>Reports</Text>
        </TouchableOpacity>
      </View>
      {subTab === 'upload' ? <UploadScreen /> : <ReportsScreen />}
    </View>
  );
};

const StaffShell = () => {
  const { user, logout, activeBreak, setActiveBreak, recordActivity } = useAuth();
  const { socket } = useSocket();
  const insets = useSafeAreaInsets();

  const [activeRoute, setActiveRoute] = useState('Dashboard');
  const [activeTitle, setActiveTitle] = useState('Dashboard');
  const [targetContactId, setTargetContactId] = useState(null);
  const [tlSubTab, setTlSubTab] = useState('upload');
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [notifOpen, setNotifOpen] = useState(false);
  const [notifications, setNotifications] = useState([]);
  const [notifPerm, setNotifPerm] = useState({ granted: true, canAskAgain: true });
  const [avatarRefreshKey, setAvatarRefreshKey] = useState(0);
  const initialNotifSentRef = useRef(false);
  const isTl = user?.role === 'tl';

  const navigateTo = (routeName, subTab) => {
    if (subTab) setTlSubTab(subTab);
    if (navigationRef.isReady()) {
      navigationRef.navigate(routeName);
    }
  };

  // Request phone notification permission on staff login
  useEffect(() => {
    if (!user) return;
    requestPhoneNotificationPermission().then((res) => setNotifPerm(res));

    const sub = addNotificationResponseListener((data) => {
      if (data?.route) navigateTo(data.route);
    });
    return () => sub?.remove?.();
  }, [user]);

  const handleRequestPermission = async () => {
    const res = await requestPhoneNotificationPermission();
    setNotifPerm(res);
  };

  useEffect(() => {
    if (notifOpen) {
      getPhoneNotificationPermission().then((res) => setNotifPerm(res));
    }
  }, [notifOpen]);

  // Load initial notifications
  useEffect(() => {
    if (!user) return;
    api.get('/contacts/notifications')
      .then((res) => {
        const past = (res.data || []).map((a, i) => ({
          id: `past_${Date.now()}_${i}`,
          type: a.type,
          title: a.title,
          message: a.message,
          time: new Date(),
          path: a.path === '/appointments' || a.path === '/callbacks' ? 'Schedule' : 'Dashboard',
        }));
        setNotifications((prev) => [...past, ...prev].slice(0, 25));

        if (past.length > 0 && !initialNotifSentRef.current) {
          initialNotifSentRef.current = true;
          sendLocalPhoneNotification({
            title: past.length === 1 ? past[0].title : `${past.length} Pending CRM Alerts`,
            body: past.length === 1 ? past[0].message : `You have ${past.length} due callbacks or appointments.`,
            data: { route: 'Schedule' },
          });
        }
      })
      .catch(() => {});
  }, [user]);

  // Listen to real-time socket notifications and fire phone notifications
  useEffect(() => {
    if (!socket || !user) return;
    const uid = user._id || user.id;

    const onAppt = (data) => {
      if (data.agentId !== uid) return;
      const title = 'Appointment Reminder';
      const message = `${data.contactName} — ${data.minutesUntil} min`;
      setNotifications((prev) => [
        {
          id: `appt_${Date.now()}`,
          type: 'appointment',
          title,
          message,
          time: new Date(),
          path: 'Schedule',
        },
        ...prev,
      ].slice(0, 25));
      sendLocalPhoneNotification({ title, body: message, data: { route: 'Schedule' } });
    };

    const onCb = (data) => {
      if (data.agentId !== uid) return;
      const title = 'Callback Reminder';
      const message = `${data.contactName} — scheduled follow-up`;
      setNotifications((prev) => [
        {
          id: `cb_${Date.now()}`,
          type: 'callback',
          title,
          message,
          time: new Date(),
          path: 'Schedule',
        },
        ...prev,
      ].slice(0, 25));
      sendLocalPhoneNotification({ title, body: message, data: { route: 'Schedule' } });
    };

    const onBatch = (data) => {
      const title = 'New Calling Batch Assigned';
      const message = data?.batchName ? `Batch "${data.batchName}" is ready` : 'New contacts added to your queue';
      setNotifications((prev) => [
        {
          id: `batch_${Date.now()}`,
          type: 'workflow',
          title,
          message,
          time: new Date(),
          path: isTl ? 'Dashboard' : 'Workflow',
        },
        ...prev,
      ].slice(0, 25));
      sendLocalPhoneNotification({
        title,
        body: message,
        data: { route: isTl ? 'Dashboard' : 'Workflow' },
      });
    };

    socket.on('appointment_reminder', onAppt);
    socket.on('callback_reminder', onCb);
    socket.on('callback_due', onCb);
    socket.on('batch_uploaded', onBatch);
    return () => {
      socket.off('appointment_reminder', onAppt);
      socket.off('callback_reminder', onCb);
      socket.off('callback_due', onCb);
      socket.off('batch_uploaded', onBatch);
    };
  }, [socket, user, isTl]);

  const handleEndBreak = async () => {
    try {
      await api.post('/agent-logs/end-break');
      setActiveBreak(null);
    } catch {
      setActiveBreak(null);
    }
  };

  const drawerItems = isTl
    ? [
        { key: 'Dashboard', route: 'Dashboard', label: 'Dashboard', icon: LayoutDashboard },
        { key: 'Contacts', route: 'Contacts', label: 'All Contacts', icon: Database },
        { key: 'Leads', route: 'Leads', label: 'Leads', icon: Star },
        { key: 'Schedule', route: 'Schedule', label: 'Schedule & Hung Up', icon: Calendar },
        { key: 'Upload', route: 'Tools', subTab: 'upload', label: 'Data Import', icon: UploadCloud },
        { key: 'Reports', route: 'Tools', subTab: 'reports', label: 'Reports', icon: BarChart2 },
        { key: 'Profile', route: 'Profile', label: 'My Profile & Stats', icon: UserCircle },
      ]
    : [
        { key: 'Dashboard', route: 'Dashboard', label: 'Dashboard', icon: LayoutDashboard },
        { key: 'Workflow', route: 'Workflow', label: 'Workflow Queue', icon: PhoneCall },
        { key: 'Leads', route: 'Leads', label: 'My Leads', icon: Star },
        { key: 'Schedule', route: 'Schedule', label: 'Schedule', icon: Calendar },
        { key: 'Contacts', route: 'Contacts', label: 'Search Contacts', icon: Database },
        { key: 'Profile', route: 'Profile', label: 'My Profile & Stats', icon: UserCircle },
      ];

  const bottomPadding = Math.max(insets.bottom, 10);

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: '#ffffff' }} edges={['top']} onTouchStart={recordActivity}>
      <StatusBar style="dark" />
      <AppTopBar
        title={activeTitle}
        unreadCount={notifications.length}
        onPressMenu={() => setDrawerOpen(true)}
        onPressBell={() => setNotifOpen(true)}
      />

      <NavigationContainer ref={navigationRef} onStateChange={recordActivity}>
        <Tab.Navigator
          screenOptions={{
            headerShown: false,
            tabBarActiveTintColor: COLORS.primary,
            tabBarInactiveTintColor: COLORS.textMuted,
            tabBarHideOnKeyboard: true,
            tabBarStyle: {
              borderTopColor: COLORS.border,
              borderTopWidth: 1,
              backgroundColor: '#ffffff',
              height: 58 + bottomPadding,
              paddingBottom: bottomPadding,
              paddingTop: 6,
              elevation: 14,
              shadowColor: '#0f172a',
              shadowOffset: { width: 0, height: -4 },
              shadowOpacity: 0.06,
              shadowRadius: 10,
            },
            tabBarLabelStyle: { fontSize: 11, fontWeight: '700' },
          }}
        >
          <Tab.Screen
            name="Dashboard"
            listeners={{
              focus: () => {
                setActiveRoute('Dashboard');
                setActiveTitle('Dashboard');
              },
            }}
            options={{
              tabBarLabel: 'Home',
              tabBarIcon: ({ color, size }) => <LayoutDashboard size={size} color={color} />,
            }}
          >
            {({ navigation }) => (
              <DashboardScreen onNavigate={(routeName) => navigation.navigate(routeName)} />
            )}
          </Tab.Screen>

          {!isTl ? (
            <Tab.Screen
              name="Workflow"
              listeners={{
                focus: () => {
                  setActiveRoute('Workflow');
                  setActiveTitle('Workflow');
                },
              }}
              options={{
                tabBarLabel: 'Workflow',
                tabBarIcon: ({ color, size }) => <PhoneCall size={size} color={color} />,
              }}
            >
              {() => (
                <WorkflowScreen
                  targetContactId={targetContactId}
                  onClearTargetContact={() => setTargetContactId(null)}
                />
              )}
            </Tab.Screen>
          ) : (
            <Tab.Screen
              name="Contacts"
              listeners={{
                focus: () => {
                  setActiveRoute('Contacts');
                  setActiveTitle('Contacts');
                },
              }}
              options={{
                tabBarLabel: 'Contacts',
                tabBarIcon: ({ color, size }) => <Database size={size} color={color} />,
              }}
              component={ContactsScreen}
            />
          )}

          <Tab.Screen
            name="Leads"
            listeners={{
              focus: () => {
                setActiveRoute('Leads');
                setActiveTitle('Leads');
              },
            }}
            options={{
              tabBarLabel: 'Leads',
              tabBarIcon: ({ color, size }) => <Star size={size} color={color} />,
            }}
            component={MyLeadsScreen}
          />

          <Tab.Screen
            name="Schedule"
            listeners={{
              focus: () => {
                setActiveRoute('Schedule');
                setActiveTitle('Schedule');
              },
            }}
            options={{
              tabBarLabel: 'Schedule',
              tabBarIcon: ({ color, size }) => <Calendar size={size} color={color} />,
            }}
          >
            {({ navigation }) => (
              <ScheduleScreen
                includeHungUp={isTl}
                onOpenWorkflow={(cid) => {
                  setTargetContactId(cid);
                  if (!isTl) navigation.navigate('Workflow');
                }}
              />
            )}
          </Tab.Screen>

          {!isTl ? (
            <Tab.Screen
              name="Contacts"
              listeners={{
                focus: () => {
                  setActiveRoute('Contacts');
                  setActiveTitle('Contacts');
                },
              }}
              options={{
                tabBarLabel: 'Search',
                tabBarIcon: ({ color, size }) => <Database size={size} color={color} />,
              }}
            >
              {({ navigation }) => (
                <ContactsScreen
                  onOpenWorkflow={(cid) => {
                    setTargetContactId(cid);
                    navigation.navigate('Workflow');
                  }}
                />
              )}
            </Tab.Screen>
          ) : (
            <Tab.Screen
              name="Tools"
              listeners={{
                focus: () => {
                  setActiveRoute('Tools');
                  setActiveTitle('Tools');
                },
              }}
              options={{
                tabBarLabel: 'Tools',
                tabBarIcon: ({ color, size }) => <BarChart2 size={size} color={color} />,
              }}
            >
              {() => <TLToolsScreen activeSubTab={tlSubTab} />}
            </Tab.Screen>
          )}

          {/* Hidden tab for Profile screen navigated via 3-bar drawer user avatar */}
          <Tab.Screen
            name="Profile"
            listeners={{
              focus: () => {
                setActiveRoute('Profile');
                setActiveTitle('Profile');
              },
            }}
            options={{
              tabBarButton: () => null,
              tabBarItemStyle: { display: 'none' },
            }}
          >
            {() => <ProfileScreen onAvatarChanged={() => setAvatarRefreshKey((k) => k + 1)} />}
          </Tab.Screen>
        </Tab.Navigator>
      </NavigationContainer>

      <SideDrawer
        visible={drawerOpen}
        onClose={() => setDrawerOpen(false)}
        user={user}
        items={drawerItems}
        activeRoute={activeRoute}
        onNavigate={navigateTo}
        onOpenProfile={() => navigateTo('Profile')}
        onLogout={logout}
        avatarRefreshKey={avatarRefreshKey}
      />

      <BreakTimerOverlay activeBreak={activeBreak} onEndBreak={handleEndBreak} />

      <NotificationsModal
        visible={notifOpen}
        onClose={() => setNotifOpen(false)}
        notifications={notifications}
        onClear={() => setNotifications([])}
        onNavigate={(path) => navigateTo(path)}
        permissionGranted={notifPerm.granted}
        canAskPermission={notifPerm.canAskAgain}
        onRequestPermission={handleRequestPermission}
      />

      <DueTaskModal />
    </SafeAreaView>
  );
};

const RootGate = () => {
  const { isAuthenticated, loading } = useAuth();
  const [splashDone, setSplashDone] = useState(false);

  useEffect(() => {
    const t = setTimeout(() => {
      SplashScreen.hideAsync().catch(() => {});
    }, 350);
    return () => clearTimeout(t);
  }, []);

  return (
    <View style={{ flex: 1, backgroundColor: '#070d1f' }}>
      <StatusBar style="light" />
      {!splashDone ? (
        <AnimatedSplash
          logoSource={STAFF_LOGO}
          ready={!loading}
          onReadyToHide={() => SplashScreen.hideAsync().catch(() => {})}
          onFinish={() => setSplashDone(true)}
        />
      ) : isAuthenticated ? (
        <StaffShell />
      ) : (
        <LoginScreen appTitle="Nexus CRM." appBadge="STAFF APP • AGENT & TL" logoSource={STAFF_LOGO} />
      )}
    </View>
  );
};

export default function App() {
  return (
    <SafeAreaProvider>
      <AuthProvider
        allowedRoles={['agent', 'tl']}
        appName="Nexus Staff"
        wrongAppMessage="Admin and SuperAdmin accounts must sign in using the Nexus Admin app."
      >
        <SocketProvider>
          <RootGate />
        </SocketProvider>
      </AuthProvider>
    </SafeAreaProvider>
  );
}

const styles = StyleSheet.create({
  subTabBar: { flexDirection: 'row', gap: 8, padding: 14, paddingBottom: 4 },
  subTabBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingVertical: 10,
    borderRadius: 12,
    backgroundColor: '#fff',
    borderWidth: 1,
    borderColor: COLORS.borderSlate,
  },
  subTabActive: { backgroundColor: COLORS.primary, borderColor: COLORS.primary },
  subTabTxt: { fontSize: 13, fontWeight: '700', color: COLORS.textSecondary },
  subTabTxtActive: { color: '#fff' },
});
