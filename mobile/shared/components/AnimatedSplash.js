import React, { useEffect, useRef, useState } from 'react';
import { Modal, View, Text, Image, Animated, Easing, StyleSheet } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { GRADIENTS } from '../theme';

const LOGO_SIZE = 94;
const GAP = 12;

/**
 * AnimatedSplash
 * Clean, distraction-free animated splash screen:
 * 1. Clean Nexus logo pops out at exact screen center.
 * 2. "Nexus CRM" emerges smoothly out of the logo into a centered lockup.
 * 3. Holds briefly until `ready` is true.
 * 4. Reverses cleanly: "Nexus CRM" retracts back into the logo as the logo
 *    re-centers, then pops/shrinks back out and fades into the app.
 */
const AnimatedSplash = ({ logoSource, ready = true, onFinish }) => {
  const [done, setDone] = useState(false);
  const [textWidth, setTextWidth] = useState(184);

  const containerOpacity = useRef(new Animated.Value(1)).current;
  const logoScale = useRef(new Animated.Value(0.05)).current;
  const logoOpacity = useRef(new Animated.Value(0)).current;

  // Offset needed to place the logo alone at exact screen center
  const initialOffsetRef = useRef((GAP + 184) / 2);
  initialOffsetRef.current = (GAP + textWidth) / 2;

  const lockupTranslateX = useRef(new Animated.Value((GAP + 184) / 2)).current;
  const textTranslateX = useRef(new Animated.Value(-184)).current;
  const textOpacity = useRef(new Animated.Value(0)).current;

  const textWidthRef = useRef(textWidth);
  textWidthRef.current = textWidth;

  const introDoneRef = useRef(false);
  const reverseStartedRef = useRef(false);
  const readyRef = useRef(ready);
  readyRef.current = ready;

  const runReverse = () => {
    if (reverseStartedRef.current) return;
    reverseStartedRef.current = true;

    const targetCenterOffset = initialOffsetRef.current;
    const hideOffset = -textWidthRef.current;

    Animated.sequence([
      Animated.delay(520),
      // Reverse Step 1: "Nexus CRM" slides back into the logo as logo returns to exact screen center
      Animated.parallel([
        Animated.timing(lockupTranslateX, {
          toValue: targetCenterOffset,
          duration: 420,
          easing: Easing.inOut(Easing.cubic),
          useNativeDriver: true,
        }),
        Animated.timing(textTranslateX, {
          toValue: hideOffset,
          duration: 420,
          easing: Easing.in(Easing.cubic),
          useNativeDriver: true,
        }),
        Animated.timing(textOpacity, {
          toValue: 0,
          duration: 280,
          useNativeDriver: true,
        }),
      ]),
      // Reverse Step 2: Centered logo pops slightly, shrinks back in reverse, and fades out
      Animated.parallel([
        Animated.sequence([
          Animated.timing(logoScale, {
            toValue: 1.12,
            duration: 130,
            easing: Easing.out(Easing.quad),
            useNativeDriver: true,
          }),
          Animated.timing(logoScale, {
            toValue: 0.05,
            duration: 300,
            easing: Easing.in(Easing.back(1.5)),
            useNativeDriver: true,
          }),
        ]),
        Animated.sequence([
          Animated.delay(130),
          Animated.timing(logoOpacity, {
            toValue: 0,
            duration: 220,
            useNativeDriver: true,
          }),
        ]),
      ]),
      Animated.timing(containerOpacity, {
        toValue: 0,
        duration: 180,
        useNativeDriver: true,
      }),
    ]).start(() => {
      setDone(true);
      if (onFinish) onFinish();
    });
  };

  useEffect(() => {
    const timer = setTimeout(() => {
      lockupTranslateX.setValue(initialOffsetRef.current);
      textTranslateX.setValue(-textWidthRef.current);

      Animated.sequence([
        // Forward Step 1: Logo pops out cleanly at exact screen center
        Animated.parallel([
          Animated.spring(logoScale, {
            toValue: 1,
            friction: 5,
            tension: 90,
            useNativeDriver: true,
          }),
          Animated.timing(logoOpacity, {
            toValue: 1,
            duration: 280,
            easing: Easing.out(Easing.cubic),
            useNativeDriver: true,
          }),
        ]),
        // Forward Step 2: "Nexus CRM" emerges cleanly out of the logo
        Animated.parallel([
          Animated.timing(lockupTranslateX, {
            toValue: 0,
            duration: 460,
            easing: Easing.out(Easing.cubic),
            useNativeDriver: true,
          }),
          Animated.timing(textTranslateX, {
            toValue: 0,
            duration: 460,
            easing: Easing.out(Easing.cubic),
            useNativeDriver: true,
          }),
          Animated.timing(textOpacity, {
            toValue: 1,
            duration: 360,
            useNativeDriver: true,
          }),
        ]),
      ]).start(() => {
        introDoneRef.current = true;
        if (readyRef.current) {
          runReverse();
        }
      });
    }, 40);

    return () => clearTimeout(timer);
  }, []);

  useEffect(() => {
    if (ready && introDoneRef.current && !reverseStartedRef.current) {
      runReverse();
    }
  }, [ready]);

  if (done) return null;

  return (
    <Modal visible={!done} transparent statusBarTranslucent animationType="none">
      <Animated.View style={[styles.overlay, { opacity: containerOpacity }]} pointerEvents="auto">
        <LinearGradient
          colors={GRADIENTS.nexusBg}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 1 }}
          style={styles.bg}
        >
          <Animated.View
            style={[
              styles.lockupRow,
              { transform: [{ translateX: lockupTranslateX }] },
            ]}
          >
            {/* Clean Logo without any circle/halo */}
            <Animated.View
              style={[
                styles.logoWrap,
                {
                  opacity: logoOpacity,
                  transform: [{ scale: logoScale }],
                },
              ]}
            >
              {logoSource && (
                <Image source={logoSource} style={styles.logo} resizeMode="contain" />
              )}
            </Animated.View>

            {/* Clipped reveal window glued to logo's right edge */}
            <View style={styles.textClip}>
              <Animated.View
                onLayout={(e) => {
                  const w = Math.round(e.nativeEvent.layout.width);
                  if (w > 40 && Math.abs(w - textWidth) > 3) {
                    setTextWidth(w);
                  }
                }}
                style={{
                  opacity: textOpacity,
                  transform: [{ translateX: textTranslateX }],
                }}
              >
                <Text style={styles.brandText} numberOfLines={1}>
                  Nexus <Text style={styles.brandAccent}>CRM</Text>
                </Text>
              </Animated.View>
            </View>
          </Animated.View>
        </LinearGradient>
      </Animated.View>
    </Modal>
  );
};

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    width: '100%',
    height: '100%',
  },
  bg: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  lockupRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
  },
  logoWrap: {
    width: LOGO_SIZE,
    height: LOGO_SIZE,
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 2,
  },
  logo: {
    width: LOGO_SIZE,
    height: LOGO_SIZE,
  },
  textClip: {
    marginLeft: GAP,
    overflow: 'hidden',
    justifyContent: 'center',
    zIndex: 1,
  },
  brandText: {
    fontSize: 34,
    fontWeight: '900',
    color: '#ffffff',
    letterSpacing: -0.6,
  },
  brandAccent: {
    color: '#22d3ee',
  },
});

export default AnimatedSplash;
