import React, { useState, useEffect, useRef, useMemo } from 'react';
import {
  View, Text, TouchableOpacity, Modal, StyleSheet, Alert, ScrollView,
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
  /** For overnight stays — enables "Specific dates" option with calendar */
  stayStartDate?: Date;
  /** For overnight stays — end of stay range */
  stayEndDate?: Date;
  /** If true, show "Select days" title instead of "Repeat this?" */
  isOvernight?: boolean;
}

const ALL_DAYS = [0, 1, 2, 3, 4, 5, 6]; // Sun-Sat
const WEEKDAY_HEADERS = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];

/** Format a Date to 'YYYY-MM-DD' */
const toISODate = (d: Date): string => {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
};

/** Get all dates between start and end (inclusive) as ISO strings */
const getDateRange = (start: Date, end: Date): string[] => {
  const dates: string[] = [];
  const current = new Date(start);
  current.setHours(0, 0, 0, 0);
  const endNorm = new Date(end);
  endNorm.setHours(0, 0, 0, 0);
  while (current <= endNorm) {
    dates.push(toISODate(current));
    current.setDate(current.getDate() + 1);
  }
  return dates;
};

/** Get month grid data for a given year/month */
const getMonthGrid = (year: number, month: number) => {
  const firstDay = new Date(year, month, 1).getDay(); // 0=Sun
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const weeks: (number | null)[][] = [];
  let week: (number | null)[] = Array(firstDay).fill(null);
  for (let d = 1; d <= daysInMonth; d++) {
    week.push(d);
    if (week.length === 7) {
      weeks.push(week);
      week = [];
    }
  }
  if (week.length > 0) {
    while (week.length < 7) week.push(null);
    weeks.push(week);
  }
  return weeks;
};

const MONTH_NAMES = ['January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December'];

const RepeatScheduleModal: React.FC<Props> = ({
  visible, onClose, onConfirm, onClear, currentSchedule,
  stayStartDate, stayEndDate, isOvernight,
}) => {
  const { colors } = useTheme();

  const [repeatType, setRepeatType] = useState<'daily' | 'weekly' | 'custom' | 'specificDates'>('daily');
  const [weeklyDay, setWeeklyDay] = useState(1);
  const [customDays, setCustomDays] = useState<Set<number>>(new Set());
  const [selectedDates, setSelectedDates] = useState<Set<string>>(new Set());

  const originalRef = useRef<{ type: string; weeklyDay: number; customDays: number[]; selectedDates: string[] } | null>(null);

  // All valid dates within the stay range
  const stayDates = useMemo(() => {
    if (!stayStartDate || !stayEndDate) return [];
    return getDateRange(stayStartDate, stayEndDate);
  }, [stayStartDate, stayEndDate]);

  const stayDateSet = useMemo(() => new Set(stayDates), [stayDates]);

  // Months to show in calendar
  const calendarMonths = useMemo(() => {
    if (!stayStartDate || !stayEndDate) return [];
    const months: { year: number; month: number }[] = [];
    const start = new Date(stayStartDate);
    const end = new Date(stayEndDate);
    let y = start.getFullYear(), m = start.getMonth();
    const endY = end.getFullYear(), endM = end.getMonth();
    while (y < endY || (y === endY && m <= endM)) {
      months.push({ year: y, month: m });
      m++;
      if (m > 11) { m = 0; y++; }
    }
    return months;
  }, [stayStartDate, stayEndDate]);

  useEffect(() => {
    if (visible) {
      if (currentSchedule) {
        setRepeatType(currentSchedule.type);
        setWeeklyDay(currentSchedule.weeklyDay ?? 1);
        setCustomDays(new Set(currentSchedule.customDays ?? []));
        setSelectedDates(new Set(currentSchedule.specificDates ?? []));
        originalRef.current = {
          type: currentSchedule.type,
          weeklyDay: currentSchedule.weeklyDay ?? 1,
          customDays: Array.from(currentSchedule.customDays ?? []).sort(),
          selectedDates: Array.from(currentSchedule.specificDates ?? []).sort(),
        };
      } else {
        setRepeatType('daily');
        setWeeklyDay(1);
        setCustomDays(new Set());
        setSelectedDates(new Set());
        originalRef.current = null;
      }
    }
  }, [visible]);

  const hasChanges = (): boolean => {
    if (!originalRef.current) return false;
    if (repeatType !== originalRef.current.type) return true;
    if (repeatType === 'weekly' && weeklyDay !== originalRef.current.weeklyDay) return true;
    if (repeatType === 'custom') {
      const sorted = Array.from(customDays).sort();
      if (sorted.length !== originalRef.current.customDays.length) return true;
      return sorted.some((d, i) => d !== originalRef.current!.customDays[i]);
    }
    if (repeatType === 'specificDates') {
      const sorted = Array.from(selectedDates).sort();
      if (sorted.length !== originalRef.current.selectedDates.length) return true;
      return sorted.some((d, i) => d !== originalRef.current!.selectedDates[i]);
    }
    return false;
  };

  const toggleCustomDay = (day: number) => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setCustomDays(prev => {
      const next = new Set(prev);
      if (next.has(day)) next.delete(day);
      else next.add(day);
      if (next.size === 7) {
        setRepeatType('daily');
        return new Set();
      }
      return next;
    });
  };

  const toggleDate = (dateStr: string) => {
    if (!stayDateSet.has(dateStr)) return;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setSelectedDates(prev => {
      const next = new Set(prev);
      if (next.has(dateStr)) next.delete(dateStr);
      else next.add(dateStr);
      return next;
    });
  };

  const handleConfirm = () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    if (repeatType === 'custom' && customDays.size === 0) return;
    if (repeatType === 'specificDates' && selectedDates.size === 0) return;

    const schedule: RepeatSchedule = { type: repeatType };
    if (repeatType === 'weekly') schedule.weeklyDay = weeklyDay;
    if (repeatType === 'custom') schedule.customDays = Array.from(customDays).sort();
    if (repeatType === 'specificDates') schedule.specificDates = Array.from(selectedDates).sort();

    onConfirm(schedule);
  };

  const handleClose = () => {
    if (hasChanges()) {
      Alert.alert(
        'Discard changes?',
        'Any edits you made will be lost.',
        [
          { text: 'Keep Editing', style: 'cancel' },
          { text: 'Discard', style: 'destructive', onPress: () => onClose() },
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

  const confirmDisabled = (repeatType === 'custom' && customDays.size === 0) ||
    (repeatType === 'specificDates' && selectedDates.size === 0);

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={handleClose}>
      <View style={styles.overlay}>
        <View style={[styles.sheet, { backgroundColor: colors.surface, maxHeight: '85%' }]}>
          {/* Header */}
          <View style={styles.header}>
            <Text style={[styles.modalTitle, { color: colors.text }]}>
              {isOvernight ? 'Select days' : 'Repeat this?'}
            </Text>
            <TouchableOpacity
              onPress={handleClose}
              activeOpacity={0.7}
              hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
            >
              <Text style={[styles.closeX, { color: colors.textSecondary }]}>✕</Text>
            </TouchableOpacity>
          </View>

          <ScrollView showsVerticalScrollIndicator={false} bounces={false}>
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

            {/* Radio: Specific dates — only for overnight stays */}
            {isOvernight && stayDates.length > 0 && (
              <>
                <TouchableOpacity
                  style={[styles.radioRow, repeatType === 'specificDates' && { backgroundColor: colors.primary + '10' }]}
                  onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); setRepeatType('specificDates'); }}
                  activeOpacity={0.7}
                >
                  <Text style={[styles.radioLabel, { color: colors.text }]}>Specific dates</Text>
                  <Text style={[styles.radio, { color: repeatType === 'specificDates' ? colors.primary : colors.textSecondary }]}>
                    {repeatType === 'specificDates' ? '●' : '○'}
                  </Text>
                </TouchableOpacity>

                {/* Calendar grid */}
                {repeatType === 'specificDates' && calendarMonths.map(({ year, month }) => (
                  <View key={`${year}-${month}`} style={{ marginBottom: 16, paddingHorizontal: spacing.md }}>
                    <Text style={{ color: colors.text, fontSize: 16, fontWeight: '600', marginBottom: 8, textAlign: 'center' }}>
                      {MONTH_NAMES[month]} {year}
                    </Text>
                    {/* Weekday headers */}
                    <View style={{ flexDirection: 'row' }}>
                      {WEEKDAY_HEADERS.map((h, i) => (
                        <View key={i} style={{ flex: 1, alignItems: 'center', paddingVertical: 4 }}>
                          <Text style={{ color: colors.textSecondary, fontSize: 12, fontWeight: '600' }}>{h}</Text>
                        </View>
                      ))}
                    </View>
                    {/* Day grid */}
                    {getMonthGrid(year, month).map((week, wIdx) => (
                      <View key={wIdx} style={{ flexDirection: 'row' }}>
                        {week.map((day, dIdx) => {
                          if (day === null) {
                            return <View key={dIdx} style={{ flex: 1, height: 40 }} />;
                          }
                          const dateStr = toISODate(new Date(year, month, day));
                          const inRange = stayDateSet.has(dateStr);
                          const isSelected = selectedDates.has(dateStr);
                          return (
                            <TouchableOpacity
                              key={dIdx}
                              style={{
                                flex: 1, height: 40, alignItems: 'center', justifyContent: 'center',
                                borderRadius: 20,
                                backgroundColor: isSelected ? colors.primary : (inRange ? colors.primary + '15' : 'transparent'),
                              }}
                              onPress={() => inRange && toggleDate(dateStr)}
                              activeOpacity={inRange ? 0.7 : 1}
                              disabled={!inRange}
                            >
                              <Text style={{
                                fontSize: 15,
                                fontWeight: isSelected ? '700' : '400',
                                color: isSelected ? '#fff' : (inRange ? colors.text : colors.textSecondary + '40'),
                              }}>
                                {day}
                              </Text>
                            </TouchableOpacity>
                          );
                        })}
                      </View>
                    ))}
                  </View>
                ))}
              </>
            )}

            {/* Confirm */}
            <TouchableOpacity
              style={[
                styles.confirmBtn,
                { backgroundColor: confirmDisabled ? colors.border : colors.primary },
              ]}
              onPress={handleConfirm}
              activeOpacity={0.8}
              disabled={confirmDisabled}
            >
              <Text style={styles.confirmBtnText}>Confirm</Text>
            </TouchableOpacity>

            {/* Remove repeat */}
            {currentSchedule && (
              <TouchableOpacity style={styles.clearBtn} onPress={handleClear}>
                <Text style={[styles.clearBtnText, { color: '#FF3B30' }]}>Remove</Text>
              </TouchableOpacity>
            )}
          </ScrollView>
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
