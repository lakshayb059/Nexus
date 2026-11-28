import React, { useEffect, useRef } from 'react';
import { View, Text, Animated, Easing, Dimensions, StyleSheet } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import Svg, { Circle, Line, Path } from 'react-native-svg';
import { GRADIENTS } from '../theme';
import { PhoneCall, TrendingUp, Users, CheckCircle2 } from 'lucide-react-native';

const { width: SCREEN_W, height: SCREEN_H } = Dimensions.get('window');

/**
 * CrmAnimatedBackground
 * Animated enterprise CRM background with drifting glowing orbs,
 * subtle animated CRM telemetry nodes, and rising connection waves.
 */
const CrmAnimatedBackground = ({ children }) => {
  const orb1 = useRef(new Animated.Value(0)).current;
  const orb2 = useRef(new Animated.Value(0)).current;
  const card1 = useRef(new Animated.Value(0)).current;
  const card2 = useRef(new Animated.Value(0)).current;
  const pulse = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    const loopFloat = (anim, duration) =>
      Animated.loop(
        Animated.sequence([
          Animated.timing(anim, {
            toValue: 1,
            duration,
            easing: Easing.inOut(Easing.sin),
            useNativeDriver: true,
          }),
          Animated.timing(anim, {
            toValue: 0,
            duration,
            easing: Easing.inOut(Easing.sin),
            useNativeDriver: true,
          }),
        ])
      );

    const a1 = loopFloat(orb1, 5200);
    const a2 = loopFloat(orb2, 6800);
    const a3 = loopFloat(card1, 4400);
    const a4 = loopFloat(card2, 5600);
    const a5 = loopFloat(pulse, 3000);

    a1.start();
    a2.start();
    a3.start();
    a4.start();
    a5.start();

    return () => {
      a1.stop();
      a2.stop();
      a3.stop();
      a4.stop();
      a5.stop();
    };
  }, []);

  const orb1TranslateY = orb1.interpolate({ inputRange: [0, 1], outputRange: [-18, 22] });
  const orb1TranslateX = orb1.interpolate({ inputRange: [0, 1], outputRange: [-14, 18] });
  const orb2TranslateY = orb2.interpolate({ inputRange: [0, 1], outputRange: [24, -20] });
  const orb2TranslateX = orb2.interpolate({ inputRange: [0, 1], outputRange: [16, -16] });

  const card1Y = card1.interpolate({ inputRange: [0, 1], outputRange: [0, -14] });
  const card2Y = card2.interpolate({ inputRange: [0, 1], outputRange: [0, 14] });
  const pulseScale = pulse.interpolate({ inputRange: [0, 1], outputRange: [0.92, 1.12] });
  const pulseOpacity = pulse.interpolate({ inputRange: [0, 0.5, 1], outputRange: [0.18, 0.36, 0.18] });

  return (
    <LinearGradient
      colors={GRADIENTS.nexusBg}
      start={{ x: 0, y: 0 }}
      end={{ x: 1, y: 1 }}
      style={styles.shell}
    >
      {/* Background animated layer */}
      <View style={StyleSheet.absoluteFill} pointerEvents="none">
        {/* Drifting Cyan Orb */}
        <Animated.View
          style={[
            styles.orbCyan,
            {
              transform: [{ translateX: orb1TranslateX }, { translateY: orb1TranslateY }],
            },
          ]}
        />

        {/* Drifting Violet Orb */}
        <Animated.View
          style={[
            styles.orbViolet,
            {
              transform: [{ translateX: orb2TranslateX }, { translateY: orb2TranslateY }],
            },
          ]}
        />

        {/* Subtle CRM SVG Network Grid & Growth Curve */}
        <Svg width={SCREEN_W} height={SCREEN_H} style={StyleSheet.absoluteFill}>
          <Line x1="0" y1={SCREEN_H * 0.18} x2={SCREEN_W} y2={SCREEN_H * 0.14} stroke="rgba(255,255,255,0.05)" strokeWidth="1" />
          <Line x1="0" y1={SCREEN_H * 0.84} x2={SCREEN_W} y2={SCREEN_H * 0.78} stroke="rgba(34,211,238,0.08)" strokeWidth="1" />
          <Path
            d={`M -20 ${SCREEN_H * 0.88} Q ${SCREEN_W * 0.32} ${SCREEN_H * 0.76}, ${SCREEN_W * 0.62} ${SCREEN_H * 0.83} T ${SCREEN_W + 20} ${SCREEN_H * 0.71}`}
            fill="none"
            stroke="rgba(34,211,238,0.14)"
            strokeWidth="2"
          />
          <Circle cx={SCREEN_W * 0.16} cy={SCREEN_H * 0.17} r="3.5" fill="rgba(34,211,238,0.28)" />
          <Circle cx={SCREEN_W * 0.84} cy={SCREEN_H * 0.14} r="4.5" fill="rgba(129,140,248,0.32)" />
          <Circle cx={SCREEN_W * 0.74} cy={SCREEN_H * 0.81} r="4" fill="rgba(16,185,129,0.28)" />
        </Svg>

        {/* Floating CRM Telemetry Pill Top-Left */}
        <Animated.View
          style={[
            styles.floatPill,
            { top: 54, left: 16, transform: [{ translateY: card1Y }] },
          ]}
        >
          <View style={[styles.pillIcon, { backgroundColor: 'rgba(16,185,129,0.22)' }]}>
            <TrendingUp size={12} color="#34d399" />
          </View>
          <Text style={styles.floatPillText}>Live Pipeline</Text>
        </Animated.View>

        {/* Floating CRM Telemetry Pill Top-Right */}
        <Animated.View
          style={[
            styles.floatPill,
            { top: 96, right: 16, transform: [{ translateY: card2Y }] },
          ]}
        >
          <View style={[styles.pillIcon, { backgroundColor: 'rgba(34,211,238,0.22)' }]}>
            <PhoneCall size={12} color="#22d3ee" />
          </View>
          <Text style={styles.floatPillText}>Smart Queue</Text>
        </Animated.View>

        {/* Floating CRM Telemetry Pill Bottom-Left */}
        <Animated.View
          style={[
            styles.floatPill,
            { bottom: 38, left: 20, transform: [{ translateY: card2Y }] },
          ]}
        >
          <View style={[styles.pillIcon, { backgroundColor: 'rgba(129,140,248,0.25)' }]}>
            <Users size={12} color="#a5b4fc" />
          </View>
          <Text style={styles.floatPillText}>Customer 360</Text>
        </Animated.View>

        {/* Floating CRM Telemetry Pill Bottom-Right */}
        <Animated.View
          style={[
            styles.floatPill,
            {
              bottom: 52,
              right: 20,
              opacity: pulseOpacity,
              transform: [{ scale: pulseScale }],
            },
          ]}
        >
          <View style={[styles.pillIcon, { backgroundColor: 'rgba(16,185,129,0.22)' }]}>
            <CheckCircle2 size={12} color="#34d399" />
          </View>
          <Text style={styles.floatPillText}>Synced</Text>
        </Animated.View>
      </View>

      {children}
    </LinearGradient>
  );
};

const styles = StyleSheet.create({
  shell: {
    flex: 1,
    position: 'relative',
  },
  orbCyan: {
    position: 'absolute',
    top: -60,
    right: -50,
    width: 240,
    height: 240,
    borderRadius: 120,
    backgroundColor: 'rgba(34, 211, 238, 0.16)',
  },
  orbViolet: {
    position: 'absolute',
    bottom: -70,
    left: -60,
    width: 280,
    height: 280,
    borderRadius: 140,
    backgroundColor: 'rgba(124, 58, 237, 0.22)',
  },
  floatPill: {
    position: 'absolute',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 999,
    backgroundColor: 'rgba(255, 255, 255, 0.08)',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.14)',
  },
  pillIcon: {
    width: 20,
    height: 20,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  floatPillText: {
    color: 'rgba(241, 245, 249, 0.82)',
    fontSize: 10.5,
    fontWeight: '700',
    letterSpacing: 0.3,
  },
});

export default CrmAnimatedBackground;
