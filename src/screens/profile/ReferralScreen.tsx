import React, { useEffect, useState } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  ScrollView,
  Share,
  ActivityIndicator,
  Clipboard,
} from 'react-native';
import * as Haptics from 'expo-haptics';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { ProfileStackParamList } from '../../navigation/types';
import { useAuthContext } from '../../contexts/AuthContext';
import { useTheme } from '../../contexts/ThemeContext';
import { spacing, borderRadius, shadow } from '../../config/theme';
import { ensureReferralCode } from '../../hooks/useReferrals';

type Props = {
  navigation: NativeStackNavigationProp<ProfileStackParamList, 'Referral'>;
};

const APP_LINK = 'https://joinwatchdog.com';

const ReferralScreen: React.FC<Props> = ({ navigation: _navigation }) => {
  const { colors } = useTheme();
  const { user, userProfile, refreshUserProfile } = useAuthContext();
  const [codeGenerating, setCodeGenerating] = useState(false);
  const [referralCode, setReferralCode] = useState(userProfile?.referralCode ?? '');

  // Auto-generate a referral code if the user doesn't have one yet
  useEffect(() => {
    if (!user) return;
    if (referralCode && referralCode.trim().length > 0) return;
    setCodeGenerating(true);
    ensureReferralCode(user.uid)
      .then((code) => {
        setReferralCode(code);
        return refreshUserProfile();
      })
      .catch(() => {
        // Non-fatal — share button stays disabled until code is ready
      })
      .finally(() => setCodeGenerating(false));
  }, [user, referralCode, refreshUserProfile]);

  // Sync if userProfile updates (e.g. after refreshUserProfile)
  useEffect(() => {
    const profileCode = userProfile?.referralCode ?? '';
    if (profileCode && profileCode.trim().length > 0) {
      setReferralCode(profileCode);
    }
  }, [userProfile?.referralCode]);

  const handleShare = async () => {
    if (!referralCode) return;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    try {
      await Share.share({
        message:
          `🐾 Join me on WatchDog — neighbors helping neighbors with pet sitting, walking & more!\n\n` +
          `Use my referral code: ${referralCode}\n\n` +
          `Sign up here: ${APP_LINK}`,
        title: 'Join WatchDog',
      });
    } catch {
      // user dismissed share sheet — ignore
    }
  };

  return (
    <ScrollView
      style={[styles.container, { backgroundColor: colors.background }]}
      contentContainerStyle={styles.content}
    >
      {/* ── SUB-TASK 1 & 2: Yellow "Built on Trust & Safety" box with warning blurb ── */}
      <View style={[styles.safetyCard, { backgroundColor: '#FFF3CD', borderColor: '#F0AD4E' }]}>
        <Text style={[styles.safetyTitle, { color: '#856404' }]}>🐾 Built on Trust & Safety</Text>
        <Text style={[styles.safetyBody, { color: '#664D03' }]}>
          WatchDog is built on trust and safety. Our community thrives because every member is
          vouched for by someone we already trust.
        </Text>
        <Text style={[styles.safetyBold, { color: '#664D03' }]}>
          Your referrals reflect on you.
        </Text>
        <Text style={[styles.safetyBody, { color: '#664D03' }]}>
          Only refer trusted friends or family members who share our values of responsible pet care.
        </Text>

        {/* SUB-TASK 2: Warning blurb — bottom of yellow box, same background */}
        <View style={styles.warningBlurb}>
          <Text style={[styles.warningText, { color: '#664D03' }]}>
            ⚠️ If someone you refer is reported for conduct violations or violates community
            standards, it may reflect on your account and your account may be subject to suspension
            or complete termination. So please refer responsibly!
          </Text>
        </View>
      </View>

      {/* ── SUB-TASK 4: Points incentive text above Share button ── */}
      <Text style={[styles.pointsText, { color: colors.text }]}>
        🎉 Earn 3 points for every friend who joins!
      </Text>

      {/* ── Share button (primary CTA) ── */}
      {codeGenerating ? (
        <ActivityIndicator
          color={colors.primary}
          size="large"
          style={{ marginVertical: spacing.md }}
        />
      ) : (
        <TouchableOpacity
          style={[
            styles.shareBtn,
            { backgroundColor: colors.primary },
            !referralCode && styles.shareBtnDisabled,
          ]}
          onPress={handleShare}
          disabled={!referralCode}
          accessibilityLabel="Share your referral link"
          accessibilityRole="button"
        >
          <Text style={styles.shareBtnText}>🔗  Share</Text>
        </TouchableOpacity>
      )}

      {/* ── Personal referral code (plain text below share button) ── */}
      {referralCode ? (
        <TouchableOpacity
          style={styles.codeRow}
          onPress={() => {
            Clipboard.setString(referralCode);
            Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
          }}
          accessibilityLabel="Copy referral code"
        >
          <Text style={[styles.codeLabel, { color: colors.textSecondary }]}>
            Your code: <Text style={[styles.codeValue, { color: colors.text }]}>{referralCode}</Text>
          </Text>
          <Text style={[styles.copyHint, { color: colors.primary }]}>Copy</Text>
        </TouchableOpacity>
      ) : null}
    </ScrollView>
  );
};

const styles = StyleSheet.create({
  container: { flex: 1 },
  content: { padding: spacing.lg, paddingBottom: 60 },

  // ── Yellow "Built on Trust & Safety" card ──
  safetyCard: {
    borderWidth: 1.5,
    borderRadius: borderRadius.lg,
    padding: spacing.lg,
    marginBottom: spacing.lg,
    ...shadow.sm,
  },
  safetyTitle: { fontSize: 16, fontWeight: '700', marginBottom: spacing.sm },
  safetyBody: { fontSize: 14, lineHeight: 20, marginBottom: spacing.sm },
  safetyBold: { fontSize: 14, fontWeight: '700', marginBottom: spacing.sm },

  // Warning blurb — visually part of the yellow card, separated by a subtle divider
  warningBlurb: {
    marginTop: spacing.sm,
    paddingTop: spacing.sm,
    borderTopWidth: 1,
    borderTopColor: '#F0AD4E',
  },
  warningText: { fontSize: 13, lineHeight: 19, fontWeight: '500' },

  // ── Points incentive ──
  pointsText: {
    fontSize: 16,
    fontWeight: '600',
    textAlign: 'center',
    marginBottom: spacing.md,
  },

  // ── Code display (plain text) ──
  codeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: spacing.md,
    gap: 8,
  },
  codeLabel: { fontSize: 14 },
  codeValue: { fontSize: 14 },
  copyHint: { fontSize: 14, fontWeight: '600' },

  // ── Red Share button ──
  shareBtn: {
    padding: spacing.md,
    borderRadius: borderRadius.md,
    alignItems: 'center',
  },
  shareBtnDisabled: { opacity: 0.5 },
  shareBtnText: { fontSize: 15, fontWeight: '700', color: '#fff' },
});

export default ReferralScreen;
