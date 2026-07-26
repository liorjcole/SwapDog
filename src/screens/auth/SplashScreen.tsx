import React from 'react';
import {
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
  useWindowDimensions,
} from 'react-native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { AuthStackParamList } from '../../navigation/types';

type Props = {
  navigation: NativeStackNavigationProp<AuthStackParamList, 'Splash'>;
};

const SplashScreen: React.FC<Props> = ({ navigation }) => {
  const { height } = useWindowDimensions();

  return (
    <View
      style={[
        styles.overlay,
        {
          paddingBottom: 34 + height * 0.05,
        },
      ]}
      pointerEvents="box-none"
    >
      <View style={styles.brand}>
        <Text style={styles.brandTitle}>WatchDog</Text>
        <Text style={[styles.brandSubtitle, styles.textShadow]}>Swap pet care with your neighbors</Text>
      </View>

      <View style={styles.buttonRow}>
        <TouchableOpacity
          style={[styles.button, styles.buttonOutline, styles.buttonShadow]}
          activeOpacity={0.85}
          onPress={() => navigation?.navigate('SignIn')}
          accessibilityRole="button"
          accessibilityLabel="Sign In"
        >
          <Text style={[styles.buttonText, styles.buttonTextShadow]}>Sign In</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.button, styles.buttonSolid, styles.buttonShadow]}
          activeOpacity={0.85}
          onPress={() => navigation?.navigate('SignUpIntro')}
          accessibilityRole="button"
          accessibilityLabel="Sign Up"
        >
          <Text style={[styles.buttonText, styles.buttonTextShadow]}>Sign Up</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
};

const BUTTON_HEIGHT = 54;

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    justifyContent: 'flex-end',
    paddingHorizontal: 24,
    alignItems: 'center',
  },
  brand: {
    width: '100%',
    marginBottom: 28,
    alignItems: 'center',
  },
  brandTitle: {
    color: '#FFFFFF',
    fontSize: 44,
    fontWeight: '800',
    textShadowColor: 'rgba(0,0,0,0.45)',
    textShadowOffset: { width: 0, height: 2 },
    textShadowRadius: 8,
  },
  brandSubtitle: {
    marginTop: 8,
    color: 'rgba(255,255,255,0.9)',
    fontSize: 16,
    fontWeight: '600',
  },
  textShadow: {
    textShadowColor: 'rgba(0,0,0,0.75)',
    textShadowOffset: { width: 0, height: 3 },
    textShadowRadius: 10,
  },
  buttonRow: { flexDirection: 'row', width: '100%', gap: 12 },
  button: {
    flex: 1,
    height: BUTTON_HEIGHT,
    borderRadius: 27,
    alignItems: 'center',
    justifyContent: 'center',
  },
  buttonShadow: {
    shadowColor: '#000000',
    shadowOffset: { width: 0, height: 10 },
    shadowOpacity: 0.32,
    shadowRadius: 18,
    elevation: 10,
  },
  buttonSolid: { backgroundColor: 'rgba(255,255,255,0.18)' },
  buttonOutline: { borderWidth: 1.5, borderColor: 'rgba(255,255,255,0.9)' },
  buttonText: { fontSize: 18, fontWeight: '600', color: '#FFFFFF' },
  buttonTextShadow: {
    textShadowColor: 'rgba(0,0,0,0.35)',
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 3,
  },
});

export default SplashScreen;
