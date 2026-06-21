import React, { useState, useEffect, useCallback } from 'react';
import {
  View, Text, TouchableOpacity, Modal, StyleSheet, ScrollView, Platform, Alert,
} from 'react-native';
import DateTimePicker from '@react-native-community/datetimepicker';
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
  /** Default time from the parent add-on (used as initial value for per-day pickers) */
  defaultTime?: Date;
}

type Step = 'summary' | 'type' | 'timeMode' | 'dayTimes';

const ALL_DAYS = [0, 1, 2, 3, 4, 5, 6]; // Sun-Sat

const FULL_DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

const RepeatScheduleModal: React.FC<Props> = ({
  visible, onClose, onConfirm, onClear, currentSchedule, defaultTime,
}) => {
  const { colors } = useTheme();

  // ── State ────────────────────────────────────────────────────────────────────
  const [step, setStep] = useState<Step>('type');
  const [isEditing, setIsEditing] = useState(false);
  const [repeatType, setRepeatType] = useState<'daily' | 'weekly' | 'custom'>('daily');
  const [weeklyDay, setWeeklyDay] = useState(1); // default Mon
  const [customDays, setCustomDays] = useState<Set<number>>(new Set());
  const [timeMode, setTimeMode] = useState<'same' | 'different'>('same');
  const [dayTimes, setDayTimes] = useState<Record<number, Date>>({});

  // Populate edit state from a schedule object
  const loadScheduleIntoState = useCallback((schedule: RepeatSchedule) => {
    setRepeatType(schedule.type);
    setWeeklyDay(schedule.weeklyDay ?? 1);
    setCustomDays(new Set(schedule.customDays ?? []));
    setTimeMode(schedule.timeMode);
    const times: Record<number, Date> = {};
    if (schedule.dayTimes) {
      Object.entries(schedule.dayTimes).forEach(([day, timeStr]) => {
        const d = new Date();
        const match = timeStr.match(/(\d+):(\d+)\s*(AM|PM)/i);
        if (match) {
          let h = parseInt(match[1], 10);
          const m = parseInt(match[2], 10);
          const ampm = match[3].toUpperCase();
          if (ampm === 'PM' && h !== 12) h += 12;
          if (ampm === 'AM' && h === 12) h = 0;
          d.setHours(h, m, 0, 0);
        }
        times[parseInt(day, 10)] = d;
      });
    }
    setDayTimes(times);
  }, []);

  // Reset state when modal opens
  useEffect(() => {
    if (visible) {
      setIsEditing(false);
      if (currentSchedule) {
        // Already confirmed — show summary first
        setStep('summary');
        loadScheduleIntoState(currentSchedule);
      } else {
        // Fresh — go straight to type picker
        setStep('type');
        setRepeatType('daily');
        setWeeklyDay(1);
        setCustomDays(new Set());
        setTimeMode('same');
        setDayTimes({});
      }
    }
  }, [visible, loadScheduleIntoState]);

  // ── Helpers ──────────────────────────────────────────────────────────────────
  const toggleCustomDay = (day: number) => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setCustomDays(prev => {
      const next = new Set(prev);
      if (next.has(day)) next.delete(day);
      else next.add(day);
      return next;
    });
  };

  const selectedDaysList = (): number[] => {
    if (repeatType === 'daily') return ALL_DAYS;
    if (repeatType === 'weekly') return [weeklyDay];
    return Array.from(customDays).sort();
  };

  const formatTime12 = (d: Date): string => {
    return d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true });
  };

  const getDefaultTimeDate = (): Date => {
    return defaultTime ?? (() => { const d = new Date(); d.setHours(12, 0, 0, 0); return d; })();
  };

  // Get days list from a schedule for the summary view
  const getSummaryDays = (schedule: RepeatSchedule): number[] => {
    if (schedule.type === 'daily') return ALL_DAYS;
    if (schedule.type === 'weekly') return [schedule.weeklyDay ?? 1];
    return (schedule.customDays ?? []).sort();
  };

  const getCadenceLabel = (schedule: RepeatSchedule): string => {
    if (schedule.type === 'daily') return 'Repeats Daily';
    if (schedule.type === 'weekly') return 'Repeats Weekly on ' + FULL_DAY_NAMES[schedule.weeklyDay ?? 1];
    if (schedule.type === 'custom') {
      const days = (schedule.customDays ?? []).map(d => FULL_DAY_NAMES[d]).join(', ');
      return 'Repeats on ' + days;
    }
    return 'Repeats';
  };

  // ── Edit / Cancel handlers ──────────────────────────────────────────────────
  const handleEditPress = () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    setIsEditing(true);
    setStep('type');
  };

  const handleCancelEdit = () => {
    Alert.alert(
      'Discard changes?',
      'Any edits you made will be lost if you cancel.',
      [
        { text: 'Keep Editing', style: 'cancel' },
        {
          text: 'Discard',
          style: 'destructive',
          onPress: () => {
            Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
            // Revert state to the confirmed schedule
            if (currentSchedule) {
              loadScheduleIntoState(currentSchedule);
            }
            setIsEditing(false);
            setStep('summary');
          },
        },
      ],
    );
  };

  // ── Step handlers ────────────────────────────────────────────────────────────
  const handleStepOneConfirm = () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    if (repeatType === 'custom' && customDays.size === 0) return;
    if (repeatType === 'weekly') {
      onConfirm({ type: 'weekly', weeklyDay, timeMode: 'same' });
      return;
    }
    setStep('timeMode');
  };

  const handleTimeModeConfirm = () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    if (timeMode === 'same') {
      const schedule: RepeatSchedule = {
        type: repeatType,
        timeMode: 'same',
        ...(repeatType === 'custom' ? { customDays: Array.from(customDays).sort() } : {}),
      };
      onConfirm(schedule);
    } else {
      const dt = getDefaultTimeDate();
      const days = selectedDaysList();
      const initial: Record<number, Date> = {};
      days.forEach(d => { initial[d] = dayTimes[d] ?? new Date(dt); });
      setDayTimes(initial);
      setStep('dayTimes');
    }
  };

  const handleDayTimesConfirm = () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    const times: Record<number, string> = {};
    const days = selectedDaysList();
    days.forEach(d => {
      times[d] = formatTime12(dayTimes[d] ?? getDefaultTimeDate());
    });
    const schedule: RepeatSchedule = {
      type: repeatType,
      timeMode: 'different',
      dayTimes: times,
      ...(repeatType === 'custom' ? { customDays: Array.from(customDays).sort() } : {}),
    };
    onConfirm(schedule);
  };

  const handleClear = () => {
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    onClear();
  };

  // ── Render: Summary (read-only confirmed schedule) ──────────────────────────
  const renderSummary = () => {
    if (!currentSchedule) return null;
    const days = getSummaryDays(currentSchedule);
    return (
      <>
        {/* Header row with title + Edit */}
        <View style={styles.summaryHeader}>
          <Text style={[styles.modalTitle, { color: colors.text, textAlign: 'left', flex: 1 }]}>
            Repeat Schedule
          </Text>
          <TouchableOpacity onPress={handleEditPress} style={styles.editBtn}>
            <Text style={[styles.editBtnText, { color: colors.primary }]}>Edit</Text>
          </TouchableOpacity>
        </View>

        {/* Cadence label */}
        <View style={[styles.cadenceCard, { backgroundColor: colors.primary + '12' }]}>
          <Text style={[styles.cadenceText, { color: colors.primary }]}>
            {getCadenceLabel(currentSchedule)}
          </Text>
        </View>

        {/* Day/time list */}
        <View style={styles.summaryList}>
          {days.map(d => (
            <View key={d} style={[styles.summaryRow, { borderBottomColor: colors.border }]}>
              <Text style={[styles.summaryDay, { color: colors.text }]}>{FULL_DAY_NAMES[d]}</Text>
              <Text style={[styles.summaryTime, { color: colors.textSecondary }]}>
                {currentSchedule.timeMode === 'different' && currentSchedule.dayTimes?.[d]
                  ? currentSchedule.dayTimes[d]
                  : 'Same time'}
              </Text>
            </View>
          ))}
        </View>

        {/* Close + Remove */}
        <TouchableOpacity
          style={[styles.confirmBtn, { backgroundColor: colors.primary }]}
          onPress={onClose}
        >
          <Text style={styles.confirmBtnText}>Done</Text>
        </TouchableOpacity>

        <TouchableOpacity style={styles.clearBtn} onPress={handleClear}>
          <Text style={[styles.clearBtnText, { color: '#FF3B30' }]}>Remove repeat</Text>
        </TouchableOpacity>
      </>
    );
  };

  // ── Render: Step 1 — Choose repeat type ──────────────────────────────────────
  const renderTypeStep = () => (
    <>
      {/* Header — Cancel if editing, or just the title */}
      {isEditing ? (
        <View style={styles.summaryHeader}>
          <Text style={[styles.modalTitle, { color: colors.text, textAlign: 'left', flex: 1 }]}>
            Edit Schedule
          </Text>
          <TouchableOpacity onPress={handleCancelEdit} style={styles.editBtn}>
            <Text style={[styles.editBtnText, { color: '#FF3B30' }]}>Cancel</Text>
          </TouchableOpacity>
        </View>
      ) : (
        <Text style={[styles.modalTitle, { color: colors.text }]}>Repeat this?</Text>
      )}

      {/* Radio: Daily */}
      <TouchableOpacity
        style={[styles.radioRow, repeatType === 'daily' && { backgroundColor: colors.primary + '15' }]}
        onPress={() => { setRepeatType('daily'); Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); }}
      >
        <Text style={[styles.radio, { color: repeatType === 'daily' ? colors.primary : colors.textSecondary }]}>
          {repeatType === 'daily' ? '●' : '○'}
        </Text>
        <Text style={[styles.radioLabel, { color: colors.text }]}>Repeat daily</Text>
      </TouchableOpacity>

      {/* Radio: Weekly */}
      <TouchableOpacity
        style={[styles.radioRow, repeatType === 'weekly' && { backgroundColor: colors.primary + '15' }]}
        onPress={() => { setRepeatType('weekly'); Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); }}
      >
        <Text style={[styles.radio, { color: repeatType === 'weekly' ? colors.primary : colors.textSecondary }]}>
          {repeatType === 'weekly' ? '●' : '○'}
        </Text>
        <Text style={[styles.radioLabel, { color: colors.text }]}>Repeat weekly</Text>
      </TouchableOpacity>

      {/* Weekly day selector */}
      {repeatType === 'weekly' && (
        <View style={styles.dayPillRow}>
          {ALL_DAYS.map(d => (
            <TouchableOpacity
              key={d}
              style={[styles.dayPill, weeklyDay === d
                ? { backgroundColor: colors.primary } : { backgroundColor: colors.background }]}
              onPress={() => { setWeeklyDay(d); Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); }}
            >
              <Text style={[styles.dayPillText, { color: weeklyDay === d ? '#fff' : colors.text }]}>
                {DAY_LABELS[d]}
              </Text>
            </TouchableOpacity>
          ))}
        </View>
      )}

      {/* Radio: Select days */}
      <TouchableOpacity
        style={[styles.radioRow, repeatType === 'custom' && { backgroundColor: colors.primary + '15' }]}
        onPress={() => { setRepeatType('custom'); Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); }}
      >
        <Text style={[styles.radio, { color: repeatType === 'custom' ? colors.primary : colors.textSecondary }]}>
          {repeatType === 'custom' ? '●' : '○'}
        </Text>
        <Text style={[styles.radioLabel, { color: colors.text }]}>Repeat on select days</Text>
      </TouchableOpacity>

      {/* Custom day toggles */}
      {repeatType === 'custom' && (
        <View style={styles.dayPillRow}>
          {ALL_DAYS.map(d => (
            <TouchableOpacity
              key={d}
              style={[styles.dayPill, customDays.has(d)
                ? { backgroundColor: colors.primary } : { backgroundColor: colors.background }]}
              onPress={() => toggleCustomDay(d)}
            >
              <Text style={[styles.dayPillText, { color: customDays.has(d) ? '#fff' : colors.text }]}>
                {DAY_LABELS[d]}
              </Text>
            </TouchableOpacity>
          ))}
        </View>
      )}

      {/* Confirm */}
      <TouchableOpacity
        style={[styles.confirmBtn, { backgroundColor: colors.primary },
          (repeatType === 'custom' && customDays.size === 0) && { opacity: 0.4 }]}
        onPress={handleStepOneConfirm}
        disabled={repeatType === 'custom' && customDays.size === 0}
      >
        <Text style={styles.confirmBtnText}>Confirm</Text>
      </TouchableOpacity>

      {/* Clear if already set (only when not editing — editing has Cancel in header) */}
      {currentSchedule && !isEditing && (
        <TouchableOpacity style={styles.clearBtn} onPress={handleClear}>
          <Text style={[styles.clearBtnText, { color: '#FF3B30' }]}>Remove repeat</Text>
        </TouchableOpacity>
      )}
    </>
  );

  // ── Render: Step 2 — Choose time mode ────────────────────────────────────────
  const renderTimeModeStep = () => (
    <>
      {isEditing && (
        <View style={styles.summaryHeader}>
          <View style={{ flex: 1 }} />
          <TouchableOpacity onPress={handleCancelEdit} style={styles.editBtn}>
            <Text style={[styles.editBtnText, { color: '#FF3B30' }]}>Cancel</Text>
          </TouchableOpacity>
        </View>
      )}
      <Text style={[styles.modalTitle, { color: colors.text }]}>Set times for selected days</Text>
      <Text style={[styles.modalSubtitle, { color: colors.textSecondary }]}>
        Choose how timing works for this event
      </Text>

      <TouchableOpacity
        style={[styles.timeModeOption, timeMode === 'same' && { backgroundColor: colors.primary + '15' }]}
        onPress={() => { setTimeMode('same'); Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); }}
      >
        <Text style={[styles.timeModeText, { color: colors.text }]}>Same time each day</Text>
        <Text style={[styles.radio, { color: timeMode === 'same' ? colors.primary : colors.textSecondary }]}>
          {timeMode === 'same' ? '●' : '○'}
        </Text>
      </TouchableOpacity>

      <View style={[styles.divider, { backgroundColor: colors.border }]} />

      <TouchableOpacity
        style={[styles.timeModeOption, timeMode === 'different' && { backgroundColor: colors.primary + '15' }]}
        onPress={() => { setTimeMode('different'); Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); }}
      >
        <Text style={[styles.timeModeText, { color: colors.text }]}>Different time for each day</Text>
        <Text style={[styles.radio, { color: timeMode === 'different' ? colors.primary : colors.textSecondary }]}>
          {timeMode === 'different' ? '●' : '○'}
        </Text>
      </TouchableOpacity>

      <TouchableOpacity
        style={[styles.confirmBtn, { backgroundColor: colors.primary }]}
        onPress={handleTimeModeConfirm}
      >
        <Text style={styles.confirmBtnText}>Confirm</Text>
      </TouchableOpacity>

      <TouchableOpacity style={styles.clearBtn} onPress={() => setStep('type')}>
        <Text style={[styles.clearBtnText, { color: colors.textSecondary }]}>Back</Text>
      </TouchableOpacity>
    </>
  );

  // ── Render: Step 3 — Per-day time pickers ────────────────────────────────────
  const renderDayTimesStep = () => {
    const days = selectedDaysList();
    return (
      <>
        {isEditing && (
          <View style={styles.summaryHeader}>
            <View style={{ flex: 1 }} />
            <TouchableOpacity onPress={handleCancelEdit} style={styles.editBtn}>
              <Text style={[styles.editBtnText, { color: '#FF3B30' }]}>Cancel</Text>
            </TouchableOpacity>
          </View>
        )}
        <Text style={[styles.modalTitle, { color: colors.text }]}>Set time for each day</Text>

        <ScrollView style={styles.dayTimesScroll} showsVerticalScrollIndicator={false}>
          {days.map(d => (
            <View key={d} style={[styles.dayTimeRow, { borderBottomColor: colors.border }]}>
              <Text style={[styles.dayTimeLabel, { color: colors.text }]}>{DAY_LABELS[d]}</Text>
              <DateTimePicker
                value={dayTimes[d] ?? getDefaultTimeDate()}
                mode="time"
                display={Platform.OS === 'ios' ? 'spinner' : 'default'}
                minuteInterval={5}
                style={styles.dayTimePicker}
                onChange={(_, selectedDate) => {
                  if (selectedDate) {
                    setDayTimes(prev => ({ ...prev, [d]: selectedDate }));
                  }
                }}
              />
            </View>
          ))}
        </ScrollView>

        <TouchableOpacity
          style={[styles.confirmBtn, { backgroundColor: colors.primary }]}
          onPress={handleDayTimesConfirm}
        >
          <Text style={styles.confirmBtnText}>Confirm</Text>
        </TouchableOpacity>

        <TouchableOpacity style={styles.clearBtn} onPress={() => setStep('timeMode')}>
          <Text style={[styles.clearBtnText, { color: colors.textSecondary }]}>Back</Text>
        </TouchableOpacity>
      </>
    );
  };

  // ── Main render ──────────────────────────────────────────────────────────────
  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <View style={styles.overlay}>
        <View style={[styles.sheet, { backgroundColor: colors.surface }]}>
          {step === 'summary' && renderSummary()}
          {step === 'type' && renderTypeStep()}
          {step === 'timeMode' && renderTimeModeStep()}
          {step === 'dayTimes' && renderDayTimesStep()}
        </View>
      </View>
    </Modal>
  );
};

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    justifyContent: 'flex-end',
    backgroundColor: 'rgba(0,0,0,0.5)',
  },
  sheet: {
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    paddingHorizontal: 24,
    paddingTop: 28,
    paddingBottom: 40,
    maxHeight: '85%',
  },
  // ── Summary styles ─────────────────────────────────────────────────────────
  summaryHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 6,
  },
  editBtn: {
    paddingVertical: 6,
    paddingHorizontal: 12,
  },
  editBtnText: {
    fontSize: 18,
    fontWeight: '700',
  },
  cadenceCard: {
    paddingVertical: 12,
    paddingHorizontal: 16,
    borderRadius: 12,
    marginBottom: 16,
    marginTop: 8,
  },
  cadenceText: {
    fontSize: 17,
    fontWeight: '700',
    textAlign: 'center',
  },
  summaryList: {
    marginBottom: 8,
  },
  summaryRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 14,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  summaryDay: {
    fontSize: 18,
    fontWeight: '600',
  },
  summaryTime: {
    fontSize: 16,
    fontWeight: '500',
  },
  // ── Shared styles ──────────────────────────────────────────────────────────
  modalTitle: {
    fontSize: 24,
    fontWeight: '800',
    marginBottom: 6,
    textAlign: 'center',
  },
  modalSubtitle: {
    fontSize: 16,
    marginBottom: 18,
    textAlign: 'center',
  },
  radioRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 14,
    paddingHorizontal: 16,
    borderRadius: 12,
    marginBottom: 8,
  },
  radio: {
    fontSize: 20,
    marginRight: 12,
    width: 22,
    textAlign: 'center',
  },
  radioLabel: {
    fontSize: 18,
    fontWeight: '600',
    flex: 1,
  },
  dayPillRow: {
    flexDirection: 'row',
    justifyContent: 'center',
    gap: 6,
    marginBottom: 12,
    marginTop: 4,
    flexWrap: 'wrap',
  },
  dayPill: {
    paddingVertical: 8,
    paddingHorizontal: 10,
    borderRadius: 20,
    minWidth: 42,
    alignItems: 'center',
  },
  dayPillText: {
    fontSize: 15,
    fontWeight: '700',
  },
  confirmBtn: {
    paddingVertical: 16,
    borderRadius: 14,
    alignItems: 'center',
    marginTop: 16,
  },
  confirmBtnText: {
    color: '#fff',
    fontSize: 19,
    fontWeight: '700',
  },
  clearBtn: {
    alignItems: 'center',
    marginTop: 12,
    paddingVertical: 8,
  },
  clearBtnText: {
    fontSize: 17,
    fontWeight: '600',
  },
  timeModeOption: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 16,
    paddingHorizontal: 16,
    borderRadius: 12,
  },
  timeModeText: {
    fontSize: 18,
    fontWeight: '600',
    flex: 1,
  },
  divider: {
    height: StyleSheet.hairlineWidth,
    marginVertical: 4,
    marginHorizontal: 16,
  },
  dayTimesScroll: {
    maxHeight: 300,
    marginTop: 12,
  },
  dayTimeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 8,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  dayTimeLabel: {
    fontSize: 19,
    fontWeight: '700',
    width: 60,
  },
  dayTimePicker: {
    flex: 1,
    maxWidth: 200,
  },
});

export default RepeatScheduleModal;
