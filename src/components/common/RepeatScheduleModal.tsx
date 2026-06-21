import React, { useState, useEffect } from 'react';
import {
  View, Text, TouchableOpacity, Modal, StyleSheet, Alert,
} from 'react-native';
import * as Haptics from 'expo-haptics';
import { useTheme } from '../../contexts/ThemeContext';
import { RepeatSchedule, DAY_LABELS, formatRepeatLabel, formatRepeatSubLabel } from '../../models/types';
import { borderRadius, spacing } from '../../config/theme';

interface Props {
  visible: boolean;
  onClose: () => void;
  onConfirm: (schedule: RepeatSchedule) => void;
  onClear: () => void;
  currentSchedule?: RepeatSchedule | null;
  /** Default time from the parent add-on (kept for interface compat) */
  defaultTime?: Date;
}

type Step = 'summary' | 'type';

const ALL_DAYS = [0, 1, 2, 3, 4, 5, 6]; // Sun-Sat

const RepeatScheduleModal: React.FC<Props> = ({
  visible, onClose, onConfirm, onClear, currentSchedule,
}) => {
  const { colors } = useTheme();

  const [step, setStep] = useState<Step>('type');
  const [repeatType, setRepeatType] = useState<'daily' | 'weekly' | 'custom'>('daily');
  const [weeklyDay, setWeeklyDay] = useState(1);
  const [customDays, setCustomDays] = useState<Set<number>>(new Set());
  const [isEditing, setIsEditing] = useState(false);

  // Snapshot of the confirmed schedule so Cancel can revert
  const [savedSchedule, setSavedSchedule] = useState<RepeatSchedule | null>(null);

  useEffect(() => {
    if (visible) {
      if (currentSchedule) {
        setRepeatType(currentSchedule.type);
        setWeeklyDay(currentSchedule.weeklyDay ?? 1);
        setCustomDays(new Set(currentSchedule.customDays ?? []));
        setSavedSchedule(currentSchedule);
        setStep('summary');
        setIsEditing(false);
      } else {
        setRepeatType('daily');
        setWeeklyDay(1);
        setCustomDays(new Set());
        setSavedSchedule(null);
        setStep('type');
        setIsEditing(false);
      }
    }
  }, [visible]);

  const toggleCustomDay = (day: number) => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setCustomDays(prev => {
      const next = new Set(prev);
      if (next.has(day)) next.delete(day);
      else next.add(day);

      // If all 7 days selected → auto-switch to daily
      if (next.size === 7) {
        setRepeatType('daily');
        return new Set();
      }
      return next;
    });
  };

  const handleConfirm = () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    if (repeatType === 'custom' && customDays.size === 0) return;

    const schedule: RepeatSchedule = { type: repeatType };
    if (repeatType === 'weekly') schedule.weeklyDay = weeklyDay;
    if (repeatType === 'custom') schedule.customDays = Array.from(customDays).sort();

    onConfirm(schedule);
  };

  const handleEdit = () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setSavedSchedule(currentSchedule ?? null);
    setIsEditing(true);
    setStep('type');
  };

  const handleCancelEdit = () => {
    Alert.alert(
      'Discard changes?',
      'Any edits you made will be lost.',
      [
        { text: 'Keep Editing', style: 'cancel' },
        {
          text: 'Discard',
          style: 'destructive',
          onPress: () => {
            // Revert to saved
            if (savedSchedule) {
              setRepeatType(savedSchedule.type);
              setWeeklyDay(savedSchedule.weeklyDay ?? 1);
              setCustomDays(new Set(savedSchedule.customDays ?? []));
            }
            setIsEditing(false);
            setStep('summary');
          },
        },
      ],
    );
  };

  const handleClear = () => {
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    onClear();
  };

  // ── Summary view (read-only) ─────────────────────────────────────────────
  const renderSummary = () => {
    if (!currentSchedule) return null;
    const label = formatRepeatLabel(currentSchedule);
    const subLabel = formatRepeatSubLabel(currentSchedule);

    const days: number[] =
      currentSchedule.type === 'daily' ? ALL_DAYS
      : currentSchedule.type === 'weekly' ? [currentSchedule.weeklyDay ?? 1]
      : (currentSchedule.customDays ?? []);

    return (
      <>
        {/* Header with Edit */}
        <View style={styles.summaryHeader}>
          <Text style={[styles.modalTitle, { color: colors.text }]}>Repeat Schedule</Text>
          <TouchableOpacity onPress={handleEdit} activeOpacity={0.7}>
            <Text style={[styles.editBtn, { color: colors.primary }]}>Edit</Text>
          </TouchableOpacity>
        </View>

        {/* Cadence label */}
        <View style={[styles.cadenceCard, { backgroundColor: colors.primary + '10', borderColor: colors.primary + '30' }]}>
          <Text style={[styles.cadenceLabel, { color: colors.text }]}>✅ {label}</Text>
          {subLabel && (
            <Text style={[styles.cadenceSub, { color: colors.textSecondary }]}>{subLabel}</Text>
          )}
        </View>

        {/* Day list */}
        <View style={styles.dayList}>
          {days.map(d => (
            <View key={d} style={[styles.dayRow, { borderBottomColor: colors.border + '40' }]}>
              <Text style={[styles.dayRowText, { color: colors.text }]}>{DAY_LABELS[d]}</Text>
            </View>
          ))}
        </View>

        {/* Done */}
        <TouchableOpacity
          style={[styles.confirmBtn, { backgroundColor: colors.primary }]}
          onPress={onClose}
          activeOpacity={0.8}
        >
          <Text style={styles.confirmBtnText}>Done</Text>
        </TouchableOpacity>

        {/* Remove */}
        <TouchableOpacity style={styles.clearBtn} onPress={handleClear}>
          <Text style={[styles.clearBtnText, { color: '#FF3B30' }]}>Remove repeat</Text>
        </TouchableOpacity>
      </>
    );
  };

  // ── Edit view — cadence only ─────────────────────────────────────────────
  const renderTypeStep = () => (
    <>
      {/* Header — Cancel if editing */}
      <View style={styles.summaryHeader}>
        <Text style={[styles.modalTitle, { color: colors.text }]}>Repeat this?</Text>
        {isEditing && (
          <TouchableOpacity onPress={handleCancelEdit} activeOpacity={0.7}>
            <Text style={[styles.editBtn, { color: '#FF3B30' }]}>Cancel</Text>
          </TouchableOpacity>
        )}
      </View>

      {/* Radio: Daily */}
      <TouchableOpacity
        style={[styles.radioRow, repeatType === 'daily' && { backgroundColor: colors.primary + '10' }]}
        onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); setRepeatType('daily'); setCustomDays(new Set()); }}
        activeOpacity={0.7}
      >
        <Text style={[styles.radioLabel, { color: colors.text }]}>Repeat daily</Text>
        <Text style={[styles.radio, { color: repeatType === 'daily' ? colors.primary : colors.textSecondary }]}>
          {repeatType === 'daily' ? '●' : '○'}
        </Text>
      </TouchableOpacity>

      {/* Radio: Weekly */}
      <TouchableOpacity
        style={[styles.radioRow, repeatType === 'weekly' && { backgroundColor: colors.primary + '10' }]}
        onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); setRepeatType('weekly'); setCustomDays(new Set()); }}
        activeOpacity={0.7}
      >
        <Text style={[styles.radioLabel, { color: colors.text }]}>Repeat weekly</Text>
        <Text style={[styles.radio, { color: repeatType === 'weekly' ? colors.primary : colors.textSecondary }]}>
          {repeatType === 'weekly' ? '●' : '○'}
        </Text>
      </TouchableOpacity>

      {/* Weekly day picker */}
      {repeatType === 'weekly' && (
        <View style={styles.dayChips}>
          {ALL_DAYS.map(d => (
            <TouchableOpacity
              key={d}
              style={[
                styles.dayChip,
                { borderColor: colors.border, backgroundColor: colors.background },
                weeklyDay === d && { backgroundColor: colors.primary, borderColor: colors.primary },
              ]}
              onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); setWeeklyDay(d); }}
              activeOpacity={0.7}
            >
              <Text style={[
                styles.dayChipText,
                { color: colors.text },
                weeklyDay === d && { color: '#fff', fontWeight: '700' },
              ]}>
                {DAY_LABELS[d].slice(0, 3)}
              </Text>
            </TouchableOpacity>
          ))}
        </View>
      )}

      {/* Radio: Custom */}
      <TouchableOpacity
        style={[styles.radioRow, repeatType === 'custom' && { backgroundColor: colors.primary + '10' }]}
        onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); setRepeatType('custom'); }}
        activeOpacity={0.7}
      >
        <Text style={[styles.radioLabel, { color: colors.text }]}>Repeat on select days</Text>
        <Text style={[styles.radio, { color: repeatType === 'custom' ? colors.primary : colors.textSecondary }]}>
          {repeatType === 'custom' ? '●' : '○'}
        </Text>
      </TouchableOpacity>

      {/* Custom day picker */}
      {repeatType === 'custom' && (
        <View style={styles.dayChips}>
          {ALL_DAYS.map(d => (
            <TouchableOpacity
              key={d}
              style={[
                styles.dayChip,
                { borderColor: colors.border, backgroundColor: colors.background },
                customDays.has(d) && { backgroundColor: colors.primary, borderColor: colors.primary },
              ]}
              onPress={() => toggleCustomDay(d)}
              activeOpacity={0.7}
            >
              <Text style={[
                styles.dayChipText,
                { color: colors.text },
                customDays.has(d) && { color: '#fff', fontWeight: '700' },
              ]}>
                {DAY_LABELS[d].slice(0, 3)}
              </Text>
            </TouchableOpacity>
          ))}
        </View>
      )}

      {/* Confirm */}
      <TouchableOpacity
        style={[
          styles.confirmBtn,
          { backgroundColor: (repeatType === 'custom' && customDays.size === 0) ? colors.border : colors.primary },
        ]}
        onPress={handleConfirm}
        activeOpacity={0.8}
        disabled={repeatType === 'custom' && customDays.size === 0}
      >
        <Text style={styles.confirmBtnText}>Confirm</Text>
      </TouchableOpacity>

      {/* Close */}
      {!isEditing && (
        <TouchableOpacity style={styles.clearBtn} onPress={onClose}>
          <Text style={[styles.clearBtnText, { color: colors.textSecondary }]}>Cancel</Text>
        </TouchableOpacity>
      )}
    </>
  );

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <View style={styles.overlay}>
        <View style={[styles.sheet, { backgroundColor: colors.surface }]}>
          {step === 'summary' && renderSummary()}
          {step === 'type' && renderTypeStep()}
        </View>
      </View>
    </Modal>
  );
};

const styles = StyleSheet.create({
  overlay: {
    flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(0,0,0,0.4)',
  },
  sheet: {
    borderTopLeftRadius: 20, borderTopRightRadius: 20, padding: spacing.lg, paddingBottom: 40,
  },
  summaryHeader: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: spacing.lg,
  },
  modalTitle: { fontSize: 22, fontWeight: '700' },
  editBtn: { fontSize: 17, fontWeight: '600' },
  cadenceCard: {
    borderWidth: 1, borderRadius: borderRadius.md, padding: spacing.md, marginBottom: spacing.md, alignItems: 'center',
  },
  cadenceLabel: { fontSize: 17, fontWeight: '700' },
  cadenceSub: { fontSize: 15, marginTop: 2 },
  dayList: { marginBottom: spacing.md },
  dayRow: { paddingVertical: 12, borderBottomWidth: StyleSheet.hairlineWidth },
  dayRowText: { fontSize: 16 },
  radioRow: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    paddingVertical: 14, paddingHorizontal: spacing.md,
    borderRadius: borderRadius.md, marginBottom: 6,
  },
  radioLabel: { fontSize: 17, fontWeight: '500' },
  radio: { fontSize: 22 },
  dayChips: {
    flexDirection: 'row', flexWrap: 'wrap', gap: 8, paddingHorizontal: spacing.md,
    marginBottom: spacing.md, marginTop: 4,
  },
  dayChip: {
    paddingHorizontal: 14, paddingVertical: 10, borderRadius: 20, borderWidth: 1.5,
  },
  dayChipText: { fontSize: 15, fontWeight: '600' },
  confirmBtn: {
    borderRadius: borderRadius.md, paddingVertical: 16, alignItems: 'center', marginTop: spacing.md,
  },
  confirmBtnText: { color: '#fff', fontSize: 18, fontWeight: '700' },
  clearBtn: { alignItems: 'center', paddingVertical: 14 },
  clearBtnText: { fontSize: 16, fontWeight: '600' },
});

export default RepeatScheduleModal;
