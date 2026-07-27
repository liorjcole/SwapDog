import React, { useState } from 'react';
import {
  View,
  Text,
  ScrollView,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  NativeSyntheticEvent,
  NativeScrollEvent,
  ActivityIndicator,
  Alert,
  Platform } from 'react-native';
import * as Haptics from 'expo-haptics'
import { useAuthContext } from '../../contexts/AuthContext';
import { useTheme } from '../../contexts/ThemeContext';
import { spacing, borderRadius, typography, shadow } from '../../config/theme';
import { useKeyboardScroll } from '../../hooks/useKeyboardScroll';
import {
  finalizeOnboardingSecure,
  signMembershipAgreementSecure,
} from '../../services/secureOperations';

interface ContractScreenProps {
  /**
   * When true, hides the signature section — used for read-only profile view.
   * signedName and signedDate are shown instead.
   */
  readOnly?: boolean;
  signedName?: string;
  signedDate?: string;
  onSigned?: () => void;
}

const today = new Date();
const FORMATTED_DATE = today.toLocaleDateString('en-US', {
  year: 'numeric',
  month: 'long',
  day: 'numeric' });

const CONTRACT_SECTIONS = [
  {
    number: '1.',
    title: 'MEMBERSHIP OBLIGATIONS',
    body: 'Lorem ipsum dolor sit amet, consectetur adipiscing elit. Sed do eiusmod tempor incididunt ut labore et dolore magna aliqua. Ut enim ad minim veniam, quis nostrud exercitation ullamco laboris nisi ut aliquip ex ea commodo consequat.' },
  {
    number: '2.',
    title: 'PET CARE STANDARDS',
    body: 'Lorem ipsum dolor sit amet, consectetur adipiscing elit. Duis aute irure dolor in reprehenderit in voluptate velit esse cillum dolore eu fugiat nulla pariatur. Excepteur sint occaecat cupidatat non proident.' },
  {
    number: '3.',
    title: 'COMMUNITY CONDUCT',
    body: 'Lorem ipsum dolor sit amet, consectetur adipiscing elit. Excepteur sint occaecat cupidatat non proident, sunt in culpa qui officia deserunt mollit anim id est laborum. Sed ut perspiciatis unde omnis iste natus error sit voluptatem.' },
  {
    number: '4.',
    title: 'LIABILITY & RESPONSIBILITY',
    body: 'Lorem ipsum dolor sit amet, consectetur adipiscing elit. Ut enim ad minima veniam, quis nostrum exercitationem ullam corporis suscipit laboriosam. Nisi ut aliquid ex ea commodi consequatur quis autem vel eum iure.' },
  {
    number: '5.',
    title: 'TERMINATION',
    body: 'Lorem ipsum dolor sit amet, consectetur adipiscing elit. Nemo enim ipsam voluptatem quia voluptas sit aspernatur aut odit aut fugit, sed quia consequuntur magni dolores eos qui ratione voluptatem sequi nesciunt.' },
  {
    number: '6.',
    title: 'REFERRAL ACCOUNTABILITY',
    body: 'Lorem ipsum dolor sit amet, consectetur adipiscing elit. Members who refer others are partially accountable for their referrals\' conduct within the community. Referrers agree to support and guide those they bring into the WatchDog family.' },
];

const ContractScreen: React.FC<ContractScreenProps> = ({
  readOnly = false,
  signedName,
  signedDate,
  onSigned }) => {
  const { colors } = useTheme();
  const { user, userProfile, refreshUserProfile } = useAuthContext();
  const {
    scrollRef,
    onScroll: onKeyboardScroll,
    onLayout,
    onContentSizeChange,
    refFor,
    scrollToInput,
  } = useKeyboardScroll();

  const [reachedBottom, setReachedBottom] = useState(readOnly);
  const [fullName, setFullName] = useState('');
  const [checked, setChecked] = useState(false);
  const [loading, setLoading] = useState(false);

  const handleScroll = (e: NativeSyntheticEvent<NativeScrollEvent>) => {
    const { layoutMeasurement, contentOffset, contentSize } = e.nativeEvent;
    const isAtBottom =
      layoutMeasurement.height + contentOffset.y >= contentSize.height - 50;
    if (isAtBottom && !reachedBottom) setReachedBottom(true);
  };

  const canSign = fullName.trim().length > 0 && checked && reachedBottom && !loading;

  const handleSign = async () => {
    if (!canSign || !user) return;
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    setLoading(true);
    try {
      await signMembershipAgreementSecure(fullName.trim());
      await finalizeOnboardingSecure();
      await refreshUserProfile();
      onSigned?.();
    } catch (error) {
      const message = error instanceof Error
        ? error.message
        : 'Something went wrong. Please try again.';
      Alert.alert(
        'Could Not Finish Setup',
        message.includes('subscription')
          ? 'Your purchase is still being confirmed. Wait a moment, then tap Sign again.'
          : message,
      );
    } finally {
      setLoading(false);
    }
  };

  return (
    <View style={{ flex: 1, backgroundColor: colors.background }}>
    <View style={[styles.outer, { backgroundColor: colors.background }]}>
      {/* ── Header — shown only in onboarding; nav bar title handles it in read-only/profile view ── */}
      {!readOnly && (
        <View style={[styles.header, { backgroundColor: colors.surface, ...shadow.sm }]}>
          <Text style={styles.headerIcon} accessibilityElementsHidden>📜</Text>
          <Text style={[styles.headerTitle, { color: colors.text }]} accessibilityRole="header">
            Membership Agreement
          </Text>
        </View>
      )}

      <ScrollView
        automaticallyAdjustKeyboardInsets={false}
        ref={scrollRef}
        onScroll={(event) => {
          handleScroll(event);
          onKeyboardScroll(event);
        }}
        onLayout={onLayout}
        onContentSizeChange={onContentSizeChange}
        scrollEventThrottle={16}
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator
      >
        {/* ── Highlighted note ─────────────────────────────────────────── */}
        <View style={[styles.noteCard, { backgroundColor: colors.primary + '1A', borderColor: colors.primary }]}>
          <Text style={[styles.noteText, { color: colors.text }]}>
            This agreement outlines the responsibilities and expectations for all WatchDog community
            members. By signing below, you acknowledge that you have read, understood, and agree to
            uphold these standards. This is a binding commitment to our community.
          </Text>
        </View>

        {/* ── Contract title ───────────────────────────────────────────── */}
        <Text style={[styles.contractTitle, { color: colors.text }]}>
          SWAPDOG COMMUNITY{'\n'}MEMBERSHIP AGREEMENT
        </Text>
        <Text style={[styles.effectiveDate, { color: colors.textSecondary }]}>
          Effective Date: {FORMATTED_DATE}
        </Text>

        {/* ── Sections ─────────────────────────────────────────────────── */}
        {CONTRACT_SECTIONS.map((section) => (
          <View key={section.number} style={[styles.sectionCard, { backgroundColor: colors.surface, ...shadow.sm }]}>
            <Text style={[styles.sectionTitle, { color: colors.text }]}>
              {section.number} {section.title}
            </Text>
            <Text style={[styles.sectionBody, { color: colors.textSecondary }]}>
              {section.body}
            </Text>
          </View>
        ))}

        {/* ── Divider ──────────────────────────────────────────────────── */}
        <View style={[styles.divider, { backgroundColor: colors.border }]} />

        {/* ── Signature section ─────────────────────────────────────────── */}
        {readOnly ? (
          // Read-only: show signed name + date
          <View ref={refFor('signatureName')} style={[styles.signatureCard, { backgroundColor: colors.surface, ...shadow.md }]}>
            <Text style={[styles.signatureLabel, { color: colors.textSecondary }]}>
              Digital Signature
            </Text>
            <Text style={[styles.signedName, { color: colors.text }]}>
              {signedName ?? '—'}
            </Text>
            {signedDate ? (
              <Text style={[styles.signedDate, { color: colors.textSecondary }]}>
                Date: {signedDate}
              </Text>
            ) : null}
          </View>
        ) : (
          // Interactive: signature input + accept button
          <View style={[styles.signatureCard, { backgroundColor: colors.surface, ...shadow.md }]}>
            {!reachedBottom && (
              <Text style={[styles.scrollHint, { color: colors.textSecondary }]}>
                ↓ Please scroll to the bottom to sign
              </Text>
            )}

            <Text style={[styles.signatureLabel, { color: colors.textSecondary }]}>
              Digital Signature
            </Text>
            <TextInput
              style={[
                styles.nameInput,
                {
                  color: colors.text,
                  borderColor: reachedBottom ? colors.primary : colors.border,
                  backgroundColor: colors.background },
              ]}
              placeholder="Type your full legal name"
              placeholderTextColor={colors.textSecondary}
              value={fullName}
              onChangeText={setFullName}
              editable={reachedBottom}
              accessibilityLabel="Full legal name for digital signature"
              returnKeyType="done"
              onFocus={() => scrollToInput('signatureName')}
            />

            <Text style={[styles.dateText, { color: colors.textSecondary }]}>
              Date: {FORMATTED_DATE}
            </Text>

            {/* Checkbox */}
            <TouchableOpacity
              style={styles.checkRow}
              onPress={() => {
                if (!reachedBottom) return;
                Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                setChecked((v) => !v);
              }}
              accessibilityRole="checkbox"
              accessibilityState={{ checked }}
              accessibilityLabel="I have read and agree to this agreement"
            >
              <View
                style={[
                  styles.checkbox,
                  {
                    borderColor: reachedBottom ? colors.primary : colors.border,
                    backgroundColor: checked ? colors.primary : 'transparent' },
                ]}
              >
                {checked && <Text style={styles.checkmark}>✓</Text>}
              </View>
              <Text style={[styles.checkLabel, { color: reachedBottom ? colors.text : colors.textSecondary }]}>
                I have read and agree to this agreement
              </Text>
            </TouchableOpacity>

            {/* Accept button */}
            <TouchableOpacity
              style={[
                styles.acceptBtn,
                { backgroundColor: canSign ? colors.primary : colors.border },
              ]}
              onPress={handleSign}
              disabled={!canSign}
              accessibilityRole="button"
              accessibilityLabel="I Accept and Sign"
              accessibilityState={{ disabled: !canSign }}
            >
              {loading ? (
                <ActivityIndicator color="#fff" />
              ) : (
                <Text style={styles.acceptBtnText}>I Accept &amp; Sign</Text>
              )}
            </TouchableOpacity>
          </View>
        )}

        <View style={styles.bottomPadding} />
      </ScrollView>
    </View>
    </View>
  );
};

const styles = StyleSheet.create({
  outer: { flex: 1 },
  header: {
    alignItems: 'center',
    paddingTop: 60,
    paddingBottom: spacing.lg,
    paddingHorizontal: spacing.lg },
  headerIcon: { fontSize: 38, marginBottom: spacing.xs },
  headerTitle: { ...typography.h2, textAlign: 'center' },
  scrollContent: { padding: spacing.md, paddingTop: spacing.sm },
  noteCard: {
    borderWidth: 1.5,
    borderRadius: borderRadius.lg,
    padding: spacing.lg,
    marginBottom: spacing.lg },
  noteText: {
    ...typography.body,
    lineHeight: 24,
    fontStyle: 'italic' },
  contractTitle: {
    ...typography.h2,
    textAlign: 'center',
    marginBottom: spacing.sm },
  effectiveDate: {
    ...typography.bodySmall,
    textAlign: 'center',
    marginBottom: spacing.lg },
  sectionCard: {
    borderRadius: borderRadius.lg,
    padding: spacing.md,
    marginBottom: spacing.sm },
  sectionTitle: {
    ...typography.h3,
    fontSize: 17,
    marginBottom: spacing.xs },
  sectionBody: {
    ...typography.bodySmall,
    lineHeight: 22 },
  divider: {
    height: 1.5,
    marginVertical: spacing.lg,
    borderRadius: 1 },
  signatureCard: {
    borderRadius: borderRadius.lg,
    padding: spacing.lg,
    marginBottom: spacing.md },
  scrollHint: {
    textAlign: 'center',
    fontSize: 15,
    marginBottom: spacing.md,
    fontStyle: 'italic' },
  signatureLabel: {
    ...typography.caption,
    letterSpacing: 0.5,
    textTransform: 'uppercase',
    marginBottom: spacing.sm,
    fontWeight: '600' },
  nameInput: {
    borderWidth: 1.5,
    borderRadius: borderRadius.md,
    padding: spacing.md,
    fontSize: 18,
    fontStyle: 'italic',
    marginBottom: spacing.md },
  dateText: {
    ...typography.bodySmall,
    marginBottom: spacing.lg },
  checkRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    marginBottom: spacing.lg },
  checkbox: {
    width: 22,
    height: 22,
    borderRadius: 6,
    borderWidth: 2,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: spacing.sm,
    marginTop: 1,
    flexShrink: 0 },
  checkmark: { color: '#fff', fontSize: 15, fontWeight: '700' },
  checkLabel: { flex: 1, fontSize: 16, lineHeight: 20 },
  acceptBtn: {
    borderRadius: borderRadius.md,
    paddingVertical: spacing.md,
    alignItems: 'center' },
  acceptBtnText: { color: '#fff', ...typography.button },
  // Read-only signed display
  signedName: {
    fontSize: 24,
    fontStyle: 'italic',
    fontWeight: '600',
    borderBottomWidth: 1.5,
    borderColor: '#ccc',
    paddingBottom: spacing.sm,
    marginBottom: spacing.sm },
  signedDate: {
    ...typography.bodySmall },
  bottomPadding: { height: 40 } });

export default ContractScreen;
