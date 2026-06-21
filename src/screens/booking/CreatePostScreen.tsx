/**
 * CreatePostScreen — Wave 19B
 *
 * - Care type selector (4 options: overnight, daySitting, feeding, dogWalking)
 * - Dynamic form per care type
 * - Points: poster sets the amount (pointsOffered)
 * - Overnight: date range + flat amount for whole job
 * - Day sitting: single date + start/end time + flat amount for whole job
 * - Feeding: single date + feeding time + flat amount for whole job
 * - Dog walking: no calendar + duration pill selector + flat amount for whole job
 */
import React, { useEffect, useMemo, useState, useRef, useCallback } from 'react';
import {
  View, Text, TextInput, TouchableOpacity, StyleSheet, ScrollView,
  Alert, Platform, Switch, Image, ActivityIndicator, Animated, Dimensions, Modal, KeyboardAvoidingView } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import DateTimePicker, { DateTimePickerEvent } from '@react-native-community/datetimepicker';
import { Calendar, DateData } from 'react-native-calendars';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import * as Haptics from 'expo-haptics';
import * as ImagePicker from 'expo-image-picker';
import { Ionicons } from '@expo/vector-icons';
import CharCountHint from '../../components/common/CharCountHint';
import * as Location from 'expo-location';
import { RequestsStackParamList } from '../../navigation/types';
import { useAuthContext } from '../../contexts/AuthContext';
import { useTheme } from '../../contexts/ThemeContext';
import { useKeyboardScroll } from '../../hooks/useKeyboardScroll';
import { useDogs } from '../../hooks/useDogs';
import { useSwaps } from '../../hooks/useSwaps';
import { Dog, CompensationType, CareType, RepeatSchedule, formatRepeatLabel, formatRepeatSubLabel } from '../../models/types';
import { spacing, borderRadius, typography } from '../../config/theme';
import { uploadPhotoToStorage } from '../../utils/uploadHelper';
import { BlurView } from 'expo-blur';
import { onPostCreated } from '../../services/ReviewPromptService';
import LoadingSpinner from '../../components/common/LoadingSpinner';
import RepeatScheduleModal from '../../components/common/RepeatScheduleModal';
import ConfettiCelebration, { CelebrationItem } from '../../components/common/ConfettiCelebration';
import Chip from '../../components/common/Chip';
import { formatDogAge } from '../../utils/formatDogAge';
import KeyboardDoneBar, { DONE_ACCESSORY_ID } from '../../components/common/KeyboardDoneBar';

const MIN_CARE_DETAILS = 50;
const RED = '#FF2D55';


const PRIMARY_CARE_OPTIONS: { type: 'overnight' | 'daySitting'; icon: string; label: string }[] = [
  { type: 'overnight', icon: '🏠', label: 'Overnight sitting' },
  { type: 'daySitting', icon: '☀️', label: 'Daytime sitting' },
];

const ADDON_CARE_OPTIONS: { type: CareType; icon: string; label: string }[] = [
  { type: 'feeding', icon: '🍽️', label: 'Feeding' },
  { type: 'dogWalking', icon: '🐕', label: 'Walk' },
  { type: 'playtime', icon: '🎾', label: 'Playtime' },
  { type: 'medication', icon: '💊', label: 'Medication' },
];

type Props = {
  navigation: NativeStackNavigationProp<RequestsStackParamList, 'Requests'>;
};

const CreatePostScreen: React.FC<Props> = ({ navigation }) => {
  const { colors } = useTheme();
  const { scrollRef: kbScrollRef, onScroll: kbOnScroll, refFor, scrollToInput } = useKeyboardScroll();

  // ── Validation pulse animation ──
  const pulseAnim = useRef(new Animated.Value(1)).current;
  const glowAnim = useRef(new Animated.Value(0)).current;
  const [pulsingSection, setPulsingSection] = useState<string | null>(null);

  const scrollAndPulse = useCallback((sectionKey: string) => {
    const view = viewRefs.current[sectionKey];
    if (!view) return;
    // Scroll to center the section
    view.measureInWindow((_x: number, winY: number, _w: number, h: number) => {
      if (winY === undefined) return;
      const screenHeight = Dimensions.get('window').height;
      const centerOffset = winY - (screenHeight / 2) + (h / 2);
      kbScrollRef.current?.scrollTo({
        y: scrollY.current + centerOffset,
        animated: true,
      });
    });
    // Trigger pulse + glow after scroll completes
    setTimeout(() => {
      setPulsingSection(sectionKey);
      pulseAnim.setValue(1);
      glowAnim.setValue(0);
      Animated.sequence([
        // Pulse 1
        Animated.parallel([
          Animated.sequence([
            Animated.timing(pulseAnim, { toValue: 1.02, duration: 200, useNativeDriver: true }),
            Animated.timing(pulseAnim, { toValue: 1, duration: 200, useNativeDriver: true }),
          ]),
          Animated.sequence([
            Animated.timing(glowAnim, { toValue: 1, duration: 200, useNativeDriver: false }),
            Animated.timing(glowAnim, { toValue: 0, duration: 200, useNativeDriver: false }),
          ]),
        ]),
        // Pulse 2
        Animated.parallel([
          Animated.sequence([
            Animated.timing(pulseAnim, { toValue: 1.02, duration: 200, useNativeDriver: true }),
            Animated.timing(pulseAnim, { toValue: 1, duration: 200, useNativeDriver: true }),
          ]),
          Animated.sequence([
            Animated.timing(glowAnim, { toValue: 1, duration: 200, useNativeDriver: false }),
            Animated.timing(glowAnim, { toValue: 0, duration: 200, useNativeDriver: false }),
          ]),
        ]),
      ]).start(() => setPulsingSection(null));
    }, 500);
  }, []);

  const viewRefs = useRef<Record<string, View | null>>({});
  const scrollY = useRef(0);
  const validationRefFor = useCallback(
    (key: string) => (node: View | null) => { viewRefs.current[key] = node; },
    [],
  );

  const showValidationAlert = useCallback((title: string, msg: string, sectionKey: string) => {
    Alert.alert(title, msg, [
      { text: 'OK', onPress: () => scrollAndPulse(sectionKey) },
    ]);
  }, [scrollAndPulse]);
  const { user, userProfile } = useAuthContext();
  const { getDogsByOwner } = useDogs();
  const { createPost } = useSwaps();

  const [myDogs, setMyDogs] = useState<Dog[]>([]);
  const [selectedDogIds, setSelectedDogIds] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [celebrationQueue, setCelebrationQueue] = useState<CelebrationItem[]>([]);

  // Care type
  const [primaryCareType, setPrimaryCareType] = useState<'overnight' | 'daySitting' | null>(null);
  const [addOnCareTypes, setAddOnCareTypes] = useState<Set<CareType>>(new Set());
  const [overnightLocation, setOvernightLocation] = useState<'my_home' | 'sitters_home' | 'no_preference' | null>(null);
  // Address modal state
  const [showAddressModal, setShowAddressModal] = useState(false);
  const [careAddress, setCareAddress] = useState('');
  const [savedAddresses, setSavedAddresses] = useState<string[]>([]);
  // Sitter's home: pickup or dropoff
  const [sitterTransport, setSitterTransport] = useState<'pickup' | 'dropoff' | null>(null);
  // Playtime — multi-session support (max 5 sessions)
  interface PlaySession {
    flexible: boolean;
    startDate: Date;
    endDate: Date;
    showStart: boolean;
    showEnd: boolean;
    durationMins: number;
    repeatSchedule: RepeatSchedule | null;
    dogIds: string[];
    instructions: string;
    photos: string[];
    showInstructions: boolean;
  }
  const makeDefaultPlaySession = (): PlaySession => ({
    flexible: false,
    startDate: (() => { const d = new Date(); d.setHours(10, 0, 0, 0); return d; })(),
    endDate: (() => { const d = new Date(); d.setHours(11, 0, 0, 0); return d; })(),
    showStart: false,
    showEnd: false,
    durationMins: 60,
    repeatSchedule: null,
    dogIds: [],
    instructions: '',
    photos: [],
    showInstructions: false,
  });
  const [playSessions, setPlaySessions] = useState<PlaySession[]>([makeDefaultPlaySession()]);
  interface WalkSession {
  startDate: Date;
  endDate: Date;
  showStart: boolean;
  showEnd: boolean;
  dogIds: string[];
  repeatSchedule: RepeatSchedule | null;
  instructions: string;
  photos: string[];
  showInstructions: boolean;
}

const makeDefaultWalkSession = (): WalkSession => ({
  startDate: (() => { const d = new Date(); d.setHours(8, 0, 0, 0); return d; })(),
  endDate: (() => { const d = new Date(); d.setHours(9, 0, 0, 0); return d; })(),
  showStart: false,
  showEnd: false,
  dogIds: [],
  repeatSchedule: null,
  instructions: '',
  photos: [],
  showInstructions: false,
});

const MAX_WALK_SESSIONS = 5;
const MAX_PLAY_SESSIONS = 5;
  const addPlaySession = () => {
    if (playSessions.length >= MAX_PLAY_SESSIONS) return;
    // Auto-collapse all existing play sessions
    setCollapsedPlay(new Set(playSessions.map((_, i) => i)));
    setPlaySessions(prev => [...prev, makeDefaultPlaySession()]);
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
  };
  const removePlaySession = (index: number) => {
    if (playSessions.length <= 1) return;
    setPlaySessions(prev => prev.filter((_, i) => i !== index));
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
  };
  const updatePlaySession = (index: number, updates: Partial<PlaySession>) => {
    setPlaySessions(prev => {
      const updated = prev.map((s, i) => i === index ? { ...s, ...updates } : s);
      if (updates.startDate) {
        const newStart = updates.startDate;
        // Duplicate start time check
        const isDuplicate = prev.some((s, i) => i !== index && isSameTime(s.startDate, newStart));
        if (isDuplicate) {
          Alert.alert('Duplicate Time', `You already have a playtime starting at ${formatTimeShort(newStart)}. Please pick a different time.`);
          return prev;
        }
        // Overlap check: new playtime can't start before previous ends
        const sorted = [...updated].sort((a, b) => timeToMins(a.startDate) - timeToMins(b.startDate));
        for (let i = 1; i < sorted.length; i++) {
          if (timeToMins(sorted[i].startDate) < timeToMins(sorted[i - 1].endDate)) {
            Alert.alert('Playtime Overlap', `This playtime can${"'"}t start before the previous one ends (${formatTimeShort(sorted[i - 1].endDate)}). Please adjust the time.`);
            return prev;
          }
        }
        return sorted;
      }
      if (updates.endDate) {
        return [...updated].sort((a, b) => timeToMins(a.startDate) - timeToMins(b.startDate));
      }
      return updated;
    });
  };
  // Repeat schedule modal state
  const [repeatModalVisible, setRepeatModalVisible] = useState(false);
  const [repeatModalTarget, setRepeatModalTarget] = useState<{ kind: 'feeding' | 'walk' | 'play' | 'medication'; index: number } | null>(null);
  const openRepeatModal = (kind: 'feeding' | 'walk' | 'play' | 'medication', index: number) => {
    setRepeatModalTarget({ kind, index });
    setRepeatModalVisible(true);
  };
  const getRepeatScheduleForTarget = (): RepeatSchedule | null => {
    if (!repeatModalTarget) return null;
    const { kind, index } = repeatModalTarget;
    if (kind === 'feeding') return feedingSlots[index]?.repeatSchedule ?? null;
    if (kind === 'walk') return walkSessions[index]?.repeatSchedule ?? null;
    if (kind === 'play') return playSessions[index]?.repeatSchedule ?? null;
    if (kind === 'medication') return medicationSlots[index]?.repeatSchedule ?? null;
    return null;
  };
  const getRepeatDefaultTime = (): Date | undefined => {
    if (!repeatModalTarget) return undefined;
    const { kind, index } = repeatModalTarget;
    if (kind === 'feeding') return feedingSlots[index]?.time;
    if (kind === 'walk') return walkSessions[index]?.startDate;
    if (kind === 'play') return playSessions[index]?.startDate;
    if (kind === 'medication') return medicationSlots[index]?.time;
    return undefined;
  };
  const handleRepeatConfirm = (schedule: RepeatSchedule) => {
    if (!repeatModalTarget) return;
    const { kind, index } = repeatModalTarget;
    if (kind === 'feeding') updateFeedingSlot(index, 'repeatSchedule', schedule);
    if (kind === 'walk') updateWalkSession(index, { repeatSchedule: schedule });
    if (kind === 'play') updatePlaySession(index, { repeatSchedule: schedule });
    if (kind === 'medication') updateMedicationSlot(index, 'repeatSchedule', schedule);
    setRepeatModalVisible(false);
    setRepeatModalTarget(null);
  };
  const handleRepeatClear = () => {
    if (!repeatModalTarget) return;
    const { kind, index } = repeatModalTarget;
    if (kind === 'feeding') updateFeedingSlot(index, 'repeatSchedule', null);
    if (kind === 'walk') updateWalkSession(index, { repeatSchedule: null });
    if (kind === 'play') updatePlaySession(index, { repeatSchedule: null });
    if (kind === 'medication') updateMedicationSlot(index, 'repeatSchedule', null);
    setRepeatModalVisible(false);
    setRepeatModalTarget(null);
  };

  const [collapsedFeedings, setCollapsedFeedings] = useState<Set<number>>(new Set());
  const [collapsedWalks, setCollapsedWalks] = useState<Set<number>>(new Set());
  const [collapsedPlay, setCollapsedPlay] = useState<Set<number>>(new Set());

  const toggleCollapse = (setter: React.Dispatch<React.SetStateAction<Set<number>>>, idx: number) => {
    setter(prev => {
      const next = new Set(prev);
      if (next.has(idx)) next.delete(idx);
      else next.add(idx);
      return next;
    });
  };
  const toggleAddOn = (type: CareType) => {
    setAddOnCareTypes(prev => {
      const next = new Set(prev);
      if (next.has(type)) next.delete(type);
      else next.add(type);
      return next;
    });
  };

  // Derived: primary care type for conditional fields
  const careType = primaryCareType;



  // Dates — used for overnight (range) and daySitting/feeding (single)
  const [startDate, setStartDate] = useState(() => {
    const d = new Date();
    d.setDate(d.getDate() + 1);
    return d;
  });
  const [endDate, setEndDate] = useState(() => {
    const d = new Date();
    d.setDate(d.getDate() + 3);
    return d;
  });
  const [showStart, setShowStart] = useState(false);
  const [showEnd, setShowEnd] = useState(false);
  const [showRangeCalendar, setShowRangeCalendar] = useState(false);
  const [rangeSelectStep, setRangeSelectStep] = useState<'start' | 'end'>('start');
  const [endDateSelected, setEndDateSelected] = useState(false);
  const [startDateSelected, setStartDateSelected] = useState(false);

  // Time fields — Date objects for native spinner picker
  const [startTimeDate, setStartTimeDate] = useState(() => {
    const d = new Date(); d.setHours(9, 0, 0, 0); return d;
  });
  const [endTimeDate, setEndTimeDate] = useState(() => {
    const d = new Date(); d.setHours(17, 0, 0, 0); return d;
  });
  const [showStartTime, setShowStartTime] = useState(false);
  const [showEndTime, setShowEndTime] = useState(false);
  // Feeding slots — Date objects for native spinner
  const [feedingSlots, setFeedingSlots] = useState<{ time: Date; repeatSchedule: RepeatSchedule | null; showPicker: boolean; dogIds: string[]; instructions: string; photos: string[]; showInstructions: boolean }[]>([
    { time: (() => { const d = new Date(); d.setHours(8, 0, 0, 0); return d; })(), repeatSchedule: null, showPicker: false, dogIds: [], instructions: '', photos: [], showInstructions: false },
  ]);

  const updateFeedingSlot = (index: number, field: string, value: unknown) => {
    setFeedingSlots(prev => {
      const updated = prev.map((slot, i) => i === index ? { ...slot, [field]: value } : slot);
      if (field === 'time') {
        const newTime = value as Date;
        const isDuplicate = prev.some((slot, i) => i !== index && isSameTime(slot.time, newTime));
        if (isDuplicate) {
          Alert.alert('Duplicate Time', `You already have a feeding at ${formatTimeShort(newTime)}. Please pick a different time.`);
          return prev;
        }
        // Auto-sort by time earliest → latest
        return [...updated].sort((a, b) => timeToMins(a.time) - timeToMins(b.time));
      }
      return updated;
    });
  };

  const removeFeedingSlot = (index: number) => {
    if (feedingSlots.length <= 1) return;
    setFeedingSlots(prev => prev.filter((_, i) => i !== index));
  };

  const addFeedingSlot = () => {
    const d = new Date(); d.setHours(12, 0, 0, 0);
    // Auto-collapse all existing feeding slots
    setCollapsedFeedings(new Set(feedingSlots.map((_, i) => i)));
    setFeedingSlots(prev => [...prev, { time: d, repeatSchedule: null, showPicker: false, dogIds: [...selectedDogIds], instructions: '', photos: [], showInstructions: false }]);
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
  };

  // Walk sessions array (multi-walk support)
  // Medication slots
  const [medicationSlots, setMedicationSlots] = useState<{ time: Date; extraTimes: { time: Date; showPicker: boolean }[]; details: string; repeatSchedule: RepeatSchedule | null; showPicker: boolean; dogIds: string[]; photos: string[] }[]>([
    { time: (() => { const d = new Date(); d.setHours(8, 0, 0, 0); return d; })(), extraTimes: [], details: '', repeatSchedule: null, showPicker: false, dogIds: [...selectedDogIds], photos: [] },
  ]);
  const updateMedicationSlot = (index: number, field: string, value: unknown) => {
    setMedicationSlots(prev => prev.map((slot, i) => {
      if (i !== index) return slot;
      if (field === 'time') {
        const newTime = value as Date;
        // Duplicate check against extra times in this slot
        if (slot.extraTimes.some(et => isSameTime(et.time, newTime))) {
          Alert.alert('Duplicate Time', `You already have medication at ${formatTimeShort(newTime)}. Please pick a different time.`);
          return slot;
        }
        // After updating primary time, re-sort all times: rebuild so primary is always earliest
        const allExtra = [...slot.extraTimes].sort((a, b) => timeToMins(a.time) - timeToMins(b.time));
        return { ...slot, time: newTime, extraTimes: allExtra };
      }
      return { ...slot, [field]: value };
    }));
  };
  const removeMedicationSlot = (index: number) => {
    if (medicationSlots.length <= 1) return;
    setMedicationSlots(prev => prev.filter((_, i) => i !== index));
  };
  const addMedicationSlot = () => {
    const d = new Date(); d.setHours(8, 0, 0, 0);
    // Auto-collapse all existing medication slots
    setCollapsedMeds(new Set(medicationSlots.map((_, i) => i)));
    setMedicationSlots(prev => [...prev, { time: d, extraTimes: [], details: '', repeatSchedule: null, showPicker: false, dogIds: [...selectedDogIds], photos: [] }]);
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
  };
  const addMedExtraTime = (slotIdx: number) => {
    setMedicationSlots(prev => prev.map((slot, i) => {
      if (i !== slotIdx) return slot;
      const d = new Date();
      // Default to 3 hours after the last time
      const lastTime = slot.extraTimes.length > 0
        ? slot.extraTimes[slot.extraTimes.length - 1].time
        : slot.time;
      d.setHours(lastTime.getHours() + 3, lastTime.getMinutes(), 0, 0);
      const newExtras = [...slot.extraTimes, { time: d, showPicker: false }]
        .sort((a, b) => timeToMins(a.time) - timeToMins(b.time));
      return { ...slot, extraTimes: newExtras };
    }));
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
  };
  const updateMedExtraTime = (slotIdx: number, timeIdx: number, newTime: Date) => {
    setMedicationSlots(prev => prev.map((slot, i) => {
      if (i !== slotIdx) return slot;
      // Duplicate check: compare against primary time and all other extra times
      const allTimes = [slot.time, ...slot.extraTimes.filter((_, j) => j !== timeIdx).map(et => et.time)];
      if (allTimes.some(t => isSameTime(t, newTime))) {
        Alert.alert('Duplicate Time', `You already have medication at ${formatTimeShort(newTime)}. Please pick a different time.`);
        return slot;
      }
      const updated = slot.extraTimes.map((et, j) => j === timeIdx ? { ...et, time: newTime } : et);
      // Auto-sort extra times earliest → latest
      const sorted = [...updated].sort((a, b) => timeToMins(a.time) - timeToMins(b.time));
      return { ...slot, extraTimes: sorted };
    }));
  };
  const toggleMedExtraTimePicker = (slotIdx: number, timeIdx: number) => {
    setMedicationSlots(prev => prev.map((slot, i) => {
      if (i !== slotIdx) return slot;
      const updated = slot.extraTimes.map((et, j) => j === timeIdx ? { ...et, showPicker: !et.showPicker } : et);
      return { ...slot, extraTimes: updated };
    }));
  };
  const removeMedExtraTime = (slotIdx: number, timeIdx: number) => {
    setMedicationSlots(prev => prev.map((slot, i) => {
      if (i !== slotIdx) return slot;
      return { ...slot, extraTimes: slot.extraTimes.filter((_, j) => j !== timeIdx) };
    }));
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
  };
  const [collapsedMeds, setCollapsedMeds] = useState<Set<number>>(new Set());
  const [servicesCollapsed, setServicesCollapsed] = useState(false);
  const [careDetailsCollapsed, setCareDetailsCollapsed] = useState(true);
  const [compensationCollapsed, setCompensationCollapsed] = useState(false);

  const [walkSessions, setWalkSessions] = useState<WalkSession[]>([makeDefaultWalkSession()]);
  const addWalkSession = () => {
    if (walkSessions.length >= MAX_WALK_SESSIONS) return;
    // Auto-collapse all existing walk sessions
    setCollapsedWalks(new Set(walkSessions.map((_, i) => i)));
    setWalkSessions(prev => [...prev, makeDefaultWalkSession()]);
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
  };
  const removeWalkSession = (idx: number) => {
    setWalkSessions(prev => prev.filter((_: WalkSession, i: number) => i !== idx));
  };
  const updateWalkSession = (idx: number, updates: Partial<WalkSession>) => {
    setWalkSessions(prev => {
      const updated = prev.map((s: WalkSession, i: number) => i === idx ? { ...s, ...updates } : s);
      if (updates.startDate) {
        const newStart = updates.startDate;
        // Duplicate start time check
        const isDuplicate = prev.some((s, i) => i !== idx && isSameTime(s.startDate, newStart));
        if (isDuplicate) {
          Alert.alert('Duplicate Time', `You already have a walk starting at ${formatTimeShort(newStart)}. Please pick a different time.`);
          return prev;
        }
        // Overlap check: new walk can't start before a previous walk ends
        const sorted = [...updated].sort((a, b) => timeToMins(a.startDate) - timeToMins(b.startDate));
        for (let i = 1; i < sorted.length; i++) {
          if (timeToMins(sorted[i].startDate) < timeToMins(sorted[i - 1].endDate)) {
            Alert.alert('Walk Overlap', `This walk can${"'"}t start before the previous walk ends (${formatTimeShort(sorted[i - 1].endDate)}). Please adjust the time.`);
            return prev;
          }
        }
        return sorted;
      }
      if (updates.endDate) {
        // Re-sort after end time change too
        return [...updated].sort((a, b) => timeToMins(a.startDate) - timeToMins(b.startDate));
      }
      return updated;
    });
  };


  // ── Time helpers: duplicate check, auto-sort ──
  const timeToMins = (d: Date) => d.getHours() * 60 + d.getMinutes();
  const isSameTime = (a: Date, b: Date) => timeToMins(a) === timeToMins(b);
  const formatTimeShort = (d: Date) => d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });


  // ── Service-level photo picker ──
  const MAX_SERVICE_PHOTOS = 3;
  const pickServicePhoto = async (type: 'feeding' | 'walk' | 'play' | 'medication', index: number) => {
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      quality: 0.7,
    });
    if (result.canceled || !result.assets?.[0]?.uri) return;
    const uri = result.assets[0].uri;
    if (type === 'feeding') {
      setFeedingSlots(prev => prev.map((s, i) => i === index ? { ...s, photos: [...s.photos, uri].slice(0, MAX_SERVICE_PHOTOS) } : s));
    } else if (type === 'walk') {
      setWalkSessions(prev => prev.map((s, i) => i === index ? { ...s, photos: [...s.photos, uri].slice(0, MAX_SERVICE_PHOTOS) } : s));
    } else if (type === 'play') {
      setPlaySessions(prev => prev.map((s, i) => i === index ? { ...s, photos: [...s.photos, uri].slice(0, MAX_SERVICE_PHOTOS) } : s));
    } else if (type === 'medication') {
      setMedicationSlots(prev => prev.map((s, i) => i === index ? { ...s, photos: [...s.photos, uri].slice(0, MAX_SERVICE_PHOTOS) } : s));
    }
  };
  const removeServicePhoto = (type: 'feeding' | 'walk' | 'play' | 'medication', slotIndex: number, photoIndex: number) => {
    if (type === 'feeding') {
      setFeedingSlots(prev => prev.map((s, i) => i === slotIndex ? { ...s, photos: s.photos.filter((_, j) => j !== photoIndex) } : s));
    } else if (type === 'walk') {
      setWalkSessions(prev => prev.map((s, i) => i === slotIndex ? { ...s, photos: s.photos.filter((_, j) => j !== photoIndex) } : s));
    } else if (type === 'play') {
      setPlaySessions(prev => prev.map((s, i) => i === slotIndex ? { ...s, photos: s.photos.filter((_, j) => j !== photoIndex) } : s));
    } else if (type === 'medication') {
      setMedicationSlots(prev => prev.map((s, i) => i === slotIndex ? { ...s, photos: s.photos.filter((_, j) => j !== photoIndex) } : s));
    }
  };

  // Care details
  const [careDetails, setCareDetails] = useState('');
  const [carePhotos, setCarePhotos] = useState<string[]>([]);
  const [uploadingPhoto, setUploadingPhoto] = useState(false);
  // ── Care Photo Picker ──
  const MAX_CARE_PHOTOS = 5;

  const addCarePhoto = () => {
    Alert.alert('Add Photo', 'Choose how to add a photo', [
      { text: 'Camera', onPress: takePhotoForCare },
      { text: 'Photo Library', onPress: pickPhotoForCare },
      { text: 'Cancel', style: 'cancel' },
    ]);
  };

  const pickPhotoForCare = async () => {
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      allowsEditing: true,
      quality: 0.7,
    });
    if (!result.canceled && result.assets?.[0]) {
      setCarePhotos(prev => [...prev, result.assets[0].uri]);
    }
  };

  const takePhotoForCare = async () => {
    const { status } = await ImagePicker.requestCameraPermissionsAsync();
    if (status !== 'granted') {
      Alert.alert('Camera Access', 'Please allow camera access in Settings to take photos.');
      return;
    }
    const result = await ImagePicker.launchCameraAsync({ quality: 0.7 });
    if (!result.canceled && result.assets?.[0]) {
      setCarePhotos(prev => [...prev, result.assets[0].uri]);
    }
  };

  const removeCarePhoto = (index: number) => {
    setCarePhotos(prev => prev.filter((_, i) => i !== index));
  };

  // Format a Date to "h:mm AM/PM"
  const formatTime12 = (d: Date): string => {
    let h = d.getHours();
    const m = d.getMinutes();
    const period = h >= 12 ? 'PM' : 'AM';
    h = h % 12 || 12;
    return `${h}:${m.toString().padStart(2, '0')} ${period}`;
  };

  // Derived formatted times
  const startTime = formatTime12(startTimeDate);
  const endTime = formatTime12(endTimeDate);
  // Play time formatting is now per-session (computed inline)
  // Total walk duration across all sessions
  const walkDurationMins = walkSessions.reduce((total: number, ws: WalkSession) => {
    let startMins = ws.startDate.getHours() * 60 + ws.startDate.getMinutes();
    let endMins = ws.endDate.getHours() * 60 + ws.endDate.getMinutes();
    return total + (endMins > startMins ? endMins - startMins : 0);
  }, 0);

  // Play duration helper — computed per session
  const getPlayDurationMins = (session: PlaySession) => {
    let sMins = session.startDate.getHours() * 60 + session.startDate.getMinutes();
    let eMins = session.endDate.getHours() * 60 + session.endDate.getMinutes();
    if (eMins <= sMins) eMins += 1440;
    return eMins - sMins;
  };
  const getPlayDurationText = (session: PlaySession) => {
    const mins = getPlayDurationMins(session);
    return mins >= 60
      ? `${Math.floor(mins / 60)}h ${mins % 60 > 0 ? `${mins % 60}m` : ''} play`.trim()
      : `${mins}m play`;
  };

  // Compensation
  const [offerPoints, setOfferPoints] = useState(true);
  const [offerMoney, setOfferMoney] = useState(false);
  const [paymentAmount, setPaymentAmount] = useState('');
  // Points offered (set by poster when NOT offering payment)
  const [pointsOffered, setPointsOffered] = useState('');
  const [showPricingGuide, setShowPricingGuide] = useState(false);

  // Load saved addresses from AsyncStorage
  useEffect(() => {
    AsyncStorage.getItem('saved_addresses').then(val => {
      if (val) setSavedAddresses(JSON.parse(val));
    }).catch(() => {});
  }, []);

  const suggestedAddress = userProfile?.locationName ?? '';

  // Address autocomplete (Nominatim / OpenStreetMap — same backend as Discover)
  const [addressQuery, setAddressQuery] = useState('');
  const [addressSuggestions, setAddressSuggestions] = useState<{ place_id: number; display_name: string }[]>([]);
  const [addressFetching, setAddressFetching] = useState(false);
  const addressDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const fetchAddressSuggestions = useCallback((q: string) => {
    if (q.trim().length < 2) { setAddressSuggestions([]); return; }
    setAddressFetching(true);
    void fetch(
      `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(q)}&format=json&addressdetails=1&limit=5&countrycodes=us`,
      { headers: { 'Accept-Language': 'en', 'User-Agent': 'SwapDogApp/1.0' } },
    )
      .then((r) => {
        if (!r || !r.ok) throw new Error('Geocode failed');
        return r.json() as Promise<{ place_id: number; display_name: string }[]>;
      })
      .then((results) => setAddressSuggestions(results))
      .catch(() => setAddressSuggestions([]))
      .finally(() => setAddressFetching(false));
  }, []);

  const handleAddressQueryChange = useCallback((text: string) => {
    setAddressQuery(text);
    if (addressDebounceRef.current) clearTimeout(addressDebounceRef.current);
    addressDebounceRef.current = setTimeout(() => fetchAddressSuggestions(text), 300);
  }, [fetchAddressSuggestions]);

  const saveAddress = async (addr: string) => {
    const trimmed = addr.trim();
    if (!trimmed) return;
    setCareAddress(trimmed);
    const updated = [trimmed, ...savedAddresses.filter(a => a !== trimmed)].slice(0, 5);
    setSavedAddresses(updated);
    await AsyncStorage.setItem('saved_addresses', JSON.stringify(updated));
    setShowAddressModal(false);
    setAddressQuery('');
    setAddressSuggestions([]);
  };

  useEffect(() => {
    if (!user) return;
    getDogsByOwner(user.uid).then((dogs) => {
      setMyDogs(dogs);
      if (dogs.length === 1) {
        setSelectedDogIds(new Set([dogs[0].id]));
      }
    }).finally(() => setLoading(false));
  }, [user]);

  const selectedDogs = useMemo(
    () => myDogs.filter((d) => selectedDogIds.has(d.id)),
    [myDogs, selectedDogIds]
  );


  // ── Sync per-section dogIds when top-level dog selection changes ──
  useEffect(() => {
    const ids = Array.from(selectedDogIds);
    // Walk sessions
    setWalkSessions((prev: WalkSession[]) => prev.map((s: WalkSession) => ({
      ...s,
      dogIds: s.dogIds.length === 0 ? ids : s.dogIds.filter((id: string) => selectedDogIds.has(id))
    })));
    // Medication slots — reset empty slots to all selected
    setMedicationSlots(prev => prev.map(s =>
      s.dogIds.length === 0 ? { ...s, dogIds: [...ids] } : s
    ));
    // Feeding slots — reset empty slots to all selected
    setFeedingSlots(prev => prev.map(s =>
      s.dogIds.length === 0 ? { ...s, dogIds: ids } : { ...s, dogIds: s.dogIds.filter(id => selectedDogIds.has(id)) }
    ));
    // Play sessions — reset empty slots to all selected
    setPlaySessions(prev => prev.map(s =>
      s.dogIds.length === 0 ? { ...s, dogIds: ids } : { ...s, dogIds: s.dogIds.filter(id => selectedDogIds.has(id)) }
    ));
  }, [selectedDogIds]);

  // ── Dog-assignment pill row (shown per section when 2+ dogs selected) ──
  const DogAssignRow = ({ activeDogIds, onToggle }: { activeDogIds: string[]; onToggle: (dogId: string) => void }) => {
    if (selectedDogs.length < 2) return null;
    return (
      <View style={styles.dogAssignRow}>
        {selectedDogs.map(dog => {
          const isOn = activeDogIds.includes(dog.id);
          return (
            <TouchableOpacity
              key={dog.id}
              style={[
                styles.dogAssignPill,
                { backgroundColor: isOn ? `${RED}18` : colors.background,
                  borderColor: isOn ? RED : colors.border },
              ]}
              onPress={() => onToggle(dog.id)}
              activeOpacity={0.7}
            >
              <Text style={[styles.dogAssignPillText, { color: isOn ? RED : colors.textSecondary }]}>
                {isOn ? '✓ ' : ''}{dog.name}
              </Text>
            </TouchableOpacity>
          );
        })}
      </View>
    );
  };

  const toggleDog = (dogId: string) => {
    setSelectedDogIds((prev) => {
      const next = new Set(prev);
      if (next.has(dogId)) next.delete(dogId); else next.add(dogId);
      return next;
    });
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
  };

  // --- Calculated values ---

  const dayCount = useMemo(() => {
    if (careType !== 'overnight') return 1;
    const MS_PER_DAY = 1000 * 60 * 60 * 24;
    const s = new Date(startDate); s.setHours(0, 0, 0, 0);
    const e = new Date(endDate); e.setHours(0, 0, 0, 0);
    return Math.max(1, Math.round((e.getTime() - s.getTime()) / MS_PER_DAY));
  }, [startDate, endDate, careType]);

  /** Total minutes from startTime → endTime for day sitting */
  const daySittingMinutes = useMemo(() => {
    try {
      const parse = (t: string) => {
        const [timePart, meridiem] = t.trim().split(' ');
        let [h, m] = timePart.split(':').map(Number);
        if (meridiem === 'PM' && h !== 12) h += 12;
        if (meridiem === 'AM' && h === 12) h = 0;
        return h * 60 + m;
      };
      const mins = parse(endTime) - parse(startTime);
      return mins > 0 ? mins : undefined;
    } catch {
      return undefined;
    }
  }, [startTime, endTime]);

  /** True when day-sitting end time is at or before start time */
  const daySittingTimeInvalid = useMemo(() => {
    if (careType !== 'daySitting') return false;
    try {
      const parse = (t: string) => {
        const [timePart, meridiem] = t.trim().split(' ');
        let [h, m] = timePart.split(':').map(Number);
        if (meridiem === 'PM' && h !== 12) h += 12;
        if (meridiem === 'AM' && h === 12) h = 0;
        return h * 60 + m;
      };
      return parse(endTime) <= parse(startTime);
    } catch {
      return false;
    }
  }, [careType, startTime, endTime]);

  // ── Recommended points calculator ──
  const recommendedPoints = useMemo(() => {
    let total = 0;
    const breakdown: { label: string; pts: number }[] = [];
    const numDogs = selectedDogs.length || 1;
    const dogMultiplier = 1 + (numDogs - 1) * 0.1; // +10% per extra dog

    const hasOvernight = primaryCareType === 'overnight';
    const hasDaySitting = primaryCareType === 'daySitting';
    const hasWalk = addOnCareTypes.has('dogWalking');
    const hasPlay = addOnCareTypes.has('playtime');
    const hasFeeding = addOnCareTypes.has('feeding');
    const hasMeds = addOnCareTypes.has('medication');
    const hasPrimary = hasOvernight || hasDaySitting;
    const hasWalkOrPlay = hasWalk || hasPlay;

    // Repeat multiplier: how many times an activity occurs over the stay
    const getRepeatCount = (repeat: RepeatSchedule | null, stayDays: number): number => {
      if (!repeat || stayDays <= 1) return 1;
      if (repeat.type === 'daily') return stayDays;
      if (repeat.type === 'weekly') return Math.max(1, Math.ceil(stayDays / 7));
      if (repeat.type === 'custom' && repeat.customDays) {
        return Math.max(1, Math.round(stayDays * repeat.customDays.length / 7));
      }
      return 1;
    };
    const stayDays = hasOvernight ? dayCount : 1;

    // ── Primary care ──
    if (hasOvernight) {
      const pts = 6 * dayCount;
      total += pts;
      breakdown.push({ label: 'Overnight (' + dayCount + ' night' + (dayCount > 1 ? 's' : '') + ')', pts });
    }
    if (hasDaySitting && daySittingMinutes && daySittingMinutes > 0) {
      const hrs = daySittingMinutes / 60;
      const pts = Math.round(hrs * 10) / 10;
      total += pts;
      breakdown.push({ label: 'Day sitting (' + hrs.toFixed(1) + ' hr' + (hrs !== 1 ? 's' : '') + ')', pts });
    }

    // ── Walk: 0.5/hr with overnight/day sitting, 1/hr standalone ──
    if (hasWalk && walkSessions.length > 0) {
      const rate = hasPrimary ? 0.5 : 1;
      let walkPts = 0;
      let totalHrs = 0;
      for (const ws of walkSessions) {
        const sMins = ws.startDate.getHours() * 60 + ws.startDate.getMinutes();
        const eMins = ws.endDate.getHours() * 60 + ws.endDate.getMinutes();
        const sessionMins = eMins > sMins ? eMins - sMins : 0;
        const sessionHrs = sessionMins / 60;
        const reps = getRepeatCount(ws.repeatSchedule, stayDays);
        walkPts += sessionHrs * rate * reps;
        totalHrs += sessionHrs * reps;
      }
      walkPts = Math.round(walkPts * 10) / 10;
      if (walkPts > 0) {
        total += walkPts;
        const lbl = totalHrs === 1 ? '1 hr' : totalHrs.toFixed(1) + ' hrs';
        breakdown.push({ label: 'Walk (' + lbl + ' @ ' + rate + '/hr)', pts: walkPts });
      }
    }

    // ── Playtime: 0.5/hr with overnight/day sitting, 1/hr standalone ──
    if (hasPlay && playSessions.length > 0) {
      const rate = hasPrimary ? 0.5 : 1;
      let playPts = 0;
      let totalHrs = 0;
      for (const s of playSessions) {
        const sessionMins = s.flexible ? s.durationMins : getPlayDurationMins(s);
        const sessionHrs = sessionMins / 60;
        const reps = getRepeatCount(s.repeatSchedule, stayDays);
        playPts += sessionHrs * rate * reps;
        totalHrs += sessionHrs * reps;
      }
      playPts = Math.round(playPts * 10) / 10;
      if (playPts > 0) {
        total += playPts;
        const lbl = totalHrs === 1 ? '1 hr' : totalHrs.toFixed(1) + ' hrs';
        breakdown.push({ label: 'Playtime (' + lbl + ' @ ' + rate + '/hr)', pts: playPts });
      }
    }

    // ── Feeding & Medication — rate depends on context ──
    if (hasPrimary) {
      // Included in overnight/day sitting — 0 extra pts (not shown)
    } else if (hasWalkOrPlay) {
      // Add-on to walk/play: +0.5 each
      if (hasFeeding) { total += 0.5; breakdown.push({ label: 'Feeding (add-on)', pts: 0.5 }); }
      if (hasMeds) { total += 0.5; breakdown.push({ label: 'Medication (add-on)', pts: 0.5 }); }
    } else {
      // Standalone feeding/meds only
      if (hasFeeding && hasMeds) {
        total += 1.5;
        breakdown.push({ label: 'Feeding', pts: 1 });
        breakdown.push({ label: 'Medication', pts: 0.5 });
      } else if (hasFeeding) {
        total += 1;
        breakdown.push({ label: 'Feeding', pts: 1 });
      } else if (hasMeds) {
        total += 1;
        breakdown.push({ label: 'Medication', pts: 1 });
      }
    }

    const adjusted = Math.ceil(total * dogMultiplier);
    return { total: adjusted, baseTotal: Math.ceil(total), breakdown, dogMultiplier, numDogs };
  }, [primaryCareType, dayCount, daySittingMinutes, addOnCareTypes, walkSessions, feedingSlots, medicationSlots, playSessions, selectedDogs.length]);

  /** Format total duration as human-readable string */
  const formatDuration = (totalMinutes: number): string => {
    const hours = Math.floor(totalMinutes / 60);
    const mins = totalMinutes % 60;
    if (hours === 0) {
      return `${mins} ${mins === 1 ? 'minute' : 'minutes'}`;
    }
    if (mins === 0) {
      return `${hours} ${hours === 1 ? 'hour' : 'hours'}`;
    }
    return `${hours} ${hours === 1 ? 'hour' : 'hours'} and ${mins} ${mins === 1 ? 'minute' : 'minutes'}`;
  };


  /** Build markedDates object for the range calendar */
  const buildMarkedDates = () => {
    const marks: Record<string, { startingDay?: boolean; endingDay?: boolean; color: string; textColor: string }> = {};
    const PRIMARY = '#FF2D55';
    const RANGE = 'rgba(255, 45, 85, 0.15)';
    const sStr = startDate.toISOString().split('T')[0];

    // Only show start date highlighted until user picks end date
    if (!endDateSelected) {
      marks[sStr] = { startingDay: true, endingDay: true, color: PRIMARY, textColor: '#fff' };
      return marks;
    }

    const eStr = endDate.toISOString().split('T')[0];

    if (sStr === eStr) {
      marks[sStr] = { startingDay: true, endingDay: true, color: PRIMARY, textColor: '#fff' };
      return marks;
    }

    const cur = new Date(startDate);
    cur.setHours(0, 0, 0, 0);
    const end = new Date(endDate);
    end.setHours(0, 0, 0, 0);

    while (cur <= end) {
      const key = cur.toISOString().split('T')[0];
      if (key === sStr) {
        marks[key] = { startingDay: true, color: PRIMARY, textColor: '#fff' };
      } else if (key === eStr) {
        marks[key] = { endingDay: true, color: PRIMARY, textColor: '#fff' };
      } else {
        marks[key] = { color: RANGE, textColor: '#fff' };
      }
      cur.setDate(cur.getDate() + 1);
    }
    return marks;
  };

  /** Total payment — flat amount for the whole job */
  const totalPayment = useMemo(() => {
    if (!offerMoney) return undefined;
    const amt = parseFloat(paymentAmount);
    if (!amt || amt <= 0) return undefined;
    return parseFloat(amt.toFixed(2));
  }, [offerMoney, paymentAmount]);

  /** Breakdown label — flat amount for the whole job */
  const paymentBreakdownLabel = useMemo(() => {
    if (!offerMoney) return null;
    const amt = parseFloat(paymentAmount);
    if (!amt || amt <= 0) return null;
    return `💰 $${amt.toFixed(2)} for the whole job`;
  }, [offerMoney, paymentAmount]);

  const formatDate = (d: Date) =>
    d.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' });
  const shortDate = (d: Date) =>
    d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });

  const dogTitleHint = useMemo(() => {
    if (selectedDogs.length === 0) return '';
    if (selectedDogs.length === 1) return `Dog-sitting needed for ${selectedDogs[0].name}`;
    const names = [...selectedDogs.map((d) => d.name)];
    const last = names.pop();
    return `Dog-sitting needed for ${names.join(', ')} & ${last}`;
  }, [selectedDogs]);

  const validateAndSubmit = async () => {
    if (selectedDogs.length === 0) {
      showValidationAlert('Required', 'Please select at least one dog', 'dogs'); return;
    }
    if (!primaryCareType && addOnCareTypes.size === 0) {
      showValidationAlert('Required', 'Please select at least one type of care.', 'careType'); return;
    }
    if ((primaryCareType === 'overnight' || primaryCareType === 'daySitting') && !overnightLocation) {
      showValidationAlert('Required', 'Please select where the stay will be.', 'careType'); return;
    }
    // Build the full requested care datetime
    const now = new Date();
    const parseTime12 = (t: string): { h: number; m: number } => {
      try {
        const [timePart, meridiem] = t.trim().split(' ');
        let [h, m] = timePart.split(':').map(Number);
        if (meridiem === 'PM' && h !== 12) h += 12;
        if (meridiem === 'AM' && h === 12) h = 0;
        return { h, m };
      } catch { return { h: 9, m: 0 }; }
    };

    // For overnight / daySitting: care starts on startDate at startTimeDate
    // For add-on only (feeding/walk/playtime): no time fields, assume noon
    const careStart = new Date(startDate);
    if (careType === 'overnight' || careType === 'daySitting') {
      careStart.setHours(startTimeDate.getHours(), startTimeDate.getMinutes(), 0, 0);
    } else {
      careStart.setHours(12, 0, 0, 0); // add-on only — no time selected
    }

    // Block if date/time has already passed
    if (careStart < now) {
      showValidationAlert('Date has passed', "The date and time you selected has already passed. Please choose a future date.", 'dates');
      return;
    }

    if (careType === 'overnight' && endDate <= startDate) {
      showValidationAlert('Invalid dates', 'End date must be after start date.', 'dates'); return;
    }

    // 24-hour warning (non-blocking — uses a Promise to wait for user choice)
    const hoursUntilCare = (careStart.getTime() - now.getTime()) / (1000 * 60 * 60);
    if (hoursUntilCare < 24) {
      const proceed = await new Promise<boolean>((resolve) => {
        Alert.alert(
          'Heads up! ⏰',
          "Posts are more likely to get a response when posted more than 24 hours in advance — but let's see what happens!",
          [
            { text: 'Go Back', style: 'cancel', onPress: () => resolve(false) },
            { text: 'Post Anyway', onPress: () => resolve(true) },
          ]
        );
      });
      if (!proceed) return;
    }
    if (!startDateSelected) {
      showValidationAlert('Date Required', 'Please select a date for your care request.', 'dates');
      return;
    }
    if (careType === 'overnight' && !endDateSelected) {
      showValidationAlert('End Date Required', 'Please select both a start and end date for overnight sitting.', 'dates');
      return;
    }
    if (careDetails.trim().length < MIN_CARE_DETAILS) {
      setCareDetailsCollapsed(false);
      showValidationAlert('Care Details Required', `Please provide at least ${MIN_CARE_DETAILS} characters`, 'careDetails');
      return;
    }
    if (addOnCareTypes.has('medication')) {
      const emptyMed = medicationSlots.find(s => s.details.trim().length < 10);
      if (emptyMed) {
        showValidationAlert('Medication Details Required', 'Please provide at least 10 characters describing the medication (name, dosage, instructions, etc.)', 'careDetails');
        return;
      }
    }
    if (!offerPoints && !offerMoney) {
      showValidationAlert('Required', 'Select at least one compensation type (points or money).', 'compensation');
      return;
    }
    if (offerMoney) {
      const amt = parseFloat(paymentAmount);
      if (!amt || amt <= 0) {
        showValidationAlert('Invalid Payment', 'Please enter a valid dollar amount', 'compensation'); return;
      }
      if (careType === 'daySitting' && (!daySittingMinutes || daySittingMinutes <= 0)) {
        showValidationAlert('Invalid Times', 'End time must be after start time', 'dates'); return;
      }
    } else {
      const pts = parseInt(pointsOffered, 10);
      if (isNaN(pts) || pts < 1) {
        showValidationAlert('Points Required', 'Please enter how many points this job is worth', 'compensation'); return;
      }
      const balance = userProfile?.points ?? 0;
      if (pts > balance) {
        showValidationAlert("Can't Post", "You're offering more points than you currently have. Please lower your offer or earn more points first.", 'compensation');
        return;
      }
    }
    if (!user) return;

    setSubmitting(true);
    try {
      let posterLocation: { latitude: number; longitude: number } | undefined;
      try {
        const { status } = await Location.requestForegroundPermissionsAsync();
        if (status === 'granted') {
          const loc = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
          posterLocation = { latitude: loc.coords.latitude, longitude: loc.coords.longitude };
        }
      } catch { /* optional */ }

      const primaryDog = selectedDogs[0];
      const dogIds = selectedDogs.map((d) => d.id);
      const dogNames = selectedDogs.map((d) => d.name);
      const dogBreeds = selectedDogs.map((d) => d.breed);
      const dogPhotoURLs = selectedDogs
        .map((d) => d.photoURLs?.[0])
        .filter((url): url is string => Boolean(url));

      // Build payment fields conditionally — flat amount for the whole job
      const paymentFields = offerMoney
        ? {
            paymentAmount: parseFloat(paymentAmount),
            totalPayment: totalPayment ?? undefined }
        : {};

      // Care-type-specific optional fields
      const careTypeFields: Record<string, unknown> = { careType: primaryCareType, addOnCareTypes: Array.from(addOnCareTypes), overnightLocation: (primaryCareType === 'overnight' || primaryCareType === 'daySitting') ? overnightLocation : null, careAddress: careAddress.trim() || undefined, sitterTransport: overnightLocation === 'sitters_home' ? sitterTransport : undefined };
      if (offerPoints) {
        careTypeFields.pointsOffered = parseInt(pointsOffered, 10);
      }
      if (addOnCareTypes.has('dogWalking')) {
        careTypeFields.walkSessions = walkSessions.map(ws => ({
          startTime: formatTime12(ws.startDate),
          endTime: formatTime12(ws.endDate),
          durationMins: (() => {
            let s = ws.startDate.getHours() * 60 + ws.startDate.getMinutes();
            let e = ws.endDate.getHours() * 60 + ws.endDate.getMinutes();
            return e > s ? e - s : 0;
          })(),
          dogIds: ws.dogIds,
          repeatSchedule: primaryCareType === 'overnight' && ws.repeatSchedule ? ws.repeatSchedule : null,
          instructions: ws.instructions.trim() || undefined,
          photos: ws.photos.length > 0 ? ws.photos : undefined,
        }));
        careTypeFields.walkDurationMins = walkDurationMins;
      }
      if (addOnCareTypes.has('feeding')) {
        careTypeFields.feedingSlots = feedingSlots.map(s => ({
          time: formatTime12(s.time),
          repeatSchedule: primaryCareType === 'overnight' && s.repeatSchedule ? s.repeatSchedule : null,
          dogIds: s.dogIds,
          instructions: s.instructions.trim() || undefined,
          photos: s.photos.length > 0 ? s.photos : undefined,
        }));
      }
      if (primaryCareType === 'overnight' || primaryCareType === 'daySitting') {
        careTypeFields.startTime = startTime;
        careTypeFields.endTime = endTime;
      }
      if (addOnCareTypes.has('medication')) {
        careTypeFields.medicationSlots = medicationSlots.map(s => ({
          time: formatTime12(s.time),
          extraTimes: s.extraTimes.map(et => formatTime12(et.time)),
          details: s.details.trim(),
          repeatSchedule: primaryCareType === 'overnight' && s.repeatSchedule ? s.repeatSchedule : null,
          dogIds: s.dogIds,
          photos: s.photos.length > 0 ? s.photos : undefined,
        }));
      }

      if (addOnCareTypes.has('playtime')) {
        careTypeFields.playSessions = playSessions.map((s, i) => ({
          sessionNumber: i + 1,
          flexible: s.flexible,
          startTime: s.flexible ? null : formatTime12(s.startDate),
          endTime: s.flexible ? null : formatTime12(s.endDate),
          durationMins: s.flexible ? s.durationMins : getPlayDurationMins(s),
          repeatSchedule: primaryCareType === 'overnight' && s.repeatSchedule ? s.repeatSchedule : null,
          dogIds: s.dogIds,
          instructions: s.instructions.trim() || undefined,
          photos: s.photos.length > 0 ? s.photos : undefined,
        }));
      }

      // Determine effective start/end date for non-range types
      const effectiveStart = startDate;
      const effectiveEnd = primaryCareType === 'overnight' ? endDate : startDate;

      // Upload care photos to Firebase Storage
      let uploadedCarePhotos: string[] = [];
      if (carePhotos.length > 0) {
        setUploadingPhoto(true);
        try {
          uploadedCarePhotos = await Promise.all(
            carePhotos.map(async (uri, idx) => {
              const path = `care-photos/${user.uid}/${Date.now()}_${idx}.jpg`;
              return uploadPhotoToStorage(uri, path);
            })
          );
        } finally {
          setUploadingPhoto(false);
        }
      }

      // Strip undefined values before Firestore write
      const postData = {
        posterId: user.uid,
        posterName: userProfile?.displayName ?? user.displayName ?? 'WatchDog User',
        posterPhotoURL: userProfile?.photoURL ?? user.photoURL ?? undefined,
        posterLocation,
        dogId: primaryDog.id,
        dogName: primaryDog.name,
        dogBreed: primaryDog.breed,
        dogPhotoURL: primaryDog.photoURLs?.[0],
        dogIds,
        dogNames,
        dogBreeds,
        dogPhotoURLs: dogPhotoURLs.length > 0 ? dogPhotoURLs : undefined,
        startDate: effectiveStart,
        endDate: effectiveEnd,
        careDetails: careDetails.trim(),
        carePhotos: uploadedCarePhotos.length > 0 ? uploadedCarePhotos : undefined,
        compensationType: (offerPoints && offerMoney ? 'either' : offerMoney ? 'payment' : 'points') as CompensationType,
        pointsCost: offerPoints ? parseInt(pointsOffered, 10) : 0,
        ...paymentFields,
        ...careTypeFields,
        status: 'open' as const };

      const cleanData = Object.fromEntries(
        Object.entries(postData).filter(([, v]) => v !== undefined)
      );

      await createPost(cleanData as unknown as Parameters<typeof createPost>[0]);

      setCelebrationQueue([{
        title: 'Successfully posted!',
        subtitle: 'Your request is now visible to people in your area.',
        emoji: '🐾',
      }]);
      void onPostCreated();
    } catch (error: unknown) {
      Alert.alert('Error', error instanceof Error ? error.message : 'Failed to post request');
    } finally {
      setSubmitting(false);
    }
  };

  if (loading) return <LoadingSpinner />;

  return (
    <View style={{ flex: 1, backgroundColor: colors.background }}>
      <ScrollView
        ref={kbScrollRef}
        onScroll={(e) => { kbOnScroll(e); scrollY.current = e.nativeEvent.contentOffset.y; }}
        scrollEventThrottle={16}
        automaticallyAdjustKeyboardInsets={true}
        style={[styles.container, { backgroundColor: colors.background }]}
        contentContainerStyle={styles.content}
        keyboardShouldPersistTaps="handled"
      >
        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'center', marginBottom: spacing.xl * 2, paddingHorizontal: spacing.lg }}>
          <Text style={{ fontSize: 16 }}>🐾</Text>
          <Text style={[styles.pageSubtitle, { color: colors.textSecondary, marginBottom: 0, marginHorizontal: 12, textAlign: 'center', lineHeight: 20 }]}>
            Your post will be visible to the WatchDog members in your area!
          </Text>
          <Text style={{ fontSize: 16 }}>🐾</Text>
        </View>

        {/* ── Section 1: Select Your Dog(s) ── */}
        <Animated.View ref={validationRefFor('dogs')} style={[styles.section, { backgroundColor: colors.surface, transform: [{ scale: pulsingSection === 'dogs' ? pulseAnim : 1 }] }, pulsingSection === 'dogs' && { shadowColor: '#FF2D55', shadowOpacity: glowAnim, shadowRadius: 12, shadowOffset: { width: 0, height: 0 }, elevation: 8 }]}>
          <Text style={[styles.sectionTitle, { color: colors.text }]}>
            🐶 {myDogs.length > 1 ? 'Select Your Dog(s)' : 'Your Dog'}
          </Text>
          {myDogs.length === 0 ? (
            <Text style={[styles.noDogText, { color: colors.textSecondary }]}>
              No dog added yet. Add one in Profile first.
            </Text>
          ) : (
            <>
              <Text style={[styles.dogSelectHint, { color: colors.textSecondary }]}>
                {myDogs.length > 1 ? 'Tap to select one or more dogs.' : 'Your dog for this post:'}
              </Text>
              <View style={styles.dogGrid}>
                {myDogs.map((dog) => {
                  const isSelected = selectedDogIds.has(dog.id);
                  const photoURL = dog.photoURLs?.[0];
                  return (
                    <TouchableOpacity
                      key={dog.id}
                      style={[
                        styles.dogCard,
                        {
                          backgroundColor: colors.background,
                          borderColor: isSelected ? RED : colors.border,
                          borderWidth: isSelected ? 2.5 : 1 },
                      ]}
                      onPress={() => toggleDog(dog.id)}
                      accessibilityLabel={`${dog.name}${isSelected ? ', selected' : ''}`}
                      accessibilityRole="checkbox"
                      accessibilityState={{ checked: isSelected }}
                    >
                      {photoURL ? (
                        <Image source={{ uri: photoURL }} style={styles.dogCardPhoto} />
                      ) : (
                        <View style={[styles.dogCardPhotoPlaceholder, { backgroundColor: colors.primary + '22' }]}>
                          <Text style={styles.dogCardPhotoEmoji}>🐕</Text>
                        </View>
                      )}
                      <View style={styles.dogCardInfo}>
                        <Text style={[styles.dogCardName, { color: colors.text }]} numberOfLines={1}>{dog.name}</Text>
                        <Text style={[styles.dogCardBreed, { color: colors.textSecondary }]} numberOfLines={1}>{dog.breed}</Text>
                        <Text style={[styles.dogCardAge, { color: colors.textSecondary }]}>{formatDogAge(dog.ageYears, dog.ageMonths)}</Text>
                      </View>
                      {isSelected && (
                        <View style={styles.dogCardCheckmark}>
                          <Text style={styles.dogCardCheckmarkText}>✓</Text>
                        </View>
                      )}
                    </TouchableOpacity>
                  );
                })}
              </View>

              {selectedDogs.length > 0 && (
                <View style={[styles.selectedSummary, { backgroundColor: colors.primary + '12', borderColor: colors.primary }]}>
                  <Text style={[styles.selectedSummaryText, { color: colors.primary }]}>
                    {selectedDogs.length === 1
                      ? `✓ ${selectedDogs[0].name} selected`
                      : `✓ ${selectedDogs.map((d) => d.name).join(', ')} selected`}
                  </Text>
                  {selectedDogs.length > 1 && (
                    <Text style={styles.multiDogHint}>
                      You can specify which care details apply to each dog below
                    </Text>
                  )}
                </View>
              )}


            </>
          )}
        </Animated.View>

        {/* ── Section 2: Type of Care ── */}
        <Animated.View ref={validationRefFor('careType')} style={[styles.section, { backgroundColor: colors.surface, transform: [{ scale: pulsingSection === 'careType' ? pulseAnim : 1 }] }, pulsingSection === 'careType' && { shadowColor: '#FF2D55', shadowOpacity: glowAnim, shadowRadius: 12, shadowOffset: { width: 0, height: 0 }, elevation: 8 }]}>
          <Text style={[styles.sectionTitle, { color: colors.text }]}>🐾 Type of Care</Text>

          {/* Primary — must pick one */}
          <Text style={[styles.careTypeHint, { color: colors.textSecondary, marginBottom: 8 }]}>
            Need a sitter?
          </Text>
          <View style={styles.careTypeGrid}>
            {PRIMARY_CARE_OPTIONS.map(({ type, icon, label }) => {
              const isSelected = primaryCareType === type;
              return (
                <TouchableOpacity
                  key={type}
                  style={[
                    styles.careTypeCard,
                    {
                      backgroundColor: colors.background,
                      borderColor: isSelected ? RED : colors.border,
                      borderWidth: isSelected ? 2.5 : 1 },
                  ]}
                  onPress={() => {
                    setPrimaryCareType(prev => prev === type ? null : type);
                    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                  }}
                  accessibilityLabel={label}
                  accessibilityRole="radio"
                  accessibilityState={{ checked: isSelected }}
                >
                  <Text style={styles.careTypeIcon}>{icon}</Text>
                  <Text style={[styles.careTypeLabel, { color: colors.text }]}>{label}</Text>
                  {isSelected && (
                    <View style={styles.careTypeCheckmark}>
                      <Text style={styles.careTypeCheckmarkText}>✓</Text>
                    </View>
                  )}
                </TouchableOpacity>
              );
            })}
          </View>

          {/* ── Location preference (radio buttons, under overnight or day sitting card) ── */}
          {(primaryCareType === 'overnight' || primaryCareType === 'daySitting') && (
            <View style={{ marginTop: 12, gap: 8, alignSelf: primaryCareType === 'daySitting' ? 'flex-end' : 'flex-start', width: '47%' }}>
              {([
                { value: 'my_home' as const, label: 'My home' },
                { value: 'sitters_home' as const, label: "Sitter's home" },
                { value: 'no_preference' as const, label: 'No preference' },
              ]).map((option) => {
                const selected = overnightLocation === option.value;
                return (
                  <TouchableOpacity
                    key={option.value}
                    style={{ flexDirection: 'row', alignItems: 'center', paddingVertical: 6 }}
                    onPress={() => {
                      setOvernightLocation(option.value);
                      if (option.value !== 'sitters_home') setSitterTransport(null);
                      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                    }}
                    activeOpacity={0.7}
                  >
                    <View style={{
                      width: 24, height: 24, borderRadius: 12,
                      borderWidth: 2,
                      borderColor: selected ? colors.primary : colors.textSecondary + '80',
                      backgroundColor: selected ? colors.primary : 'transparent',
                      alignItems: 'center', justifyContent: 'center',
                      marginRight: 10,
                    }}>
                      {selected && (
                        <Text style={{ color: '#fff', fontSize: 14, fontWeight: '700', marginTop: -1 }}>✓</Text>
                      )}
                    </View>
                    <Text style={{ fontSize: 17, color: colors.text, fontWeight: selected ? '600' : '400' }}>
                      {option.label}
                    </Text>
                  </TouchableOpacity>
                );
              })}
            </View>
          )}

          {/* ── My Home: Enter Address ── */}
          {(primaryCareType === 'overnight' || primaryCareType === 'daySitting') && overnightLocation === 'my_home' && (
            <View style={{ marginTop: 12 }}>
              <TouchableOpacity
                onPress={() => setShowAddressModal(true)}
                style={{ backgroundColor: colors.background, borderWidth: 1, borderColor: colors.border, borderRadius: 12, padding: 14, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}
                activeOpacity={0.7}
              >
                <View style={{ flex: 1 }}>
                  <Text style={{ fontSize: 15, color: careAddress ? colors.text : colors.textSecondary, fontWeight: careAddress ? '500' : '400' }}>
                    {careAddress || '📍 Enter your home address'}
                  </Text>
                </View>
                <Text style={{ fontSize: 14, color: colors.primary, fontWeight: '600' }}>{careAddress ? 'Edit' : 'Add'}</Text>
              </TouchableOpacity>
              <View style={{ backgroundColor: colors.background, borderRadius: 10, padding: 14, marginTop: 8 }}>
                <Text style={{ fontSize: 14, color: colors.textSecondary, textAlign: 'center', lineHeight: 20 }}>
                  🔒 Your address is kept private and only shared with an accepted caretaker.
                </Text>
              </View>
            </View>
          )}

          {/* ── Sitter's Home: Pickup or Dropoff ── */}
          {(primaryCareType === 'overnight' || primaryCareType === 'daySitting') && overnightLocation === 'sitters_home' && (
            <View style={{ marginTop: 12, gap: 8 }}>
              <Text style={{ fontSize: 14, color: colors.textSecondary, fontWeight: '500' }}>How will your pup get there?</Text>
              <View style={{ flexDirection: 'row', gap: 10 }}>
                {([
                  { value: 'pickup' as const, label: '🚗 Caretaker picks up' },
                  { value: 'dropoff' as const, label: '📦 I\'ll drop off' },
                ] as const).map((opt) => {
                  const sel = sitterTransport === opt.value;
                  return (
                    <TouchableOpacity
                      key={opt.value}
                      onPress={() => { setSitterTransport(opt.value); Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); }}
                      style={{ flex: 1, paddingVertical: 12, borderRadius: 10, borderWidth: sel ? 2 : 1, borderColor: sel ? colors.primary : colors.border, backgroundColor: sel ? colors.primary + '18' : colors.background, alignItems: 'center' }}
                      activeOpacity={0.7}
                    >
                      <Text style={{ fontSize: 14, color: sel ? colors.primary : colors.text, fontWeight: sel ? '700' : '500' }}>{opt.label}</Text>
                    </TouchableOpacity>
                  );
                })}
              </View>

              {/* Pickup selected — need user address */}
              {sitterTransport === 'pickup' && (
                <View style={{ marginTop: 4 }}>
                  <TouchableOpacity
                    onPress={() => setShowAddressModal(true)}
                    style={{ backgroundColor: colors.background, borderWidth: 1, borderColor: colors.border, borderRadius: 12, padding: 14, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}
                    activeOpacity={0.7}
                  >
                    <View style={{ flex: 1 }}>
                      <Text style={{ fontSize: 15, color: careAddress ? colors.text : colors.textSecondary, fontWeight: careAddress ? '500' : '400' }}>
                        {careAddress || '📍 Enter your pickup address'}
                      </Text>
                    </View>
                    <Text style={{ fontSize: 14, color: colors.primary, fontWeight: '600' }}>{careAddress ? 'Edit' : 'Add'}</Text>
                  </TouchableOpacity>
                  <View style={{ backgroundColor: colors.background, borderRadius: 10, padding: 14, marginTop: 8 }}>
                    <Text style={{ fontSize: 14, color: colors.textSecondary, textAlign: 'center', lineHeight: 20 }}>
                      🔒 Your address is kept private and only shared with an accepted caretaker.
                    </Text>
                  </View>
                </View>
              )}

              {/* Dropoff selected — info note */}
              {sitterTransport === 'dropoff' && (
                <View style={{ backgroundColor: colors.background, borderRadius: 10, padding: 14, marginTop: 8 }}>
                  <Text style={{ fontSize: 14, color: colors.textSecondary, textAlign: 'center', lineHeight: 20 }}>
                    Once a caretaker is confirmed, you can message them directly to coordinate their address and handoff details. 💬
                  </Text>
                </View>
              )}
            </View>
          )}

          {/* ── No Preference: coordination note ── */}
          {(primaryCareType === 'overnight' || primaryCareType === 'daySitting') && overnightLocation === 'no_preference' && (
            <View style={{ backgroundColor: colors.background, borderRadius: 10, padding: 14, marginTop: 12 }}>
              <Text style={{ fontSize: 14, color: colors.textSecondary, textAlign: 'center', lineHeight: 20 }}>
                Once a caretaker is confirmed, you can message them directly to coordinate. 💬
              </Text>
            </View>
          )}

          {/* Add-ons — tap to toggle */}
          <Text style={[styles.careTypeHint, { color: colors.textSecondary, marginTop: 16, marginBottom: 8 }]}>
            Any specifics?
          </Text>
          <View style={styles.careTypeGrid}>
            {ADDON_CARE_OPTIONS.map(({ type, icon, label }) => {
              const isSelected = addOnCareTypes.has(type);
              return (
                <TouchableOpacity
                  key={type}
                  style={[
                    styles.careTypeCard,
                    {
                      backgroundColor: colors.background,
                      borderColor: isSelected ? RED : colors.border,
                      borderWidth: isSelected ? 2.5 : 1 },
                  ]}
                  onPress={() => {
                    toggleAddOn(type);
                    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                  }}
                  accessibilityLabel={label}
                  accessibilityRole="checkbox"
                  accessibilityState={{ checked: isSelected }}
                >
                  <Text style={styles.careTypeIcon}>{icon}</Text>
                  <Text style={[styles.careTypeLabel, { color: colors.text }]}>{label}</Text>
                  {isSelected && (
                    <View style={styles.careTypeCheckmark}>
                      <Text style={styles.careTypeCheckmarkText}>✓</Text>
                    </View>
                  )}
                </TouchableOpacity>
              );
            })}
          </View>
        </Animated.View>

        {/* ── Dynamic Sections ── */}

        {/* ── Date/Time section (always shows when any care type selected) ── */}
        {(primaryCareType !== null || addOnCareTypes.size > 0) && (
              <Animated.View ref={validationRefFor('dates')} style={[styles.section, { backgroundColor: colors.surface, transform: [{ scale: pulsingSection === 'dates' ? pulseAnim : 1 }] }, pulsingSection === 'dates' && { shadowColor: '#FF2D55', shadowOpacity: glowAnim, shadowRadius: 12, shadowOffset: { width: 0, height: 0 }, elevation: 8 }]}>
                <Text style={[styles.sectionTitle, { color: colors.text }]}>
                  📅 {careType === 'overnight' ? 'Dates & Times' : careType === 'daySitting' ? 'Date & Time' : 'Date'}
                </Text>
                {/* Single date for daySitting / add-on only */}
                {careType !== 'overnight' && (
                  <>
                    <TouchableOpacity
                      style={[styles.dateButton, { borderColor: showStart ? colors.primary : colors.border }]}
                      onPress={() => setShowStart((prev) => !prev)}
                      accessibilityLabel={`Date: ${formatDate(startDate)}`}
                      accessibilityRole="button"
                    >
                      <Text style={[styles.dateButtonLabel, { color: colors.textSecondary }]}>DATE</Text>
                      <Text style={[styles.dateButtonValue, { color: startDateSelected ? colors.text : colors.textSecondary }]}>{startDateSelected ? formatDate(startDate) : 'No date selected!'}</Text>
                    </TouchableOpacity>
                    {showStart && (
                      <DateTimePicker
                        value={startDate}
                        mode="date"
                        display={Platform.OS === 'ios' ? 'inline' : 'default'}
                        minimumDate={new Date()}
                        themeVariant="dark"
                        accentColor="#FF2D55"
                        onChange={(_: DateTimePickerEvent, d?: Date) => {
                          setShowStart(Platform.OS === 'ios');
                          if (d) { setStartDate(d); setStartDateSelected(true); }
                          if (Platform.OS !== 'ios') setShowStart(false);
                        }}
                      />
                    )}
                  </>
                )}

                {/* Unified range calendar for overnight */}
                {careType === 'overnight' && (
                  <>
                    <TouchableOpacity
                      style={[styles.dateButton, { borderColor: showRangeCalendar ? colors.primary : colors.border }]}
                      onPress={() => setShowRangeCalendar((prev) => !prev)}
                      accessibilityLabel={`Dates: ${formatDate(startDate)} to ${formatDate(endDate)}`}
                      accessibilityRole="button"
                    >
                      <Text style={[styles.dateButtonLabel, { color: colors.textSecondary }]}>DATES</Text>
                      <Text style={[styles.dateButtonValue, { color: startDateSelected ? colors.text : colors.textSecondary }]}>
                        {!startDateSelected
                          ? 'No dates selected!'
                          : endDateSelected
                            ? `${formatDate(startDate)} →\n${formatDate(endDate)}`
                            : formatDate(startDate)}
                      </Text>
                    </TouchableOpacity>

                    {showRangeCalendar && (
                      <>
                        <Text style={[styles.rangeHint, { color: '#FF2D55' }]}>
                          {endDateSelected
                            ? 'Start and end date selected!'
                            : rangeSelectStep === 'start'
                              ? 'Select your start date'
                              : 'Start date selected!'}
                        </Text>
                        {rangeSelectStep === 'end' && !endDateSelected && (
                          <Text style={[styles.rangeHintSub, { color: '#FF2D55' }]}>
                            Now select your end date
                          </Text>
                        )}
                        <Calendar
                          markingType="period"
                          markedDates={buildMarkedDates()}
                          minDate={new Date().toISOString().split('T')[0]}
                          enableSwipeMonths={true}
                          renderArrow={(direction: string) => (
                            <Ionicons
                              name={direction === 'left' ? 'chevron-back' : 'chevron-forward'}
                              size={22}
                              color="#FF2D55"
                            />
                          )}
                          onDayPress={(day: DateData) => {
                            const selected = new Date(day.dateString + 'T12:00:00');
                            if (rangeSelectStep === 'start') {
                              setStartDate(selected);
                              setStartDateSelected(true);
                              setEndDateSelected(false);
                              setRangeSelectStep('end');
                            } else {
                              if (selected > startDate) {
                                setEndDate(selected);
                                setEndDateSelected(true);
                                setRangeSelectStep('start');
                              } else {
                                // Tapped before or on start — restart selection from here
                                setStartDate(selected);
                                setStartDateSelected(true);
                                setEndDateSelected(false);
                                // Stay on 'end' step
                              }
                            }
                          }}
                          theme={{
                            calendarBackground: 'transparent',
                            dayTextColor: '#FFFFFF',
                            monthTextColor: '#FFFFFF',
                            textMonthFontWeight: '700',
                            textMonthFontSize: 17,
                            textDayFontSize: 15,
                            textDayHeaderFontSize: 12,
                            textSectionTitleColor: 'rgba(255,255,255,0.5)',
                            arrowColor: '#FF2D55',
                            todayTextColor: '#FF2D55',
                            textDisabledColor: 'rgba(255,255,255,0.25)',

                          }}
                          style={{ borderRadius: 12, marginVertical: 8 }}
                        />
                      </>
                    )}

                    {endDateSelected && (
                      <View style={[styles.dateSummary, { backgroundColor: colors.background }]}>
                        <Text style={[styles.dateSummaryText, { color: colors.textSecondary }]}>
                          {dayCount} night{dayCount !== 1 ? 's' : ''}
                        </Text>
                      </View>
                    )}
                  </>
                )}

                {/* Time fields for overnight and day sitting — native spinner */}
                {(careType === 'overnight' || careType === 'daySitting') && (careType !== 'overnight' || endDateSelected) && (
                  <View ref={refFor('startTime')}>
                    <View style={styles.timeRow}>
                      <TouchableOpacity
                        style={[styles.timePickerButton, { borderColor: showStartTime ? colors.primary : colors.border }]}
                        onPress={() => { setShowStartTime(prev => !prev); setShowEndTime(false); }}
                        activeOpacity={0.7}
                      >
                        <Text style={[styles.timeFieldLabel, { color: colors.textSecondary }]}>
                          Start Time{careType === 'overnight' ? ` (on ${shortDate(startDate)})` : ''}
                        </Text>
                        <Text style={[styles.timePickerValue, { color: colors.text }]}>{startTime}</Text>
                      </TouchableOpacity>
                      <Text style={[styles.timeSeparator, { color: colors.textSecondary }]}>→</Text>
                      <TouchableOpacity
                        style={[styles.timePickerButton, { borderColor: showEndTime ? colors.primary : colors.border }]}
                        onPress={() => { setShowEndTime(prev => !prev); setShowStartTime(false); }}
                        activeOpacity={0.7}
                      >
                        <Text style={[styles.timeFieldLabel, { color: colors.textSecondary }]}>
                          End Time{careType === 'overnight' ? ` (on ${shortDate(endDate)})` : ''}
                        </Text>
                        <Text style={[styles.timePickerValue, { color: colors.text }]}>{endTime}</Text>
                      </TouchableOpacity>
                    </View>
                    {showStartTime && (
                      <DateTimePicker
                        value={startTimeDate}
                        mode="time"
                        display="spinner"
                        themeVariant="dark"
                        accentColor="#FF2D55"
                        onChange={(_: DateTimePickerEvent, d?: Date) => {
                          if (d) setStartTimeDate(d);
                        }}
                        style={{ height: 150 }}
                      />
                    )}
                    {showEndTime && (
                      <DateTimePicker
                        value={endTimeDate}
                        mode="time"
                        display="spinner"
                        themeVariant="dark"
                        accentColor="#FF2D55"
                        onChange={(_: DateTimePickerEvent, d?: Date) => {
                          if (d) setEndTimeDate(d);
                        }}
                        style={{ height: 150 }}
                      />
                    )}
                  </View>
                )}
                {careType === 'daySitting' && daySittingTimeInvalid && (
                  <View style={{ backgroundColor: '#FF3B3020', borderRadius: 8, padding: 10, marginTop: 8 }}>
                    <Text style={{ color: '#FF3B30', fontSize: 15, fontWeight: '600', textAlign: 'center' }}>
                      ⚠️ End time must be after start time
                    </Text>
                  </View>
                )}
                {careType === 'daySitting' && daySittingMinutes && daySittingMinutes > 0 && (
                  <View style={[styles.dateSummaryRow, { backgroundColor: colors.background }]}>
                    <Text style={[styles.dateSummaryText, { color: colors.textSecondary }]}>
                      {formatDuration(daySittingMinutes)}
                    </Text>
                    {(showStartTime || showEndTime) && (
                      <TouchableOpacity
                        style={[styles.timeConfirmBtn, { backgroundColor: colors.primary }]}
                        onPress={() => { setShowStartTime(false); setShowEndTime(false); }}
                        accessibilityLabel="Confirm time selection"
                        accessibilityRole="button"
                      >
                        <Text style={styles.timeConfirmBtnText}>✓</Text>
                      </TouchableOpacity>
                    )}
                  </View>
                )}

              </Animated.View>
            )}


                {/* ── Services collapsible header ── */}
                {(addOnCareTypes.has('feeding') || addOnCareTypes.has('dogWalking') || addOnCareTypes.has('playtime') || addOnCareTypes.has('medication')) && (
                  <TouchableOpacity
                    style={{ flexDirection: 'row', alignItems: 'center', marginTop: spacing.xl, marginBottom: spacing.xl, position: 'relative' }}
                    onPress={() => {
                      setServicesCollapsed(prev => !prev);
                      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                    }}
                    activeOpacity={0.7}
                  >
                    <View style={{ flex: 1, height: StyleSheet.hairlineWidth, backgroundColor: colors.border }} />
                    <View style={{ flexDirection: 'row', alignItems: 'center', paddingHorizontal: 14 }}>
                      <Text style={{ fontSize: 22, fontWeight: '700', color: colors.textSecondary, letterSpacing: 0.5 }}>Services</Text>
                      <Text style={{ fontSize: 18, color: colors.textSecondary, marginLeft: 8 }}>{servicesCollapsed ? '›' : '▾'}</Text>
                    </View>
                    <View style={{ flex: 1, height: StyleSheet.hairlineWidth, backgroundColor: colors.border }} />
                    {servicesCollapsed && (
                      <View style={{ position: 'absolute', right: 0, flexDirection: 'row', alignItems: 'center', paddingRight: 4 }}>
                        {(() => {
                          const icons: string[] = [];
                          if (addOnCareTypes.has('feeding')) feedingSlots.forEach(() => icons.push('🍽️'));
                          if (addOnCareTypes.has('dogWalking')) walkSessions.forEach(() => icons.push('🐕'));
                          if (addOnCareTypes.has('playtime')) playSessions.forEach(() => icons.push('🎾'));
                          if (addOnCareTypes.has('medication')) medicationSlots.forEach(() => icons.push('💊'));
                          const maxVisible = 6;
                          const hasOverflow = icons.length > maxVisible;
                          const visible = hasOverflow ? icons.slice(0, maxVisible) : icons;
                          return (
                            <>
                              {visible.map((emoji, i) => (
                                <View key={i} style={{ width: 30, height: 30, borderRadius: 15, backgroundColor: colors.surface, borderWidth: 1.5, borderColor: colors.background, alignItems: 'center', justifyContent: 'center', marginLeft: i === 0 ? 0 : -10, zIndex: visible.length - i }}>
                                  <Text style={{ fontSize: 14 }}>{emoji}</Text>
                                </View>
                              ))}
                              {hasOverflow && (
                                <View style={{ width: 30, height: 30, borderRadius: 15, backgroundColor: colors.surface, borderWidth: 1.5, borderColor: colors.background, alignItems: 'center', justifyContent: 'center', marginLeft: -10, zIndex: 0 }}>
                                  <Text style={{ fontSize: 13, fontWeight: '700', color: '#fff' }}>+{icons.length - maxVisible}</Text>
                                </View>
                              )}
                            </>
                          );
                        })()}
                      </View>
                    )}
                  </TouchableOpacity>
                )}

                {!servicesCollapsed && (
                <>
                {/* ── Feeding Time (add-on) ── */}
            {addOnCareTypes.has('feeding') && (
              <>
                {feedingSlots.map((slot, idx) => (
                  <View key={idx} style={[styles.section, { backgroundColor: colors.surface, marginBottom: idx === feedingSlots.length - 1 ? 0 : spacing.md }, idx === feedingSlots.length - 1 && { borderBottomLeftRadius: 0, borderBottomRightRadius: 0 }]}>
                    {/* Header: arrow + title + repeat daily + ✕ — all inline centered */}
                    <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: collapsedFeedings.has(idx) ? 0 : 10 }}>
                      <TouchableOpacity
                        onPress={() => toggleCollapse(setCollapsedFeedings, idx)}
                        style={{ flexDirection: 'row', alignItems: 'center', flex: 1 }}
                        activeOpacity={0.7}
                      >
                        <Text style={{ color: colors.text, fontSize: 18, fontWeight: '600', marginRight: 8, width: 16 }}>
                          {collapsedFeedings.has(idx) ? '›' : '▾'}
                        </Text>
                        <Text style={{ color: colors.text, fontSize: 22, fontWeight: '700' }}>
                          🍽️ {idx === 0 ? 'Feeding' : `Feeding #${idx + 1}`}
                        </Text>
                      </TouchableOpacity>
                      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
                        {primaryCareType === 'overnight' && (
                          <TouchableOpacity
                            style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}
                            onPress={() => openRepeatModal('feeding', idx)}
                            activeOpacity={0.7}
                          >
                            <View style={{ alignItems: 'center' }}>
                            <Text style={{ fontSize: 15, fontWeight: '600', color: slot.repeatSchedule ? '#34C759' : colors.textSecondary }}>
                              {slot.repeatSchedule ? '✓ ' + formatRepeatLabel(slot.repeatSchedule) : 'Repeat this?'}
                            </Text>
                              {slot.repeatSchedule && formatRepeatSubLabel(slot.repeatSchedule) && (
                                <Text style={{ fontSize: 13, color: colors.textSecondary, marginTop: 1, textAlign: 'center' }}>
                                  {formatRepeatSubLabel(slot.repeatSchedule)}
                                </Text>
                              )}
                            </View>
                          </TouchableOpacity>
                        )}
                        <TouchableOpacity
                          onPress={() => Alert.alert(
                            feedingSlots.length === 1 ? 'Remove Feeding' : `Remove Feeding #${idx + 1}`,
                            feedingSlots.length === 1
                              ? 'Are you sure you want to remove feeding from this post?'
                              : 'Are you sure you want to remove this feeding?',
                            [
                              { text: 'Cancel', style: 'cancel' },
                              { text: 'Remove', style: 'destructive', onPress: () => {
                                if (feedingSlots.length === 1) {
                                  setAddOnCareTypes(prev => { const n = new Set(prev); n.delete('feeding'); return n; });
                                } else {
                                  removeFeedingSlot(idx);
                                }
                              }},
                            ]
                          )}
                          hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                        >
                          <Text style={{ fontSize: 17, color: '#FF3B30', fontWeight: '700' }}>✕</Text>
                        </TouchableOpacity>
                      </View>
                    </View>
                    {!collapsedFeedings.has(idx) && (
                    <>
                    <DogAssignRow
                      activeDogIds={slot.dogIds}
                      onToggle={(dogId: string) => {
                        const current = slot.dogIds;
                        const updated = current.includes(dogId)
                          ? current.filter(id => id !== dogId)
                          : [...current, dogId];
                        updateFeedingSlot(idx, 'dogIds', updated);
                      }}
                    />
                    <TouchableOpacity
                      style={[styles.timePickerButton, { borderColor: slot.showPicker ? colors.primary : colors.border, alignSelf: 'stretch' }]}
                      onPress={() => updateFeedingSlot(idx, 'showPicker', !slot.showPicker)}
                      activeOpacity={0.7}
                    >
                      <Text style={[styles.timeFieldLabel, { color: colors.textSecondary }]}>
                        {feedingSlots.length > 1 ? `Feeding ${idx + 1} Time` : 'Feeding Time'}
                      </Text>
                      <Text style={[styles.timePickerValue, { color: colors.text }]}>{formatTime12(slot.time)}</Text>
                    </TouchableOpacity>
                    {slot.showPicker && (
                      <DateTimePicker
                        value={slot.time}
                        mode="time"
                        display="spinner"
                        themeVariant="dark"
                        accentColor="#FF2D55"
                        onChange={(_: DateTimePickerEvent, d?: Date) => {
                          if (d) updateFeedingSlot(idx, 'time', d);
                        }}
                        style={{ height: 150 }}
                      />
                    )}


                    {/* ── Specific Instructions ── */}
                    <TouchableOpacity
                      onPress={() => updateFeedingSlot(idx, 'showInstructions', !slot.showInstructions)}
                      activeOpacity={0.7}
                      style={{ alignSelf: 'stretch', paddingVertical: 12 }}
                    >
                      <Text style={{ color: '#fff', textAlign: 'center', fontSize: 14, fontWeight: '500' }}>
                        {slot.showInstructions ? 'Hide feeding instructions ▲' : 'Have specific feeding instructions? ▼'}
                      </Text>
                    </TouchableOpacity>
                    {slot.showInstructions && (
                      <>
                        <TextInput
                          style={[styles.careInput, {
                            backgroundColor: colors.background,
                            borderColor: colors.border,
                            color: colors.text,
                            minHeight: 70,
                            marginTop: 4,
                          }]}
                          placeholder="Add specific instructions for this feeding..."
                          placeholderTextColor={colors.textSecondary}
                          value={slot.instructions}
                          onChangeText={(text) => updateFeedingSlot(idx, 'instructions', text)}
                          multiline
                          inputAccessoryViewID={DONE_ACCESSORY_ID}
                          numberOfLines={3}
                          textAlignVertical="top"
                          returnKeyType="done"
                          blurOnSubmit={true}
                        />
                        {/* Photos */}
                        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 8 }}>
                          {slot.photos.map((uri, pIdx) => (
                            <View key={pIdx} style={{ position: 'relative' }}>
                              <Image source={{ uri }} style={{ width: 70, height: 70, borderRadius: 10 }} />
                              <TouchableOpacity
                                onPress={() => removeServicePhoto('feeding', idx, pIdx)}
                                style={{ position: 'absolute', top: -6, right: -6, backgroundColor: '#FF3B30', borderRadius: 10, width: 20, height: 20, alignItems: 'center', justifyContent: 'center' }}
                              >
                                <Text style={{ color: '#fff', fontSize: 12, fontWeight: '700' }}>✕</Text>
                              </TouchableOpacity>
                            </View>
                          ))}
                          {slot.photos.length < MAX_SERVICE_PHOTOS && (
                            <TouchableOpacity
                              onPress={() => pickServicePhoto('feeding', idx)}
                              style={{ width: 70, height: 70, borderRadius: 10, borderWidth: 1, borderColor: colors.border, borderStyle: 'dashed', alignItems: 'center', justifyContent: 'center' }}
                            >
                              <Text style={{ fontSize: 24, color: colors.textSecondary }}>📷</Text>
                            </TouchableOpacity>
                          )}
                        </View>
                      </>
                    )}

                    </>
                    )}
                  </View>
                ))}

                {/* Add another feeding — outside cards */}
                <TouchableOpacity
                  style={[styles.addSessionBtn, { borderColor: colors.primary }]}
                  onPress={addFeedingSlot}
                  activeOpacity={0.7}
                >
                  <Text style={[styles.addFeedingBtnText, { color: colors.primary }]}>
                    ➕ Add another feeding
                  </Text>
                </TouchableOpacity>

              </>
            )}

        {/* Divider between feeding and walk */}
            {addOnCareTypes.has('dogWalking') && addOnCareTypes.has('feeding') && feedingSlots.length > 1 && (
              <View style={{ borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border, marginTop: spacing.lg, marginBottom: spacing.xl }} />
            )}

        {/* ── Walk Time (add-on) — multi-session ── */}
            {addOnCareTypes.has('dogWalking') && (
              <>
                {walkSessions.map((ws, wIdx) => {
                  const wsStartTime = formatTime12(ws.startDate);
                  const wsEndTime = formatTime12(ws.endDate);
                  const wsStartMins = ws.startDate.getHours() * 60 + ws.startDate.getMinutes();
                  const wsEndMins = ws.endDate.getHours() * 60 + ws.endDate.getMinutes();
                  const wsDurMins = wsEndMins > wsStartMins ? wsEndMins - wsStartMins : 0;
                  const wsDurText = wsDurMins >= 60
                    ? `${Math.floor(wsDurMins / 60)}h ${wsDurMins % 60 > 0 ? `${wsDurMins % 60}m` : ''} walk`.trim()
                    : `${wsDurMins}m walk`;
                  return (
                  <View key={wIdx} style={[styles.section, { backgroundColor: colors.surface, marginBottom: wIdx === walkSessions.length - 1 ? 0 : spacing.md }, wIdx === walkSessions.length - 1 && { borderBottomLeftRadius: 0, borderBottomRightRadius: 0 }]}>
                    {/* Header: arrow + title + repeat daily + ✕ — all inline centered */}
                    <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: collapsedWalks.has(wIdx) ? 0 : 10 }}>
                      <TouchableOpacity
                        onPress={() => toggleCollapse(setCollapsedWalks, wIdx)}
                        style={{ flexDirection: 'row', alignItems: 'center', flex: 1 }}
                        activeOpacity={0.7}
                      >
                        <Text style={{ color: colors.text, fontSize: 18, fontWeight: '600', marginRight: 8, width: 16 }}>
                          {collapsedWalks.has(wIdx) ? '›' : '▾'}
                        </Text>
                        <Text style={{ color: colors.text, fontSize: 22, fontWeight: '700' }}>
                          🐕 {wIdx === 0 ? 'Walk' : `Walk #${wIdx + 1}`}
                        </Text>
                      </TouchableOpacity>
                      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
                        {primaryCareType === 'overnight' && (
                          <TouchableOpacity
                            style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}
                            onPress={() => openRepeatModal('walk', wIdx)}
                            activeOpacity={0.7}
                          >
                            <View style={{ alignItems: 'center' }}>
                            <Text style={{ fontSize: 15, fontWeight: '600', color: ws.repeatSchedule ? '#34C759' : colors.textSecondary }}>
                              {ws.repeatSchedule ? '✓ ' + formatRepeatLabel(ws.repeatSchedule) : 'Repeat this?'}
                            </Text>
                              {ws.repeatSchedule && formatRepeatSubLabel(ws.repeatSchedule) && (
                                <Text style={{ fontSize: 13, color: colors.textSecondary, marginTop: 1, textAlign: 'center' }}>
                                  {formatRepeatSubLabel(ws.repeatSchedule)}
                                </Text>
                              )}
                            </View>
                          </TouchableOpacity>
                        )}
                        <TouchableOpacity
                          onPress={() => Alert.alert(
                            walkSessions.length === 1 ? 'Remove Walk' : `Remove Walk #${wIdx + 1}`,
                            walkSessions.length === 1
                              ? 'Are you sure you want to remove walking from this post?'
                              : 'Are you sure you want to remove this walk?',
                            [
                              { text: 'Cancel', style: 'cancel' },
                              { text: 'Remove', style: 'destructive', onPress: () => {
                                if (walkSessions.length === 1) {
                                  setAddOnCareTypes(prev => { const n = new Set(prev); n.delete('dogWalking'); return n; });
                                } else {
                                  removeWalkSession(wIdx);
                                }
                              }},
                            ]
                          )}
                          hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                        >
                          <Text style={{ fontSize: 17, color: '#FF3B30', fontWeight: '700' }}>✕</Text>
                        </TouchableOpacity>
                      </View>
                    </View>
                    {!collapsedWalks.has(wIdx) && (
                    <>
                    <DogAssignRow
                      activeDogIds={ws.dogIds}
                      onToggle={(dogId: string) => {
                        updateWalkSession(wIdx, {
                          dogIds: ws.dogIds.includes(dogId)
                            ? ws.dogIds.filter(id => id !== dogId)
                            : [...ws.dogIds, dogId],
                        });
                      }}
                    />

                    <View style={styles.timeRow}>
                      <TouchableOpacity
                        style={[styles.timePickerButton, { borderColor: ws.showStart ? colors.primary : colors.border }]}
                        onPress={() => updateWalkSession(wIdx, { showStart: !ws.showStart, showEnd: false })}
                        activeOpacity={0.7}
                      >
                        <Text style={[styles.timeFieldLabel, { color: colors.textSecondary }]}>Start Time</Text>
                        <Text style={[styles.timePickerValue, { color: colors.text }]}>{wsStartTime}</Text>
                      </TouchableOpacity>
                      <Text style={[styles.timeSeparator, { color: colors.textSecondary }]}>→</Text>
                      <TouchableOpacity
                        style={[styles.timePickerButton, { borderColor: ws.showEnd ? colors.primary : colors.border }]}
                        onPress={() => updateWalkSession(wIdx, { showEnd: !ws.showEnd, showStart: false })}
                        activeOpacity={0.7}
                      >
                        <Text style={[styles.timeFieldLabel, { color: colors.textSecondary }]}>End Time</Text>
                        <Text style={[styles.timePickerValue, { color: colors.text }]}>{wsEndTime}</Text>
                      </TouchableOpacity>
                    </View>
                    {ws.showStart && (
                      <DateTimePicker
                        value={ws.startDate}
                        mode="time"
                        display="spinner"
                        themeVariant="dark"
                        accentColor="#FF2D55"
                        onChange={(_: DateTimePickerEvent, d?: Date) => {
                          if (d) updateWalkSession(wIdx, { startDate: d });
                        }}
                        style={{ height: 150 }}
                      />
                    )}
                    {ws.showEnd && (
                      <DateTimePicker
                        value={ws.endDate}
                        mode="time"
                        display="spinner"
                        themeVariant="dark"
                        accentColor="#FF2D55"
                        onChange={(_: DateTimePickerEvent, d?: Date) => {
                          if (d) updateWalkSession(wIdx, { endDate: d });
                        }}
                        style={{ height: 150 }}
                      />
                    )}

                    <Text style={[styles.feedingTimePreview, { color: colors.primary, marginTop: 8 }]}>
                      {wsStartTime} → {wsEndTime}  •  {wsDurText}
                    </Text>


                    {/* ── Specific Instructions ── */}
                    <TouchableOpacity
                      onPress={() => updateWalkSession(wIdx, { showInstructions: !ws.showInstructions })}
                      activeOpacity={0.7}
                      style={{ alignSelf: 'stretch', paddingVertical: 12 }}
                    >
                      <Text style={{ color: '#fff', textAlign: 'center', fontSize: 14, fontWeight: '500' }}>
                        {ws.showInstructions ? 'Hide walk instructions ▲' : 'Have specific walk instructions? ▼'}
                      </Text>
                    </TouchableOpacity>
                    {ws.showInstructions && (
                      <>
                        <TextInput
                          style={[styles.careInput, {
                            backgroundColor: colors.background,
                            borderColor: colors.border,
                            color: colors.text,
                            minHeight: 70,
                            marginTop: 4,
                          }]}
                          placeholder="Add specific instructions for this walk..."
                          placeholderTextColor={colors.textSecondary}
                          value={ws.instructions}
                          onChangeText={(text) => updateWalkSession(wIdx, { instructions: text })}
                          multiline
                          inputAccessoryViewID={DONE_ACCESSORY_ID}
                          numberOfLines={3}
                          textAlignVertical="top"
                          returnKeyType="done"
                          blurOnSubmit={true}
                        />
                        {/* Photos */}
                        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 8 }}>
                          {ws.photos.map((uri: string, pIdx: number) => (
                            <View key={pIdx} style={{ position: 'relative' }}>
                              <Image source={{ uri }} style={{ width: 70, height: 70, borderRadius: 10 }} />
                              <TouchableOpacity
                                onPress={() => removeServicePhoto('walk', wIdx, pIdx)}
                                style={{ position: 'absolute', top: -6, right: -6, backgroundColor: '#FF3B30', borderRadius: 10, width: 20, height: 20, alignItems: 'center', justifyContent: 'center' }}
                              >
                                <Text style={{ color: '#fff', fontSize: 12, fontWeight: '700' }}>✕</Text>
                              </TouchableOpacity>
                            </View>
                          ))}
                          {ws.photos.length < MAX_SERVICE_PHOTOS && (
                            <TouchableOpacity
                              onPress={() => pickServicePhoto('walk', wIdx)}
                              style={{ width: 70, height: 70, borderRadius: 10, borderWidth: 1, borderColor: colors.border, borderStyle: 'dashed', alignItems: 'center', justifyContent: 'center' }}
                            >
                              <Text style={{ fontSize: 24, color: colors.textSecondary }}>📷</Text>
                            </TouchableOpacity>
                          )}
                        </View>
                      </>
                    )}

                    </>
                    )}
                  </View>
                  );
                })}

                {/* Add another walk — outside cards */}
                {walkSessions.length < MAX_WALK_SESSIONS && (
                  <TouchableOpacity
                    style={[styles.addSessionBtn, { borderColor: colors.primary }]}
                    onPress={addWalkSession}
                    activeOpacity={0.7}
                  >
                    <Text style={[styles.addFeedingBtnText, { color: colors.primary }]}>
                      ➕ Add another walk
                    </Text>
                  </TouchableOpacity>
                )}

              </>
            )}

        {/* Divider before playtime */}
            {addOnCareTypes.has('playtime') && ((addOnCareTypes.has('dogWalking') && walkSessions.length > 1) || (!addOnCareTypes.has('dogWalking') && addOnCareTypes.has('feeding') && feedingSlots.length > 1)) && (
              <View style={{ borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border, marginTop: spacing.lg, marginBottom: spacing.xl }} />
            )}

        {/* ── Playtime (add-on) — multi-session ── */}
            {addOnCareTypes.has('playtime') && (
              <>
                {playSessions.map((pSession, pIdx) => (
                  <View key={pIdx} style={[styles.section, { backgroundColor: colors.surface, marginBottom: pIdx === playSessions.length - 1 ? 0 : spacing.md }, pIdx === playSessions.length - 1 && { borderBottomLeftRadius: 0, borderBottomRightRadius: 0 }]}>
                    {/* Header: arrow + title + repeat daily + ✕ — all inline centered */}
                    <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: collapsedPlay.has(pIdx) ? 0 : 10 }}>
                      <TouchableOpacity
                        onPress={() => toggleCollapse(setCollapsedPlay, pIdx)}
                        style={{ flexDirection: 'row', alignItems: 'center', flex: 1 }}
                        activeOpacity={0.7}
                      >
                        <Text style={{ color: colors.text, fontSize: 18, fontWeight: '600', marginRight: 8, width: 16 }}>
                          {collapsedPlay.has(pIdx) ? '›' : '▾'}
                        </Text>
                        <Text style={{ color: colors.text, fontSize: 22, fontWeight: '700' }}>
                          🎾 {pIdx === 0 ? 'Playtime' : `Playtime #${pIdx + 1}`}
                        </Text>
                      </TouchableOpacity>
                      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
                        {primaryCareType === 'overnight' && (
                          <TouchableOpacity
                            style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}
                            onPress={() => openRepeatModal('play', pIdx)}
                            activeOpacity={0.7}
                          >
                            <View style={{ alignItems: 'center' }}>
                            <Text style={{ fontSize: 15, fontWeight: '600', color: pSession.repeatSchedule ? '#34C759' : colors.textSecondary }}>
                              {pSession.repeatSchedule ? '✓ ' + formatRepeatLabel(pSession.repeatSchedule) : 'Repeat this?'}
                            </Text>
                              {pSession.repeatSchedule && formatRepeatSubLabel(pSession.repeatSchedule) && (
                                <Text style={{ fontSize: 13, color: colors.textSecondary, marginTop: 1, textAlign: 'center' }}>
                                  {formatRepeatSubLabel(pSession.repeatSchedule)}
                                </Text>
                              )}
                            </View>
                          </TouchableOpacity>
                        )}
                        <TouchableOpacity
                          onPress={() => Alert.alert(
                            playSessions.length === 1 ? 'Remove Playtime' : `Remove Playtime #${pIdx + 1}`,
                            playSessions.length === 1
                              ? 'Are you sure you want to remove playtime from this post?'
                              : 'Are you sure you want to remove this session?',
                            [
                              { text: 'Cancel', style: 'cancel' },
                              { text: 'Remove', style: 'destructive', onPress: () => {
                                if (playSessions.length === 1) {
                                  setAddOnCareTypes(prev => { const n = new Set(prev); n.delete('playtime'); return n; });
                                } else {
                                  removePlaySession(pIdx);
                                }
                              }},
                            ]
                          )}
                          hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                        >
                          <Text style={{ fontSize: 17, color: '#FF3B30', fontWeight: '700' }}>✕</Text>
                        </TouchableOpacity>
                      </View>
                    </View>
                    {!collapsedPlay.has(pIdx) && (
                    <>
                    <DogAssignRow
                      activeDogIds={pSession.dogIds}
                      onToggle={(dogId: string) => {
                        const current = pSession.dogIds;
                        const updated = current.includes(dogId)
                          ? current.filter((id: string) => id !== dogId)
                          : [...current, dogId];
                        updatePlaySession(pIdx, { dogIds: updated });
                      }}
                    />

                    {/* Flexible hours toggle */}
                    <TouchableOpacity
                      style={[
                        styles.dailyToggle,
                        { borderColor: pSession.flexible ? colors.primary : colors.border,
                          backgroundColor: pSession.flexible ? colors.primary + '15' : colors.background,
                          marginBottom: 12 },
                      ]}
                      onPress={() => updatePlaySession(pIdx, { flexible: !pSession.flexible })}
                      activeOpacity={0.7}
                    >
                      <Text style={{ fontSize: 17 }}>{pSession.flexible ? '⏱️' : '🕐'}</Text>
                      <Text style={[
                        styles.dailyToggleText,
                        { color: pSession.flexible ? colors.primary : colors.textSecondary },
                      ]}>
                        {pSession.flexible ? 'Flexible hours — any time of day' : 'Are playtime hours flexible?'}
                      </Text>
                    </TouchableOpacity>

                    {!pSession.flexible ? (
                      <>
                        {/* Fixed time: start → end with spinners */}
                        <View style={styles.timeRow}>
                          <TouchableOpacity
                            style={[styles.timePickerButton, { borderColor: pSession.showStart ? colors.primary : colors.border }]}
                            onPress={() => {
                              updatePlaySession(pIdx, { showStart: !pSession.showStart, showEnd: false });
                              // Close other sessions' pickers
                              playSessions.forEach((_, oIdx) => { if (oIdx !== pIdx) updatePlaySession(oIdx, { showStart: false, showEnd: false }); });
                            }}
                            activeOpacity={0.7}
                          >
                            <Text style={[styles.timeFieldLabel, { color: colors.textSecondary }]}>Start Time</Text>
                            <Text style={[styles.timePickerValue, { color: colors.text }]}>{formatTime12(pSession.startDate)}</Text>
                          </TouchableOpacity>
                          <Text style={[styles.timeSeparator, { color: colors.textSecondary }]}>→</Text>
                          <TouchableOpacity
                            style={[styles.timePickerButton, { borderColor: pSession.showEnd ? colors.primary : colors.border }]}
                            onPress={() => {
                              updatePlaySession(pIdx, { showEnd: !pSession.showEnd, showStart: false });
                              playSessions.forEach((_, oIdx) => { if (oIdx !== pIdx) updatePlaySession(oIdx, { showStart: false, showEnd: false }); });
                            }}
                            activeOpacity={0.7}
                          >
                            <Text style={[styles.timeFieldLabel, { color: colors.textSecondary }]}>End Time</Text>
                            <Text style={[styles.timePickerValue, { color: colors.text }]}>{formatTime12(pSession.endDate)}</Text>
                          </TouchableOpacity>
                        </View>
                        {pSession.showStart && (
                          <DateTimePicker
                            value={pSession.startDate}
                            mode="time"
                            display="spinner"
                            themeVariant="dark"
                            accentColor="#FF2D55"
                            onChange={(_: DateTimePickerEvent, d?: Date) => {
                              if (d) updatePlaySession(pIdx, { startDate: d });
                            }}
                            style={{ height: 150 }}
                          />
                        )}
                        {pSession.showEnd && (
                          <DateTimePicker
                            value={pSession.endDate}
                            mode="time"
                            display="spinner"
                            themeVariant="dark"
                            accentColor="#FF2D55"
                            onChange={(_: DateTimePickerEvent, d?: Date) => {
                              if (d) updatePlaySession(pIdx, { endDate: d });
                            }}
                            style={{ height: 150 }}
                          />
                        )}
                        <Text style={[styles.feedingTimePreview, { color: colors.primary, marginTop: 8 }]}>
                          {formatTime12(pSession.startDate)} → {formatTime12(pSession.endDate)}  •  {getPlayDurationText(pSession)}
                        </Text>
                      </>
                    ) : (
                      <>
                        {/* Flexible mode: duration pills */}
                        <Text style={[styles.fieldHint, { color: colors.textSecondary, marginBottom: 8 }]}>
                          How long should this play session be?
                        </Text>
                        <View style={styles.durationRow}>
                          {[15, 30, 60, 90, 120].map((mins) => (
                            <TouchableOpacity
                              key={mins}
                              style={[
                                styles.durationPill,
                                { borderColor: colors.border, backgroundColor: colors.background },
                                pSession.durationMins === mins && { backgroundColor: colors.primary, borderColor: colors.primary },
                              ]}
                              onPress={() => updatePlaySession(pIdx, { durationMins: mins })}
                            >
                              <Text style={[
                                styles.durationPillText,
                                { color: colors.text },
                                pSession.durationMins === mins && { color: '#fff', fontWeight: '700' },
                              ]}>
                                {mins >= 60 ? `${mins / 60}h` : `${mins}m`}
                              </Text>
                            </TouchableOpacity>
                          ))}
                        </View>
                      </>
                    )}


                    {/* ── Specific Instructions ── */}
                    <TouchableOpacity
                      onPress={() => updatePlaySession(pIdx, { showInstructions: !pSession.showInstructions })}
                      activeOpacity={0.7}
                      style={{ alignSelf: 'stretch', paddingVertical: 12 }}
                    >
                      <Text style={{ color: '#fff', textAlign: 'center', fontSize: 14, fontWeight: '500' }}>
                        {pSession.showInstructions ? 'Hide playtime instructions ▲' : 'Have specific playtime instructions? ▼'}
                      </Text>
                    </TouchableOpacity>
                    {pSession.showInstructions && (
                      <>
                        <TextInput
                          style={[styles.careInput, {
                            backgroundColor: colors.background,
                            borderColor: colors.border,
                            color: colors.text,
                            minHeight: 70,
                            marginTop: 4,
                          }]}
                          placeholder="Add specific instructions for this playtime..."
                          placeholderTextColor={colors.textSecondary}
                          value={pSession.instructions}
                          onChangeText={(text) => updatePlaySession(pIdx, { instructions: text })}
                          multiline
                          inputAccessoryViewID={DONE_ACCESSORY_ID}
                          numberOfLines={3}
                          textAlignVertical="top"
                          returnKeyType="done"
                          blurOnSubmit={true}
                        />
                        {/* Photos */}
                        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 8 }}>
                          {pSession.photos.map((uri: string, pPhotoIdx: number) => (
                            <View key={pPhotoIdx} style={{ position: 'relative' }}>
                              <Image source={{ uri }} style={{ width: 70, height: 70, borderRadius: 10 }} />
                              <TouchableOpacity
                                onPress={() => removeServicePhoto('play', pIdx, pPhotoIdx)}
                                style={{ position: 'absolute', top: -6, right: -6, backgroundColor: '#FF3B30', borderRadius: 10, width: 20, height: 20, alignItems: 'center', justifyContent: 'center' }}
                              >
                                <Text style={{ color: '#fff', fontSize: 12, fontWeight: '700' }}>✕</Text>
                              </TouchableOpacity>
                            </View>
                          ))}
                          {pSession.photos.length < MAX_SERVICE_PHOTOS && (
                            <TouchableOpacity
                              onPress={() => pickServicePhoto('play', pIdx)}
                              style={{ width: 70, height: 70, borderRadius: 10, borderWidth: 1, borderColor: colors.border, borderStyle: 'dashed', alignItems: 'center', justifyContent: 'center' }}
                            >
                              <Text style={{ fontSize: 24, color: colors.textSecondary }}>📷</Text>
                            </TouchableOpacity>
                          )}
                        </View>
                      </>
                    )}

                    </>
                    )}
                  </View>
                ))}

                {/* Add another playtime — outside cards */}
                {playSessions.length < MAX_PLAY_SESSIONS && (
                  <TouchableOpacity
                    style={[styles.addSessionBtn, { borderColor: colors.primary }]}
                    onPress={addPlaySession}
                    activeOpacity={0.7}
                  >
                    <Text style={[styles.addFeedingBtnText, { color: colors.primary }]}>
                      ➕ Add another playtime
                    </Text>
                  </TouchableOpacity>
                )}

              </>
            )}


        {/* Divider before medication */}
            {addOnCareTypes.has('medication') && ((addOnCareTypes.has('playtime') && playSessions.length > 1) || (!addOnCareTypes.has('playtime') && addOnCareTypes.has('dogWalking') && walkSessions.length > 1) || (!addOnCareTypes.has('playtime') && !addOnCareTypes.has('dogWalking') && addOnCareTypes.has('feeding') && feedingSlots.length > 1)) && (
              <View style={{ borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border, marginTop: spacing.lg, marginBottom: spacing.xl }} />
            )}

        {/* ── Medication (add-on) ── */}
            {addOnCareTypes.has('medication') && (
              <>
                {medicationSlots.map((slot, idx) => (
                  <View key={idx} style={[styles.section, { backgroundColor: colors.surface, marginBottom: idx === medicationSlots.length - 1 ? 0 : spacing.md }, idx === medicationSlots.length - 1 && { borderBottomLeftRadius: 0, borderBottomRightRadius: 0 }]}>
                    {/* Header: arrow + title + repeat daily + ✕ — all inline centered */}
                    <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: collapsedMeds.has(idx) ? 0 : 10 }}>
                      <TouchableOpacity
                        onPress={() => toggleCollapse(setCollapsedMeds, idx)}
                        style={{ flexDirection: 'row', alignItems: 'center', flex: 1 }}
                        activeOpacity={0.7}
                      >
                        <Text style={{ color: colors.text, fontSize: 18, fontWeight: '600', marginRight: 8, width: 16 }}>
                          {collapsedMeds.has(idx) ? '›' : '▾'}
                        </Text>
                        <Text style={{ color: colors.text, fontSize: 22, fontWeight: '700' }}>
                          💊 {idx === 0 ? 'Medication' : `Medication #${idx + 1}`}
                        </Text>
                      </TouchableOpacity>
                      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
                        {primaryCareType === 'overnight' && (
                          <TouchableOpacity
                            style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}
                            onPress={() => openRepeatModal('medication', idx)}
                            activeOpacity={0.7}
                          >
                            <View style={{ alignItems: 'center' }}>
                            <Text style={{ fontSize: 15, fontWeight: '600', color: slot.repeatSchedule ? '#34C759' : colors.textSecondary }}>
                              {slot.repeatSchedule ? '✓ ' + formatRepeatLabel(slot.repeatSchedule) : 'Repeat this?'}
                            </Text>
                              {slot.repeatSchedule && formatRepeatSubLabel(slot.repeatSchedule) && (
                                <Text style={{ fontSize: 13, color: colors.textSecondary, marginTop: 1, textAlign: 'center' }}>
                                  {formatRepeatSubLabel(slot.repeatSchedule)}
                                </Text>
                              )}
                            </View>
                          </TouchableOpacity>
                        )}
                        <TouchableOpacity
                          onPress={() => Alert.alert(
                            medicationSlots.length === 1 ? 'Remove Medication' : `Remove Medication #${idx + 1}`,
                            medicationSlots.length === 1
                              ? 'Are you sure you want to remove medication from this post?'
                              : 'Are you sure you want to remove this medication?',
                            [
                              { text: 'Cancel', style: 'cancel' },
                              { text: 'Remove', style: 'destructive', onPress: () => {
                                if (medicationSlots.length === 1) {
                                  setAddOnCareTypes(prev => { const n = new Set(prev); n.delete('medication'); return n; });
                                } else {
                                  removeMedicationSlot(idx);
                                }
                              }},
                            ]
                          )}
                          hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                        >
                          <Text style={{ fontSize: 17, color: '#FF3B30', fontWeight: '700' }}>✕</Text>
                        </TouchableOpacity>
                      </View>
                    </View>
                    {!collapsedMeds.has(idx) && (
                    <>
                    {/* Dog assignment row */}
                    {selectedDogs.length > 1 && (
                      <DogAssignRow
                        activeDogIds={slot.dogIds}
                        onToggle={(dogId: string) => {
                          const updated = slot.dogIds.includes(dogId)
                            ? slot.dogIds.filter((id: string) => id !== dogId)
                            : [...slot.dogIds, dogId];
                          updateMedicationSlot(idx, 'dogIds', updated);
                        }}
                      />
                    )}

                    {/* Time picker */}
                    <TouchableOpacity
                      style={[styles.timePickerButton, { borderColor: slot.showPicker ? colors.primary : colors.border, alignSelf: 'stretch' }]}
                      onPress={() => updateMedicationSlot(idx, 'showPicker', !slot.showPicker)}
                      activeOpacity={0.7}
                    >
                      <Text style={[styles.timeFieldLabel, { color: colors.textSecondary }]}>
                        {medicationSlots.length > 1 ? `Medication ${idx + 1} Time` : 'Medication Time'}
                      </Text>
                      <Text style={[styles.feedingTimePreview, { color: colors.text }]}>{formatTime12(slot.time)}</Text>
                    </TouchableOpacity>
                    {slot.showPicker && (
                      <DateTimePicker
                        value={slot.time}
                        mode="time"
                        display="spinner"
                        themeVariant="dark"
                        accentColor="#FF2D55"
                        onChange={(_: DateTimePickerEvent, d?: Date) => {
                          if (d) updateMedicationSlot(idx, 'time', d);
                        }}
                        style={{ height: 150 }}
                      />
                    )}

                    {/* Extra medication times */}
                    {slot.extraTimes.map((et, etIdx) => (
                      <View key={etIdx} style={{ marginTop: 8 }}>
                        <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                          <TouchableOpacity
                            style={[styles.timePickerButton, { borderColor: et.showPicker ? colors.primary : colors.border, flex: 1 }]}
                            onPress={() => toggleMedExtraTimePicker(idx, etIdx)}
                            activeOpacity={0.7}
                          >
                            <Text style={[styles.timeFieldLabel, { color: colors.textSecondary }]}>
                              Time {etIdx + 2}
                            </Text>
                            <Text style={[styles.feedingTimePreview, { color: colors.text }]}>{formatTime12(et.time)}</Text>
                          </TouchableOpacity>
                          <TouchableOpacity
                            onPress={() => removeMedExtraTime(idx, etIdx)}
                            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                            style={{ marginLeft: 10 }}
                          >
                            <Text style={{ fontSize: 15, color: '#FF3B30', fontWeight: '700' }}>✕</Text>
                          </TouchableOpacity>
                        </View>
                        {et.showPicker && (
                          <DateTimePicker
                            value={et.time}
                            mode="time"
                            display="spinner"
                            themeVariant="dark"
                            accentColor="#FF2D55"
                            onChange={(_: DateTimePickerEvent, d?: Date) => {
                              if (d) updateMedExtraTime(idx, etIdx, d);
                            }}
                            style={{ height: 150 }}
                          />
                        )}
                      </View>
                    ))}

                    {/* Add another time */}
                    <TouchableOpacity
                      onPress={() => addMedExtraTime(idx)}
                      activeOpacity={0.7}
                      style={{ marginTop: 10, marginBottom: 4 }}
                    >
                      <Text style={{ fontSize: 15, fontWeight: '600', color: colors.primary, textAlign: 'center' }}>
                        + Add another time for this medication
                      </Text>
                    </TouchableOpacity>

                    {/* Medication details text field */}
                    <TextInput
                      style={[styles.careInput, {
                        backgroundColor: colors.background,
                        borderColor: colors.border,
                        color: colors.text,
                        minHeight: 70,
                        marginTop: 8,
                      }]}
                      placeholder="Specify medication details (e.g. 1 pill of Apoquel with food, apply ear drops to both ears...)"
                      placeholderTextColor={colors.textSecondary}
                      value={slot.details}
                      onChangeText={(text) => updateMedicationSlot(idx, 'details', text)}
                      multiline
                      inputAccessoryViewID={DONE_ACCESSORY_ID}
                      numberOfLines={3}
                      textAlignVertical="top"
                      returnKeyType="done"
                      blurOnSubmit={true}
                    />

                    {/* Medication Photos */}
                    <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 8 }}>
                      {slot.photos.map((uri: string, pIdx: number) => (
                        <View key={pIdx} style={{ position: 'relative' }}>
                          <Image source={{ uri }} style={{ width: 70, height: 70, borderRadius: 10 }} />
                          <TouchableOpacity
                            onPress={() => removeServicePhoto('medication', idx, pIdx)}
                            style={{ position: 'absolute', top: -6, right: -6, backgroundColor: '#FF3B30', borderRadius: 10, width: 20, height: 20, alignItems: 'center', justifyContent: 'center' }}
                          >
                            <Text style={{ color: '#fff', fontSize: 12, fontWeight: '700' }}>✕</Text>
                          </TouchableOpacity>
                        </View>
                      ))}
                      {slot.photos.length < MAX_SERVICE_PHOTOS && (
                        <TouchableOpacity
                          onPress={() => pickServicePhoto('medication', idx)}
                          style={{ width: 70, height: 70, borderRadius: 10, borderWidth: 1, borderColor: colors.border, borderStyle: 'dashed', alignItems: 'center', justifyContent: 'center' }}
                        >
                          <Text style={{ fontSize: 24, color: colors.textSecondary }}>📷</Text>
                        </TouchableOpacity>
                      )}
                    </View>

                    </>
                    )}
                  </View>
                ))}

                {/* Add another medication — outside cards */}
                <TouchableOpacity
                  style={[styles.addSessionBtn, { borderColor: colors.primary }]}
                  onPress={addMedicationSlot}
                  activeOpacity={0.7}
                >
                  <Text style={[styles.addFeedingBtnText, { color: colors.primary }]}>
                    ➕ Add another medication
                  </Text>
                </TouchableOpacity>

              </>
            )}

        </>
                )}

        {/* ── Care Details collapsible header ── */}
        {(primaryCareType !== null || addOnCareTypes.size > 0) && (
          <>
          <TouchableOpacity
            style={{ flexDirection: 'row', alignItems: 'center', marginTop: spacing.xl, marginBottom: spacing.md }}
            onPress={() => {
              setCareDetailsCollapsed(prev => !prev);
              Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
            }}
            activeOpacity={0.7}
          >
            <View style={{ flex: 1, height: StyleSheet.hairlineWidth, backgroundColor: colors.border }} />
            <View style={{ flexDirection: 'row', alignItems: 'center', paddingHorizontal: 14 }}>
              <Text style={{ fontSize: 22, fontWeight: '700', color: colors.textSecondary, letterSpacing: 0.5 }}>📋 Overall Care Details</Text>
              <Text style={{ fontSize: 18, color: colors.textSecondary, marginLeft: 8 }}>{careDetailsCollapsed ? '›' : '▾'}</Text>
            </View>
            <View style={{ flex: 1, height: StyleSheet.hairlineWidth, backgroundColor: colors.border }} />
          </TouchableOpacity>

          {!careDetailsCollapsed && (
        <Animated.View ref={(node: View | null) => { refFor('careDetails')(node); validationRefFor('careDetails')(node); }} style={[styles.section, { backgroundColor: colors.surface, transform: [{ scale: pulsingSection === 'careDetails' ? pulseAnim : 1 }] }, pulsingSection === 'careDetails' && { shadowColor: '#FF2D55', shadowOpacity: glowAnim, shadowRadius: 12, shadowOffset: { width: 0, height: 0 }, elevation: 8 }]}>
              <Text style={[styles.careHint, { color: colors.textSecondary }]}>
                Any other info the caretaker should know — behavioral notes, how to access your home, etc.
              </Text>
              <TextInput
                style={[
                  styles.careInput,
                  {
                    backgroundColor: colors.background,
                    borderColor:
                      careDetails.trim().length > 0 && careDetails.trim().length < MIN_CARE_DETAILS
                        ? colors.error
                        : colors.border,
                    color: colors.text },
                ]}
                placeholder="e.g. Bella is a big dog with a lot of energy and likes to jump! Please make sure you are physically able to handle this! I will message you the door code."
                placeholderTextColor={colors.textSecondary}
                value={careDetails}
                onChangeText={setCareDetails}
                multiline
                inputAccessoryViewID={DONE_ACCESSORY_ID}
                numberOfLines={6}
                textAlignVertical="top"
                accessibilityLabel="Care details for the sitter"
                returnKeyType="done"
                blurOnSubmit={true}
                autoCorrect={true}
                spellCheck={true}
                autoCapitalize="sentences"
                onFocus={() => scrollToInput('careDetails')}
              />
              <CharCountHint current={careDetails.trim().length} min={MIN_CARE_DETAILS} />

              <View style={{ height: 16 }} />
              {/* ── Care Photos ── */}
              <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.carePhotoRow}>
                {carePhotos.map((uri, idx) => (
                  <View key={idx} style={styles.carePhotoThumb}>
                    <Image source={{ uri }} style={styles.carePhotoImg} />
                    <TouchableOpacity
                      style={styles.carePhotoRemove}
                      onPress={() => removeCarePhoto(idx)}
                      accessibilityLabel={`Remove photo ${idx + 1}`}
                    >
                      <Ionicons name="close-circle" size={22} color="#FF2D55" />
                    </TouchableOpacity>
                  </View>
                ))}
                {carePhotos.length < MAX_CARE_PHOTOS && (
                  <TouchableOpacity
                    style={[styles.carePhotoAdd, { borderColor: colors.border, backgroundColor: colors.background }]}
                    onPress={addCarePhoto}
                    accessibilityLabel="Add care photo"
                    accessibilityRole="button"
                  >
                    {uploadingPhoto ? (
                      <ActivityIndicator size="small" color={colors.primary} />
                    ) : (
                      <>
                        <Ionicons name="camera-outline" size={24} color={colors.textSecondary} />
                      </>
                    )}
                  </TouchableOpacity>
                )}
              </ScrollView>
              <Text style={{ fontSize: 13, color: colors.textSecondary, marginTop: 8 }}>
                Add photos (food location, leash, key spot, etc.)
              </Text>
            </Animated.View>
          )}
          </>
        )}

        {/* ── Compensation collapsible header ── */}
        <TouchableOpacity
          style={{ flexDirection: 'row', alignItems: 'center', marginTop: spacing.xl, marginBottom: spacing.xl }}
          onPress={() => {
            setCompensationCollapsed(prev => !prev);
            Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
          }}
          activeOpacity={0.7}
        >
          <View style={{ flex: 1, height: StyleSheet.hairlineWidth, backgroundColor: colors.border }} />
          <View style={{ flexDirection: 'row', alignItems: 'center', paddingHorizontal: 14 }}>
            <Text style={{ fontSize: 22, fontWeight: '700', color: colors.textSecondary, letterSpacing: 0.5 }}>Compensation</Text>
            <Text style={{ fontSize: 18, color: colors.textSecondary, marginLeft: 8 }}>{compensationCollapsed ? '›' : '▾'}</Text>
          </View>
          <View style={{ flex: 1, height: StyleSheet.hairlineWidth, backgroundColor: colors.border }} />
        </TouchableOpacity>

        {/* ── Compensation ── */}
        {!compensationCollapsed && (
            <Animated.View ref={validationRefFor('compensation')} style={[styles.section, { backgroundColor: colors.surface, transform: [{ scale: pulsingSection === 'compensation' ? pulseAnim : 1 }] }, pulsingSection === 'compensation' && { shadowColor: '#FF2D55', shadowOpacity: glowAnim, shadowRadius: 12, shadowOffset: { width: 0, height: 0 }, elevation: 8 }]}>

              {/* Recommended points — only when points toggle is ON */}
              {offerPoints && recommendedPoints.total > 0 && (
                <View style={styles.recBox}>
                  <Text style={{ fontSize: 16, color: colors.textSecondary, lineHeight: 22 }}>
                    Suggested{' '}
                    <Text
                      style={{ fontWeight: '700', color: colors.text, textDecorationLine: 'underline' }}
                      onPress={() => setPointsOffered(String(recommendedPoints.total))}
                    >
                      {recommendedPoints.total} points
                    </Text>
                    {' '}based on the care you've selected… but it's up to you!
                  </Text>

                  {/* Expandable pricing guide */}
                  <TouchableOpacity
                    style={styles.pricingGuideToggle}
                    onPress={() => setShowPricingGuide(prev => !prev)}
                    activeOpacity={0.7}
                  >
                    <Text style={[styles.pricingGuideToggleText, { color: colors.primary }]}>
                      {showPricingGuide ? '▾' : '▸'} How we calculate this
                    </Text>
                  </TouchableOpacity>

                  {showPricingGuide && (
                    <>
                    {/* Cell 1: Your Breakdown + total + disclaimer */}
                    <View style={{ marginTop: 10, borderRadius: 10, overflow: 'hidden', borderWidth: 1, borderColor: colors.border }}>
                      <View style={{ flexDirection: 'row', alignItems: 'center', backgroundColor: colors.surface, paddingVertical: 10, paddingHorizontal: 14 }}>
                        <View style={{ width: 3, height: 20, backgroundColor: colors.primary, borderRadius: 2, marginRight: 10 }} />
                        <Text style={{ fontSize: 16, fontWeight: '700', color: colors.text, letterSpacing: 0.3 }}>Your Breakdown</Text>
                      </View>
                      <View style={{ padding: 12, backgroundColor: colors.background }}>
                      {recommendedPoints.breakdown.map((item, i) => (
                        <View key={i} style={styles.guideRow}>
                          <Text style={[styles.guideRowLabel, { color: colors.text }]}>{item.label}</Text>
                          <Text style={[styles.guideRowValue, { color: colors.primary }]}>{item.pts} pt{item.pts !== 1 ? "s" : ""}</Text>
                        </View>
                      ))}
                      {recommendedPoints.numDogs > 1 && (
                        <View style={[styles.guideRow, { borderTopWidth: 0.5, borderTopColor: colors.border, paddingTop: 8, marginTop: 4 }]}>
                          <Text style={[styles.guideRowLabel, { color: colors.text }]}>
                            +10% per additional pup ({recommendedPoints.numDogs} pups)
                          </Text>
                          <Text style={[styles.guideRowValue, { color: colors.primary }]}>{recommendedPoints.total} pts</Text>
                        </View>
                      )}

                      {/* Total */}
                      <View style={{ borderTopWidth: 0.5, borderTopColor: colors.border, marginTop: 8, paddingTop: 8 }}>
                        <View style={styles.guideRow}>
                          <Text style={[styles.guideRowLabel, { color: colors.text, fontWeight: '700' }]}>Total</Text>
                          <Text style={[styles.guideRowValue, { color: colors.primary, fontWeight: '700' }]}>{recommendedPoints.total} pts</Text>
                        </View>
                      </View>

                      <Text style={{ fontSize: 12, color: colors.textSecondary, marginTop: 10, lineHeight: 17, fontStyle: 'italic' }}>
                        These suggestions don{"'"}t consider any extra care details we may not be aware of, holidays, how last minute this was posted, etc.
                      </Text>
                      </View>
                    </View>

                    {/* Cell 2: Rate explanation + Suggested Rates chart */}
                    <View style={{ marginTop: 10, borderRadius: 10, overflow: 'hidden', borderWidth: 1, borderColor: colors.border }}>
                      <View style={{ flexDirection: 'row', alignItems: 'center', backgroundColor: colors.surface, paddingVertical: 10, paddingHorizontal: 14 }}>
                        <View style={{ width: 3, height: 20, backgroundColor: colors.primary, borderRadius: 2, marginRight: 10 }} />
                        <Text style={{ fontSize: 16, fontWeight: '700', color: colors.text, letterSpacing: 0.3 }}>General Rates Guide</Text>
                      </View>
                      <View style={{ padding: 12, backgroundColor: colors.background }}>
                      <Text style={{ fontSize: 13, color: colors.textSecondary, lineHeight: 19 }}>
                        Rates vary per job — for example, a standalone feeding is 1 pt because the caretaker is traveling just for that visit, but we don{"'"}t add points for a feeding on an overnight stay because the caretaker is already there and getting points for the day. That{"'"}s why some services on the chart below are ranges!
                      </Text>

                      <View style={{ marginTop: 12 }}>
                        {/* Fixed rates — no range */}
                        <View style={styles.guideRow}>
                          <Text style={{ fontSize: 14, color: colors.text }}>Overnight stay</Text>
                          <Text style={{ fontSize: 14, color: colors.textSecondary }}>6 pts / night</Text>
                        </View>
                        <View style={styles.guideRow}>
                          <Text style={{ fontSize: 14, color: colors.text }}>Daytime care</Text>
                          <Text style={{ fontSize: 14, color: colors.textSecondary }}>1 pt / hr</Text>
                        </View>
                        {/* Range rates — underlined + tappable */}
                        <View style={styles.guideRow}>
                          <Text style={{ fontSize: 14, color: colors.text }}>Walks</Text>
                          <Text
                            style={{ fontSize: 14, color: colors.textSecondary, textDecorationLine: 'underline' }}
                            onPress={() => Alert.alert('Walk Rates', '0.5 pts/hr when the caretaker is already there (overnight or day sitting) — they\'re just adding a walk to the stay.\n\n1 pt/hr as a standalone visit — the caretaker is traveling just for the walk.')}
                          >0.5 – 1 pt / hr</Text>
                        </View>
                        <View style={styles.guideRow}>
                          <Text style={{ fontSize: 14, color: colors.text }}>Playtime</Text>
                          <Text
                            style={{ fontSize: 14, color: colors.textSecondary, textDecorationLine: 'underline' }}
                            onPress={() => Alert.alert('Playtime Rates', '0.5 pts/hr when the caretaker is already there (overnight or day sitting) — they\'re just adding playtime to the stay.\n\n1 pt/hr as a standalone visit — the caretaker is traveling just for playtime.')}
                          >0.5 – 1 pt / hr</Text>
                        </View>
                        <View style={styles.guideRow}>
                          <Text style={{ fontSize: 14, color: colors.text }}>Feeding</Text>
                          <Text
                            style={{ fontSize: 14, color: colors.textSecondary, textDecorationLine: 'underline' }}
                            onPress={() => Alert.alert('Feeding Rates', '0 pts during an overnight or day sitting stay — the caretaker is already there, so feeding is included.\n\n1 pt as a standalone visit — the caretaker is traveling just to feed your pup.')}
                          >0 – 1 pt</Text>
                        </View>
                        <View style={styles.guideRow}>
                          <Text style={{ fontSize: 14, color: colors.text }}>Medication</Text>
                          <Text
                            style={{ fontSize: 14, color: colors.textSecondary, textDecorationLine: 'underline' }}
                            onPress={() => Alert.alert('Medication Rates', '0 pts during an overnight or day sitting stay — the caretaker is already there, so giving meds is included.\n\n1 pt as a standalone visit — the caretaker is traveling just to give medication.')}
                          >0 – 1 pt</Text>
                        </View>
                        <View style={styles.guideRow}>
                          <Text style={{ fontSize: 14, color: colors.text }}>Extra dogs</Text>
                          <Text style={{ fontSize: 14, color: colors.textSecondary }}>+10% each</Text>
                        </View>
                      </View>
                      </View>
                    </View>
                    </>
                  )}
                </View>
              )}

              {/* Payments note — only when money toggle is ON */}
              {offerMoney && (
                <View style={[styles.offAppNote, { backgroundColor: '#FFF9E6', borderColor: '#F0C040' }]}>
                  <Text style={[styles.offAppNoteText, { color: '#7A6000' }]}>
                    💰 All payments are arranged and made outside of WatchDog. We do not process payments.
                  </Text>
                </View>
              )}

              {/* Points toggle */}
              <View style={styles.toggleRow}>
                <View style={styles.toggleLabelGroup}>
                  <Text style={[styles.toggleLabel, { color: colors.text }]}>Offer points</Text>
                </View>
                <Switch
                  value={offerPoints}
                  onValueChange={(v) => {
                    setOfferPoints(v);
                    if (v) setOfferMoney(false);
                    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                  }}
                  trackColor={{ false: colors.border, true: colors.primary }}
                  thumbColor="#fff"
                  accessibilityLabel="Offer points"
                />
              </View>

              {/* Money toggle */}
              <View style={styles.toggleRow}>
                <View style={styles.toggleLabelGroup}>
                  <Text style={[styles.toggleLabel, { color: colors.text }]}>Offer money</Text>
                </View>
                <Switch
                  value={offerMoney}
                  onValueChange={(v) => {
                    setOfferMoney(v);
                    if (v) setOfferPoints(false);
                    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                  }}
                  trackColor={{ false: colors.border, true: colors.primary }}
                  thumbColor="#fff"
                  accessibilityLabel="Offer money"
                />
              </View>

              {/* Points input */}
              {offerPoints && (
                <>
                  <View style={{ height: 16 }} />
                  <View style={{ borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border, marginBottom: 16 }} />
                  <Text style={[styles.pointsInputLabel, { color: colors.text }]}>
                    How many points is this job worth?
                  </Text>
                  <View style={{ height: 8 }} />
                  <View ref={refFor('points')} style={styles.pointsInputRow}>
                    <TextInput
                      style={[styles.pointsInput, { borderColor: '#FFFFFF', backgroundColor: colors.background, color: colors.text }]}
                      placeholder="e.g. 5"
                      placeholderTextColor={colors.textSecondary}
                      value={pointsOffered}
                      onChangeText={(t) => setPointsOffered(t.replace(/[^0-9]/g, ''))}
                      keyboardType="number-pad"
                      accessibilityLabel="Points offered"
                      returnKeyType="done"
                      onFocus={() => scrollToInput('points')}
                    />
                    <Text style={[styles.pointsUnit, { color: colors.textSecondary }]}>pts</Text>
                  </View>

                  {/* Insufficient points warning */}
                  {(() => {
                    const pts = parseInt(pointsOffered, 10);
                    const balance = userProfile?.points ?? 0;
                    if (pts > 0 && pts > balance) {
                      return (
                        <View style={styles.insufficientWarning}>
                          <Text style={styles.insufficientWarningText}>
                            ⚠️ You only have {balance.toFixed(1)} points
                          </Text>
                        </View>
                      );
                    }
                    return null;
                  })()}

                </>
              )}

              {offerMoney && (
                <>
                  <View ref={refFor('payment')} style={styles.paymentInputRow}>
                    <Text style={[styles.dollarSign, { color: colors.text }]}>$</Text>
                    <TextInput
                      style={[styles.paymentInput, { borderColor: colors.border, backgroundColor: colors.background, color: colors.text }]}
                      placeholder="0.00"
                      placeholderTextColor={colors.textSecondary}
                      value={paymentAmount}
                      onChangeText={setPaymentAmount}
                      keyboardType="decimal-pad"
                      accessibilityLabel="Payment amount in dollars"
                      returnKeyType="done"
                      onFocus={() => scrollToInput('payment')}
                    />
                    <Text style={[styles.rateUnitLabel, { color: colors.textSecondary }]}>
                      for the job
                    </Text>
                  </View>

                  {paymentBreakdownLabel ? (
                    <View style={[styles.breakdownBadge, { backgroundColor: '#00B89418', borderColor: '#00B894' }]}>
                      <Text style={[styles.breakdownText, { color: '#00B894' }]}>{paymentBreakdownLabel}</Text>
                    </View>
                  ) : (
                    <Text style={[styles.calcHint, { color: colors.textSecondary }]}>
                      Enter amount to see total
                    </Text>
                  )}

                </>
              )}
            </Animated.View>
        )}

            {/* ── Submit ── */}
            <TouchableOpacity
              style={[styles.submitBtn, { backgroundColor: colors.primary, opacity: submitting ? 0.7 : 1 }]}
              onPress={validateAndSubmit}
              disabled={submitting}
              accessibilityLabel={submitting ? 'Posting...' : 'Post Request'}
              accessibilityRole="button"
            >
              <Text style={styles.submitBtnText}>{submitting ? 'Posting...' : 'Post Request 🐾'}</Text>
            </TouchableOpacity>

      </ScrollView>
      <ConfettiCelebration
        queue={celebrationQueue}
        onDismissAll={() => {
          setCelebrationQueue([]);
          navigation.goBack();
        }}
      />
      <RepeatScheduleModal
        visible={repeatModalVisible}
        onClose={() => { setRepeatModalVisible(false); setRepeatModalTarget(null); }}
        onConfirm={handleRepeatConfirm}
        onClear={handleRepeatClear}
        currentSchedule={getRepeatScheduleForTarget()}
        defaultTime={getRepeatDefaultTime()}
      />

      {/* ── Address Entry Modal ── */}
      <Modal
        visible={showAddressModal}
        transparent
        animationType="slide"
        onRequestClose={() => setShowAddressModal(false)}
      >
        <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'} style={{ flex: 1, justifyContent: 'flex-end' }}>
          <TouchableOpacity style={{ flex: 1 }} activeOpacity={1} onPress={() => setShowAddressModal(false)}>
            <BlurView intensity={50} tint="dark" style={{ flex: 1 }} />
          </TouchableOpacity>
          <View style={{ backgroundColor: colors.surface, borderTopLeftRadius: 20, borderTopRightRadius: 20, padding: 20, paddingBottom: 40, maxHeight: '80%' }}>
            <Text style={{ fontSize: 20, fontWeight: '700', color: colors.text, textAlign: 'center', marginBottom: 4 }}>Enter Address</Text>
            <Text style={{ fontSize: 13, color: colors.textSecondary, textAlign: 'center', marginBottom: 16 }}>
              🔒 Your address is kept private and only revealed to an accepted caretaker.
            </Text>

            {/* Current / suggested address from profile location */}
            {suggestedAddress.length > 0 && (
              <TouchableOpacity
                onPress={() => { saveAddress(suggestedAddress); setAddressQuery(''); setAddressSuggestions([]); }}
                style={{ backgroundColor: careAddress === suggestedAddress ? colors.primary + '25' : colors.primary + '10', borderWidth: 1.5, borderColor: careAddress === suggestedAddress ? colors.primary : colors.primary + '40', borderRadius: 12, padding: 14, marginBottom: 10, flexDirection: 'row', alignItems: 'center' }}
                activeOpacity={0.7}
              >
                <Text style={{ fontSize: 16, marginRight: 8 }}>📍</Text>
                <View style={{ flex: 1 }}>
                  <Text style={{ fontSize: 11, color: colors.textSecondary, fontWeight: '600', marginBottom: 2 }}>YOUR CURRENT LOCATION</Text>
                  <Text style={{ fontSize: 15, color: colors.text, fontWeight: '500' }}>{suggestedAddress}</Text>
                </View>
                {careAddress === suggestedAddress && <Text style={{ fontSize: 14, color: colors.primary, fontWeight: '700' }}>✓</Text>}
              </TouchableOpacity>
            )}

            {/* Saved addresses */}
            {savedAddresses.filter(a => a !== suggestedAddress).length > 0 && (
              <View style={{ marginBottom: 10 }}>
                <Text style={{ fontSize: 11, color: colors.textSecondary, fontWeight: '600', marginBottom: 6, letterSpacing: 0.5 }}>SAVED ADDRESSES</Text>
                {savedAddresses.filter(a => a !== suggestedAddress).map((addr, i) => (
                  <TouchableOpacity
                    key={i}
                    onPress={() => { saveAddress(addr); setAddressQuery(''); setAddressSuggestions([]); }}
                    style={{ backgroundColor: careAddress === addr ? colors.primary + '15' : colors.background, borderWidth: 1, borderColor: careAddress === addr ? colors.primary : colors.border, borderRadius: 10, padding: 12, marginBottom: 6, flexDirection: 'row', alignItems: 'center' }}
                    activeOpacity={0.7}
                  >
                    <Text style={{ fontSize: 14, marginRight: 8 }}>🏠</Text>
                    <Text style={{ fontSize: 15, color: colors.text, flex: 1 }}>{addr}</Text>
                    {careAddress === addr && <Text style={{ fontSize: 14, color: colors.primary, fontWeight: '700' }}>✓</Text>}
                  </TouchableOpacity>
                ))}
              </View>
            )}

            {/* Search with autocomplete */}
            <Text style={{ fontSize: 11, color: colors.textSecondary, fontWeight: '600', marginBottom: 6, letterSpacing: 0.5 }}>SEARCH FOR AN ADDRESS</Text>
            <TextInput
              style={{
                backgroundColor: colors.background,
                borderWidth: 1,
                borderColor: addressSuggestions.length > 0 ? colors.primary : colors.border,
                borderRadius: 10,
                padding: 14,
                fontSize: 16,
                color: colors.text,
                minHeight: 48,
              }}
              placeholder="Start typing an address..."
              placeholderTextColor={colors.textSecondary}
              value={addressQuery}
              onChangeText={handleAddressQueryChange}
              autoCorrect={false}
              returnKeyType="search"
            />
            {addressFetching && (
              <View style={{ flexDirection: 'row', alignItems: 'center', paddingVertical: 8, paddingHorizontal: 4 }}>
                <ActivityIndicator color={colors.primary} size="small" />
                <Text style={{ fontSize: 13, color: colors.textSecondary, marginLeft: 8 }}>Searching…</Text>
              </View>
            )}

            {/* Autocomplete suggestions dropdown */}
            {addressSuggestions.length > 0 && (
              <ScrollView style={{ maxHeight: 200, borderWidth: 1, borderColor: colors.border, borderRadius: 10, marginTop: 4, backgroundColor: colors.background }} keyboardShouldPersistTaps="handled">
                {addressSuggestions.map((item) => {
                  const label = item.display_name.split(',').slice(0, 3).join(',').trim();
                  return (
                    <TouchableOpacity
                      key={item.place_id}
                      onPress={() => { saveAddress(label); setAddressQuery(''); setAddressSuggestions([]); }}
                      style={{ padding: 14, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border }}
                      activeOpacity={0.7}
                    >
                      <Text style={{ fontSize: 15, color: colors.text }} numberOfLines={2}>{item.display_name}</Text>
                    </TouchableOpacity>
                  );
                })}
              </ScrollView>
            )}
          </View>
        </KeyboardAvoidingView>
      </Modal>
    <KeyboardDoneBar />
</View>
  );
};

const styles = StyleSheet.create({
  container: { flex: 1 },
  content: { padding: spacing.md, paddingBottom: spacing.xl * 2 },
  pageTitle: { ...typography.h3, marginBottom: spacing.xs },
  pageSubtitle: { fontSize: 15, marginBottom: spacing.md, lineHeight: 18 },
  section: {
    borderRadius: borderRadius.lg,
    padding: spacing.md,
    marginBottom: spacing.xl,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.06,
    shadowRadius: 2,
    elevation: 1 },
  sectionTitle: { fontSize: 18, fontWeight: '700', marginBottom: spacing.sm },

  // Dog multi-select
  dogSelectHint: { fontSize: 15, marginBottom: spacing.sm, fontStyle: 'italic' },
  dogGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  dogCard: { width: '47%', borderRadius: borderRadius.md, overflow: 'hidden', position: 'relative' },
  dogCardPhoto: { width: '100%', height: 110, resizeMode: 'cover' },
  dogCardPhotoPlaceholder: { width: '100%', height: 110, alignItems: 'center', justifyContent: 'center' },
  dogCardPhotoEmoji: { fontSize: 42 },
  dogCardInfo: { padding: spacing.xs + 2 },
  dogCardName: { fontSize: 17, fontWeight: '700', marginBottom: 1 },
  dogCardBreed: { fontSize: 14, marginBottom: 1 },
  dogCardAge: { fontSize: 13 },
  dogCardCheckmark: { position: 'absolute', top: 6, right: 6, width: 26, height: 26, borderRadius: 13, backgroundColor: RED, alignItems: 'center', justifyContent: 'center' },
  dogCardCheckmarkText: { color: '#FFFFFF', fontSize: 16, fontWeight: '800' },
  selectedSummary: { marginTop: spacing.sm, borderRadius: borderRadius.md, borderWidth: 1.5, padding: spacing.sm },
  selectedSummaryText: { fontSize: 16, fontWeight: '700' },
  multiDogHint: {
    fontSize: 15,
    color: '#FF2D55',
    fontWeight: '500',
    marginTop: 6,
    fontStyle: 'italic',
  },
  dogAssignRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginBottom: 12,
  },
  dogAssignPill: {
    paddingHorizontal: 14,
    paddingVertical: 7,
    borderRadius: 20,
    borderWidth: 1.5,
  },
  dogAssignPillText: {
    fontSize: 16,
    fontWeight: '600',
  },
  recBox: {
    marginBottom: 16,
    padding: 14,
    borderRadius: 12,
    backgroundColor: 'rgba(255, 45, 85, 0.06)',
    borderWidth: 1,
    borderColor: 'rgba(255, 45, 85, 0.2)',
  },
  recHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  recLabel: {
    fontSize: 16,
    fontWeight: '500',
  },
  recValue: {
    fontSize: 24,
    fontWeight: '800',
  },
  recSubtext: {
    fontSize: 15,
    marginTop: 4,
  },
  pricingGuideToggle: {
    marginTop: 10,
  },
  pricingGuideToggleText: {
    fontSize: 16,
    fontWeight: '600',
  },
  pricingGuideBody: {
    marginTop: 10,
    padding: 12,
    borderRadius: 10,
    borderWidth: 1,
  },
  guideTitle: {
    fontSize: 17,
    fontWeight: '700',
    marginBottom: 8,
  },
  guideRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 4,
  },
  guideRowLabel: {
    fontSize: 16,
    flex: 1,
  },
  guideRowValue: {
    fontSize: 16,
    fontWeight: '700',
    marginLeft: 8,
  },
  guideRateList: {
    fontSize: 14,
    marginTop: 10,
    lineHeight: 18,
  },
  guideNote: {
    fontSize: 14,
    marginTop: 4,
    lineHeight: 18,
  },
  guideAsterisk: {
    fontSize: 14,
    fontStyle: 'italic',
    marginTop: 8,
    lineHeight: 18,
  },
  selectedSummaryHint: { fontSize: 14, marginTop: 3, fontStyle: 'italic' },
  dogChipsSection: { marginTop: spacing.sm, gap: spacing.sm },
  dogChipGroup: {},
  dogChipGroupLabel: { fontSize: 14, fontWeight: '600', marginBottom: 4 },
  dogChipsRow: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs },
  noDogText: { fontSize: 16, fontStyle: 'italic' },

  // Care type selector
  careTypeHint: { fontSize: 15, marginBottom: spacing.sm, fontStyle: 'italic' },
  careTypeGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  careTypeCard: {
    width: '47%',
    borderRadius: borderRadius.md,
    padding: spacing.md,
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 80,
    position: 'relative' },
  careTypeIcon: { fontSize: 30, marginBottom: 4 },
  careTypeLabel: { fontSize: 15, fontWeight: '600', textAlign: 'center' },
  careTypeCheckmark: { position: 'absolute', top: 6, right: 6, width: 22, height: 22, borderRadius: 11, backgroundColor: RED, alignItems: 'center', justifyContent: 'center' },
  careTypeCheckmarkText: { color: '#FFFFFF', fontSize: 14, fontWeight: '800' },

  // Dates
  dateButton: { borderWidth: 1.5, borderRadius: borderRadius.md, padding: spacing.md, marginBottom: spacing.sm },
  dateButtonLabel: { fontSize: 13, fontWeight: '600', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 2 },
  dateButtonValue: { fontSize: 18, fontWeight: '600' },
  timePickerButton: {
    borderWidth: 1,
    borderRadius: borderRadius.md,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    flex: 1,
  },
  timePickerValue: {
    fontSize: 18,
    fontWeight: '600',
  },
  durationRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.xs,
    marginBottom: spacing.md,
  },
  durationPill: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: borderRadius.md,
    borderWidth: 1,
  },
  durationPillText: {
    fontSize: 16,
    fontWeight: '600',
  },
  rangeHint: { fontSize: 18, fontWeight: '700', textAlign: 'center', marginTop: spacing.sm, marginBottom: 2 },
  rangeHintSub: { fontSize: 16, fontWeight: '500', textAlign: 'center', marginBottom: 4, opacity: 0.85 },
  dateSummary: { padding: spacing.sm, borderRadius: borderRadius.sm, alignItems: 'center', marginTop: spacing.xs },
  dateSummaryRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    padding: spacing.sm,
    borderRadius: borderRadius.sm,
    marginTop: spacing.xs,
  },
  timeConfirmBtn: {
    position: 'absolute',
    right: spacing.sm,
    width: 32,
    height: 32,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
  },
  timeConfirmBtnText: {
    color: '#fff',
    fontSize: 20,
    fontWeight: '700',
  },
  dateSummaryText: { fontSize: 15 },

  // Time fields
  timeRow: { flexDirection: 'row', alignItems: 'flex-end', gap: spacing.sm, marginTop: spacing.sm },
  timeField: { flex: 1 },
  timeFieldLabel: { fontSize: 14, fontWeight: '600', marginBottom: 4 },
  timeInput: { borderWidth: 1, borderRadius: borderRadius.md, padding: spacing.sm, fontSize: 17, fontWeight: '600' },
  timeSeparator: { fontSize: 22, paddingBottom: spacing.sm },

  // Walk duration pills

  // Care details
  careHint: { fontSize: 15, fontStyle: 'italic', lineHeight: 18, marginBottom: spacing.sm },
  carePhotoLabel: { fontSize: 15, marginTop: 12, marginBottom: 8 },
  carePhotoRow: { flexDirection: 'row', marginBottom: 4 },
  carePhotoThumb: { width: 80, height: 80, borderRadius: 10, marginRight: 10, position: 'relative' },
  carePhotoImg: { width: 80, height: 80, borderRadius: 10 },
  carePhotoRemove: { position: 'absolute', top: -6, right: -6, backgroundColor: '#fff', borderRadius: 11 },
  carePhotoAdd: {
    width: 80, height: 80, borderRadius: 10, borderWidth: 1.5, borderStyle: 'dashed',
    justifyContent: 'center', alignItems: 'center',
  },
  carePhotoAddText: { fontSize: 13, marginTop: 2 },
  careInput: { borderWidth: 1, borderRadius: borderRadius.md, padding: spacing.md, fontSize: 16, minHeight: 120, lineHeight: 20 },


  // Compensation
  toggleRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: spacing.sm },
  toggleLabelGroup: { flex: 1, marginRight: spacing.sm },
  toggleLabel: { fontSize: 17, fontWeight: '600' },
  toggleHint: { fontSize: 14, marginTop: 2 },

  // Points input
  pointsInputLabel: { fontSize: 16, fontWeight: '600', marginBottom: spacing.xs },
  pointsInputRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs, marginBottom: spacing.sm },
  pointsInput: { flex: 1, borderWidth: 1.5, borderRadius: borderRadius.md, padding: spacing.sm, fontSize: 22, fontWeight: '700', textAlign: 'center' },
  pointsUnit: { fontSize: 18, fontWeight: '600' },
  pointsBadge: { borderWidth: 1.5, borderRadius: borderRadius.md, padding: spacing.sm, alignItems: 'center', marginTop: spacing.xs },
  pointsBadgeText: { fontSize: 17, fontWeight: '700' },

  // Payment input
  insufficientWarning: { backgroundColor: '#FF2D5520', borderRadius: 8, padding: 10, marginTop: 8, marginBottom: 4 },
  insufficientWarningText: { color: '#FF2D55', fontSize: 15, fontWeight: '600' },
  paymentInputRow: { flexDirection: 'row', alignItems: 'center', marginBottom: spacing.sm, gap: spacing.xs },
  dollarSign: { fontSize: 22, fontWeight: '700' },
  paymentInput: { flex: 1, borderWidth: 1, borderRadius: borderRadius.md, padding: spacing.sm, fontSize: 20, fontWeight: '600' },
  rateUnitLabel: { fontSize: 16, fontWeight: '500', paddingLeft: 2 },
  breakdownBadge: { borderWidth: 1.5, borderRadius: borderRadius.md, padding: spacing.sm, alignItems: 'center', marginBottom: spacing.sm },
  breakdownText: { fontSize: 17, fontWeight: '700' },
  calcHint: { fontSize: 15, fontStyle: 'italic', marginBottom: spacing.sm },
  offAppNote: { borderWidth: 1, borderRadius: borderRadius.md, padding: spacing.sm, marginTop: spacing.xs },
  offAppNoteText: { fontSize: 15, lineHeight: 18, fontWeight: '500' },

  // Submit
  submitBtn: { padding: spacing.md, borderRadius: borderRadius.md, alignItems: 'center', marginTop: spacing.sm },
  submitBtnText: { color: '#fff', ...typography.button },

  // Feeding time picker
  feedingPickerRow: { marginTop: 8 },
  feedingPickerCol: { marginBottom: 12 },
  feedingPickerLabel: { fontSize: 15, fontWeight: '600', marginBottom: 6 },
  feedingScrollContent: { gap: 8, paddingVertical: 4 },
  feedingPickerItem: {
    width: 44,
    height: 44,
    borderRadius: 22,
    borderWidth: 1.5,
    alignItems: 'center',
    justifyContent: 'center',
  },
  feedingPickerItemText: { fontSize: 17 },
  feedingAmPmRow: { flexDirection: 'row', gap: 8 },
  feedingAmPmBtn: {
    paddingHorizontal: 20,
    paddingVertical: 10,
    borderRadius: 12,
    borderWidth: 1.5,
  },
  feedingAmPmText: { fontSize: 17, fontWeight: '600' },
  feedingTimePreview: { fontSize: 20, fontWeight: '700', textAlign: 'center', marginTop: 4 },
  dailyToggle: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginTop: 8,
    paddingVertical: 10,
    paddingHorizontal: 14,
    borderRadius: 10,
    borderWidth: 1.5,
  },
  dailyToggleText: { fontSize: 16, fontWeight: '600' },
  addFeedingBtn: {
    marginTop: 16,
    paddingVertical: 12,
    borderRadius: 10,
    borderWidth: 1.5,
    borderStyle: 'dashed' as const,
    alignItems: 'center',
  },
  locationOption: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 14,
    borderRadius: borderRadius.md,
    gap: 12,
  },
  locationOptionText: {
    fontSize: 17,
  },
  addSessionBtn: {
    borderWidth: 1.5,
    borderStyle: 'dashed',
    borderTopLeftRadius: 0,
    borderTopRightRadius: 0,
    borderBottomLeftRadius: borderRadius.lg,
    borderBottomRightRadius: borderRadius.lg,
    borderTopWidth: 0,
    paddingVertical: 14,
    alignItems: 'center',
    marginTop: 0,
    marginBottom: spacing.lg,
  },
  addFeedingBtnText: { fontSize: 16, fontWeight: '600' },
  fieldHint: { fontSize: 15, marginBottom: 8 },
});

export default CreatePostScreen;
