import React, { useState, useEffect, useRef } from 'react';
import {
  View, Text, TouchableOpacity, Modal, StyleSheet, Alert,
} from 'react-native';
import * as Haptics from 'expo-haptics';
import { useTheme } from '../../contexts/ThemeContext';
import { RepeatSchedule, DAY_LABELS } from '../../models/types';
import { borderRadius, spacing } from '../../config/theme';

interface Props {
  visible: boolean;
  onClose: () => void;
  onConfirm: (schedule: RepeatSchedule) => void;
  onClear: () => void;
  currentSchedule?: RepeatSchedule | null;
  defaultTime?: Date;
}

const ALL_DAYS = [0, 1, 2, 3, 4, 5, 6]; // Sun-Sat

const RepeatScheduleModal: React.FC<Props> = ({
  visible, onClose, onConfirm, onClear, currentSchedule,
}) => {
  const { colors } = useTheme();

  const [repeatType, setRepeatType] = useState<'daily' | 'weekly' | 'custom'>('daily');
  const [weeklyDay, setWeeklyDay] = useState(1);
  const [customDays, setCustomDays] = useState<Set<number>>(new Set());

  // Track original state to detect changes for discard warning
  const originalRef = useRef<{ type: string; weeklyDay: number; customDays: number[] } | null>(null);

  useEffect(() => {
    if (visible) {
      if (currentSchedule) {
        setRepeatType(currentSchedule.type);
        setWeeklyDay(currentSchedule.weeklyDay ?? 1);
        setCustomDays(new Set(currentSchedule.customDays ?? []));
        originalRef.current = {
          type: currentSchedule.type,
          weeklyDay: currentSchedule.weeklyDay ?? 1,
          customDays: Array.from(currentSchedule.customDays ?? []).sort(),
        };
      } else {
        setRepeatType('daily');
        setWeeklyDay(1);
        setCustomDays(new Set());
        originalRef.current = null;
      }
    }
  }, [visible]);

  const hasChanges = (): boolean => {
    if (!originalRef.current) return false; // no prior schedule — nothing to discard
    if (repeatType !== originalRef.current.type) return true;
    if (repeatType === 'weekly' && weeklyDay !== originalRef.current.weeklyDay) return true;
    if (repeatType === 'custom') {
      const sorted = Array.from(customDays).sort();
      if (sorted.length !== originalRef.current.customDays.length) return true;
      return sorted.some((d, i) => d !== originalRef.current!.customDays[i]);
    }
    return false;
  };

  const toggleCustomDay = (day: number) => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setCustomDays(prev => {
      const next = new Set(prev);
      if (next.has(day)) next.delete(day);
      else next.add(day);

      // If all 7 days selected -> auto-switch to daily
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

  const handleClose = () => {
    if (hasChanges()) {
      Alert.alert(
        'Discard changes?',
        'Any edits you made will be lost.',
        [
          { text: 'Keep Editing', style: 'cancel' },
          {
            text: 'Discard',
            style: 'destructive',
            onPress: () => onClose(),
          },
        ],
      );
    } else {
      onClose();
    }
  };

  const handleClear = () => {
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    onClear();
  };

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={handleClose}>
      <View style={styles.overlay}>
        <View style={[styles.sheet, { backgroundColor: colors.surface }]}>
          {/* Header with X */}
          <View style={styles.header}>
            <Text style={[styles.modalTitle, { color: colors.text }]}>Repeat this?</Text>
            <TouchableOpacity
              onPress={handleClose}
              activeOpacity={0.7}
              hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
            >
              <Text style={[styles.closeX, { color: colors.textSecondary }]}>✕</Text>
            </TouchableOpacity>
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

          {/* Remove repeat — only show when editing an existing schedule */}
          {currentSchedule && (
            <TouchableOpacity style={styles.clearBtn} onPress={handleClear}>
              <Text style={[styles.clearBtnText, { color: '#FF3B30' }]}>Remove repeat</Text>
            </TouchableOpacity>
          )}
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
  header: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: spacing.lg,
  },
  modalTitle: { fontSize: 22, fontWeight: '700' },
  closeX: { fontSize: 22, fontWeight: '400' },
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
