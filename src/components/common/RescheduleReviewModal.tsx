import React, { useState, useRef } from 'react';
import {
  View, Text, Modal, TouchableOpacity, TextInput, StyleSheet, Alert, Platform, ScrollView } from 'react-native';
import * as Haptics from 'expo-haptics';
import { useTheme } from '../../contexts/ThemeContext';
import { spacing, borderRadius } from '../../config/theme';
import { smartDate } from '../../utils/dateHelpers';

const RED = '#FF2D55';

interface Props {
  visible: boolean;
  onClose: () => void;
  /** The proposed new dates from the reschedule request */
  proposedStart: Date;
  proposedEnd: Date;
  /** The original dates on the post */
  originalStart: Date;
  originalEnd: Date;
  /** Name of the person who proposed the reschedule */
  proposerName: string;
  /** Optional note from the proposer */
  proposerNote?: string;
  /** Callback when user takes an action */
  onRespond: (action: 'accept' | 'reject' | 'propose', note?: string, newStart?: Date, newEnd?: Date) => void;
}

const RescheduleReviewModal: React.FC<Props> = ({
  visible, onClose, proposedStart, proposedEnd, originalStart, originalEnd,
  proposerName, proposerNote, onRespond }) => {
  const { colors } = useTheme();
  const [note, setNote] = useState('');
  const scrollRef = useRef<ScrollView>(null);
  const [showPropose, setShowPropose] = useState(false);
  const [myStart, setMyStart] = useState(proposedStart);
  const [myEnd, setMyEnd] = useState(proposedEnd);

  const handleAccept = () => {
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    onRespond('accept', note.trim() || undefined);
    setNote('');
  };

  const handleReject = () => {
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
    onRespond('reject', note.trim() || undefined);
    setNote('');
  };

  const handlePropose = () => {
    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);
    if (myStart < todayStart) {
      Alert.alert('Invalid dates', 'Start date cannot be in the past.');
      return;
    }
    if (myEnd <= myStart) {
      Alert.alert('Invalid dates', 'End date must be after the start date.');
      return;
    }
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    onRespond('propose', note.trim() || undefined, myStart, myEnd);
    setNote('');
    setShowPropose(false);
  };

  const handleSendNote = () => {
    if (!note.trim()) {
      Alert.alert('Empty note', 'Please write a note before sending.');
      return;
    }
    // Sending just a note is treated as neither accept nor reject — user can x out
    // We'll treat this as a message-only response
    onRespond('reject', note.trim());
    setNote('');
  };

  const adjustDate = (setter: React.Dispatch<React.SetStateAction<Date>>, current: Date, delta: number) => {
    const d = new Date(current);
    d.setDate(d.getDate() + delta);
    setter(d);
  };

  return (
    <Modal visible={visible} transparent animationType="slide">
      <View style={{ flex: 1 }}>
        <View style={[styles.container, { backgroundColor: colors.background }]}>
          <ScrollView
        automaticallyAdjustKeyboardInsets={true} ref={scrollRef} showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">
            {/* Header with X close */}
            <View style={styles.header}>
              <Text style={[styles.title, { color: colors.text }]}>Reschedule Request</Text>
              <TouchableOpacity onPress={onClose} hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}>
                <Text style={[styles.closeX, { color: colors.textSecondary }]}>✕</Text>
              </TouchableOpacity>
            </View>

            {/* Who proposed */}
            <Text style={[styles.subtitle, { color: colors.textSecondary }]}>
              {proposerName} wants to change the dates
            </Text>

            {/* Original vs Proposed dates */}
            <View style={styles.dateComparison}>
              <View style={styles.dateBlock}>
                <Text style={[styles.dateLabel, { color: colors.textSecondary }]}>Original</Text>
                <Text style={[styles.dateValue, { color: colors.text, textDecorationLine: 'line-through', opacity: 0.5 }]}>
                  {smartDate(originalStart)} – {smartDate(originalEnd)}
                </Text>
              </View>
              <Text style={[styles.arrow, { color: RED }]}>→</Text>
              <View style={styles.dateBlock}>
                <Text style={[styles.dateLabel, { color: RED }]}>Proposed</Text>
                <Text style={[styles.dateValue, { color: RED, fontWeight: '700' }]}>
                  {smartDate(proposedStart)} – {smartDate(proposedEnd)}
                </Text>
              </View>
            </View>

            {/* Proposer's note */}
            {proposerNote ? (
              <View style={[styles.noteBlock, { backgroundColor: colors.surface }]}>
                <Text style={[styles.noteLabel, { color: colors.textSecondary }]}>Note from {proposerName}</Text>
                <Text style={[styles.noteText, { color: colors.text }]}>{proposerNote}</Text>
              </View>
            ) : null}

            {/* Action buttons */}
            <TouchableOpacity style={[styles.actionBtn, { backgroundColor: RED }]} onPress={handleAccept}>
              <Text style={styles.actionBtnText}>Accept New Dates</Text>
            </TouchableOpacity>

            <TouchableOpacity style={[styles.actionBtn, styles.grayBtn]} onPress={handleReject}>
              <Text style={[styles.actionBtnText, styles.grayBtnText]}>Decline</Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={[styles.actionBtn, styles.grayBtn]}
              onPress={() => setShowPropose(!showPropose)}
            >
              <Text style={[styles.actionBtnText, styles.grayBtnText]}>
                {showPropose ? 'Cancel Proposal' : 'Propose Different Dates'}
              </Text>
            </TouchableOpacity>

            {/* Propose different dates section */}
            {showPropose && (
              <View style={[styles.proposeSection, { borderColor: colors.textSecondary }]}>
                <Text style={[styles.proposeLabel, { color: colors.text }]}>Your proposed dates</Text>
                {/* Start date picker */}
                <View style={styles.datePickerRow}>
                  <TouchableOpacity onPress={() => adjustDate(setMyStart, myStart, -1)} style={styles.dateArrow}>
                    <Text style={[styles.dateArrowText, { color: colors.text }]}>‹</Text>
                  </TouchableOpacity>
                  <Text style={[styles.datePickerText, { color: colors.text }]}>{smartDate(myStart)}</Text>
                  <TouchableOpacity onPress={() => adjustDate(setMyStart, myStart, 1)} style={styles.dateArrow}>
                    <Text style={[styles.dateArrowText, { color: colors.text }]}>›</Text>
                  </TouchableOpacity>
                </View>
                <Text style={[styles.toText, { color: colors.textSecondary }]}>to</Text>
                {/* End date picker */}
                <View style={styles.datePickerRow}>
                  <TouchableOpacity onPress={() => adjustDate(setMyEnd, myEnd, -1)} style={styles.dateArrow}>
                    <Text style={[styles.dateArrowText, { color: colors.text }]}>‹</Text>
                  </TouchableOpacity>
                  <Text style={[styles.datePickerText, { color: colors.text }]}>{smartDate(myEnd)}</Text>
                  <TouchableOpacity onPress={() => adjustDate(setMyEnd, myEnd, 1)} style={styles.dateArrow}>
                    <Text style={[styles.dateArrowText, { color: colors.text }]}>›</Text>
                  </TouchableOpacity>
                </View>
                <TouchableOpacity style={[styles.actionBtn, { backgroundColor: '#0984E3', marginTop: spacing.sm }]} onPress={handlePropose}>
                  <Text style={styles.actionBtnText}>Send Proposal</Text>
                </TouchableOpacity>
              </View>
            )}

            {/* Note input — always visible */}
            <View style={[styles.noteInput, styles.grayBtn, { borderColor: 'rgba(150,150,150,0.25)' }]}>
              <TextInput
                style={[styles.noteInputField, { color: colors.text }]}
                placeholder="Add a note (optional)"
                placeholderTextColor={colors.textSecondary}
                value={note}
                onChangeText={setNote}
                onFocus={() => setTimeout(() => scrollRef.current?.scrollToEnd({ animated: true }), 300)}
                multiline
              returnKeyType="done"
                              blurOnSubmit={true}
                              />
            </View>
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
};

const styles = StyleSheet.create({
  overlay: { flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(0,0,0,0.5)' },
  container: { borderTopLeftRadius: 24, borderTopRightRadius: 24, padding: spacing.lg, paddingBottom: 40, maxHeight: '85%' },
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: spacing.sm },
  title: { fontSize: 22, fontWeight: '800' },
  closeX: { fontSize: 22, fontWeight: '600', padding: 4 },
  subtitle: { fontSize: 15, marginBottom: spacing.md },
  dateComparison: { flexDirection: 'row', alignItems: 'center', marginBottom: spacing.md, gap: 8 },
  dateBlock: { flex: 1 },
  dateLabel: { fontSize: 12, fontWeight: '600', marginBottom: 2, textTransform: 'uppercase' },
  dateValue: { fontSize: 16 },
  arrow: { fontSize: 20, fontWeight: '700' },
  noteBlock: { padding: spacing.md, borderRadius: borderRadius.md, marginBottom: spacing.md },
  noteLabel: { fontSize: 12, fontWeight: '600', marginBottom: 4 },
  noteText: { fontSize: 15 },
  actionBtn: { padding: spacing.md, borderRadius: borderRadius.md, alignItems: 'center', marginBottom: spacing.sm },
  grayBtn: { backgroundColor: 'rgba(150,150,150,0.12)' },
  grayBtnText: { color: '#999', fontWeight: '500' },
  actionBtnText: { color: '#fff', fontSize: 16, fontWeight: '700' },
  proposeSection: { borderWidth: 1, borderRadius: borderRadius.md, padding: spacing.md, marginBottom: spacing.sm },
  proposeLabel: { fontSize: 14, fontWeight: '600', marginBottom: spacing.sm, textAlign: 'center' },
  datePickerRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', marginVertical: 4 },
  dateArrow: { padding: spacing.sm },
  dateArrowText: { fontSize: 28, fontWeight: '300' },
  datePickerText: { fontSize: 18, fontWeight: '600', minWidth: 120, textAlign: 'center' },
  toText: { textAlign: 'center', fontSize: 13 },
  noteInput: { borderWidth: 1, borderRadius: borderRadius.md, padding: spacing.sm, marginTop: spacing.sm, minHeight: 60 },
  noteInputField: { fontSize: 15, minHeight: 40 } });

export default RescheduleReviewModal;
