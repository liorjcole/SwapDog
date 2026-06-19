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
import React, { useEffect, useMemo, useState } from 'react';
import {
  View, Text, TextInput, TouchableOpacity, StyleSheet, ScrollView,
  Alert, Platform, Switch, Image, InputAccessoryView, Keyboard } from 'react-native';
import DateTimePicker, { DateTimePickerEvent } from '@react-native-community/datetimepicker';
import { Calendar, DateData } from 'react-native-calendars';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import * as Haptics from 'expo-haptics';
import { Ionicons } from '@expo/vector-icons';
import * as Location from 'expo-location';
import { RequestsStackParamList } from '../../navigation/types';
import { useAuthContext } from '../../contexts/AuthContext';
import { useTheme } from '../../contexts/ThemeContext';
import { useKeyboardScroll } from '../../hooks/useKeyboardScroll';
import { useDogs } from '../../hooks/useDogs';
import { useSwaps } from '../../hooks/useSwaps';
import { Dog, CompensationType, CareType } from '../../models/types';
import { spacing, borderRadius, typography } from '../../config/theme';
import LoadingSpinner from '../../components/common/LoadingSpinner';
import Chip from '../../components/common/Chip';
import { formatDogAge } from '../../utils/formatDogAge';

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
];

type Props = {
  navigation: NativeStackNavigationProp<RequestsStackParamList, 'Requests'>;
};

const CreatePostScreen: React.FC<Props> = ({ navigation }) => {
  const { colors } = useTheme();
  const { scrollRef: kbScrollRef, onScroll: kbOnScroll, refFor, scrollToInput } = useKeyboardScroll();
  const { user, userProfile } = useAuthContext();
  const { getDogsByOwner } = useDogs();
  const { createPost } = useSwaps();

  const [myDogs, setMyDogs] = useState<Dog[]>([]);
  const [selectedDogIds, setSelectedDogIds] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);

  // Care type
  const [primaryCareType, setPrimaryCareType] = useState<'overnight' | 'daySitting' | null>(null);
  const [addOnCareTypes, setAddOnCareTypes] = useState<Set<CareType>>(new Set());
  // Playtime — multi-session support (max 5 sessions)
  interface PlaySession {
    flexible: boolean;
    startDate: Date;
    endDate: Date;
    showStart: boolean;
    showEnd: boolean;
    durationMins: number;
    repeatDaily: boolean;
    dogIds: string[];
  }
  const makeDefaultPlaySession = (): PlaySession => ({
    flexible: false,
    startDate: (() => { const d = new Date(); d.setHours(10, 0, 0, 0); return d; })(),
    endDate: (() => { const d = new Date(); d.setHours(11, 0, 0, 0); return d; })(),
    showStart: false,
    showEnd: false,
    durationMins: 60,
    repeatDaily: false,
    dogIds: [],
  });
  const [playSessions, setPlaySessions] = useState<PlaySession[]>([makeDefaultPlaySession()]);
  interface WalkSession {
  startDate: Date;
  endDate: Date;
  showStart: boolean;
  showEnd: boolean;
  dogIds: string[];
  repeatDaily: boolean;
}

const makeDefaultWalkSession = (): WalkSession => ({
  startDate: (() => { const d = new Date(); d.setHours(8, 0, 0, 0); return d; })(),
  endDate: (() => { const d = new Date(); d.setHours(9, 0, 0, 0); return d; })(),
  showStart: false,
  showEnd: false,
  dogIds: [],
  repeatDaily: false,
});

const MAX_WALK_SESSIONS = 5;
const MAX_PLAY_SESSIONS = 5;
  const addPlaySession = () => {
    if (playSessions.length >= MAX_PLAY_SESSIONS) return;
    setPlaySessions(prev => [...prev, makeDefaultPlaySession()]);
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
  };
  const removePlaySession = (index: number) => {
    if (playSessions.length <= 1) return;
    setPlaySessions(prev => prev.filter((_, i) => i !== index));
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
  };
  const updatePlaySession = (index: number, updates: Partial<PlaySession>) => {
    setPlaySessions(prev => prev.map((s, i) => i === index ? { ...s, ...updates } : s));
  };
  const [repeatDailyAlertShown, setRepeatDailyAlertShown] = useState(false);
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
  const [feedingSlots, setFeedingSlots] = useState<{ time: Date; daily: boolean; showPicker: boolean; dogIds: string[] }[]>([
    { time: (() => { const d = new Date(); d.setHours(8, 0, 0, 0); return d; })(), daily: false, showPicker: false, dogIds: [] },
  ]);

  const updateFeedingSlot = (index: number, field: string, value: unknown) => {
    setFeedingSlots(prev => prev.map((slot, i) => i === index ? { ...slot, [field]: value } : slot));
  };

  const removeFeedingSlot = (index: number) => {
    if (feedingSlots.length <= 1) return;
    setFeedingSlots(prev => prev.filter((_, i) => i !== index));
  };

  const addFeedingSlot = () => {
    const d = new Date(); d.setHours(12, 0, 0, 0);
    setFeedingSlots(prev => [...prev, { time: d, daily: false, showPicker: false, dogIds: [...selectedDogIds] }]);
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
  };

  // Walk sessions array (multi-walk support)
  const [walkSessions, setWalkSessions] = useState<WalkSession[]>([makeDefaultWalkSession()]);
  const addWalkSession = () => {
    if (walkSessions.length >= MAX_WALK_SESSIONS) return;
    setWalkSessions(prev => [...prev, makeDefaultWalkSession()]);
  };
  const removeWalkSession = (idx: number) => {
    setWalkSessions(prev => prev.filter((_: WalkSession, i: number) => i !== idx));
  };
  const updateWalkSession = (idx: number, updates: Partial<WalkSession>) => {
    setWalkSessions(prev => prev.map((s: WalkSession, i: number) => i === idx ? { ...s, ...updates } : s));
  };

  // Care details
  const [careDetails, setCareDetails] = useState('');
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

  // ── Recommended points calculator ──
  const recommendedPoints = useMemo(() => {
    let total = 0;
    const breakdown: { label: string; pts: number }[] = [];
    const numDogs = selectedDogs.length || 1;
    const dogMultiplier = 1 + (numDogs - 1) * 0.1; // +10% per extra dog

    // Overnight: 4 pts per night
    if (primaryCareType === 'overnight') {
      const nights = dayCount;
      const pts = 4 * nights;
      total += pts;
      breakdown.push({ label: `Overnight (${nights} night${nights > 1 ? 's' : ''})`, pts });
    }

    // Day sitting: 1 pt per hour
    if (primaryCareType === 'daySitting' && daySittingMinutes && daySittingMinutes > 0) {
      const hrs = daySittingMinutes / 60;
      const pts = Math.round(hrs * 10) / 10;
      total += pts;
      breakdown.push({ label: `Day sitting (${hrs.toFixed(1)} hr${hrs !== 1 ? 's' : ''})`, pts });
    }

    // Walk: 1 pt per hour
    if (addOnCareTypes.has('dogWalking') && walkDurationMins > 0) {
      const hrs = walkDurationMins / 60;
      const pts = Math.round(hrs * 10) / 10;
      total += pts;
      breakdown.push({ label: `Walk (${hrs.toFixed(1)} hr${hrs !== 1 ? 's' : ''})`, pts });
    }

    // Feeding: 1 pt per feeding
    if (addOnCareTypes.has('feeding')) {
      const count = feedingSlots.length;
      total += count;
      breakdown.push({ label: `Feeding (${count} time${count > 1 ? 's' : ''})`, pts: count });
    }

    // Playtime: 1 pt per hour (per session)
    if (addOnCareTypes.has('playtime')) {
      let playMins = 0;
      for (const s of playSessions) {
        playMins += s.flexible ? s.durationMins : getPlayDurationMins(s);
      }
      const hrs = playMins / 60;
      const pts = Math.round(hrs * 10) / 10;
      total += pts;
      if (pts > 0) breakdown.push({ label: `Playtime (${hrs.toFixed(1)} hr${hrs !== 1 ? 's' : ''})`, pts });
    }

    // Apply dog multiplier
    const adjusted = Math.ceil(total * dogMultiplier);
    return { total: adjusted, baseTotal: Math.ceil(total), breakdown, dogMultiplier, numDogs };
  }, [primaryCareType, dayCount, daySittingMinutes, addOnCareTypes, walkDurationMins, feedingSlots, playSessions, selectedDogs.length]);

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

  const dogTitleHint = useMemo(() => {
    if (selectedDogs.length === 0) return '';
    if (selectedDogs.length === 1) return `Dog-sitting needed for ${selectedDogs[0].name}`;
    const names = [...selectedDogs.map((d) => d.name)];
    const last = names.pop();
    return `Dog-sitting needed for ${names.join(', ')} & ${last}`;
  }, [selectedDogs]);

  const validateAndSubmit = async () => {
    if (selectedDogs.length === 0) {
      Alert.alert('Required', 'Please select at least one dog'); return;
    }
    if (!primaryCareType && addOnCareTypes.size === 0) {
      Alert.alert('Required', 'Please select at least one type of care.'); return;
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
      Alert.alert('Date has passed', "The date and time you selected has already passed. Please choose a future date.");
      return;
    }

    if (careType === 'overnight' && endDate <= startDate) {
      Alert.alert('Invalid dates', 'End date must be after start date.'); return;
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
    if (careDetails.trim().length < MIN_CARE_DETAILS) {
      Alert.alert('Care Details Required', `Please provide at least ${MIN_CARE_DETAILS} characters`);
      return;
    }
    if (!offerPoints && !offerMoney) {
      Alert.alert('Required', 'Select at least one compensation type (points or money).');
      return;
    }
    if (offerMoney) {
      const amt = parseFloat(paymentAmount);
      if (!amt || amt <= 0) {
        Alert.alert('Invalid Payment', 'Please enter a valid dollar amount'); return;
      }
      if (careType === 'daySitting' && (!daySittingMinutes || daySittingMinutes <= 0)) {
        Alert.alert('Invalid Times', 'End time must be after start time'); return;
      }
    } else {
      const pts = parseInt(pointsOffered, 10);
      if (isNaN(pts) || pts < 1) {
        Alert.alert('Points Required', 'Please enter how many points this job is worth'); return;
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
      const careTypeFields: Record<string, unknown> = { careType: primaryCareType, addOnCareTypes: Array.from(addOnCareTypes) };
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
          repeatDaily: primaryCareType === 'overnight' ? ws.repeatDaily : false,
        }));
        careTypeFields.walkDurationMins = walkDurationMins;
      }
      if (addOnCareTypes.has('feeding')) {
        careTypeFields.feedingSlots = feedingSlots.map(s => ({
          time: formatTime12(s.time),
          daily: primaryCareType === 'overnight' ? s.daily : false,
          dogIds: s.dogIds,
        }));
      }
      if (primaryCareType === 'overnight' || primaryCareType === 'daySitting') {
        careTypeFields.startTime = startTime;
        careTypeFields.endTime = endTime;
      }
      if (addOnCareTypes.has('playtime')) {
        careTypeFields.playSessions = playSessions.map((s, i) => ({
          sessionNumber: i + 1,
          flexible: s.flexible,
          startTime: s.flexible ? null : formatTime12(s.startDate),
          endTime: s.flexible ? null : formatTime12(s.endDate),
          durationMins: s.flexible ? s.durationMins : getPlayDurationMins(s),
          repeatDaily: primaryCareType === 'overnight' ? s.repeatDaily : false,
          dogIds: s.dogIds,
        }));
      }

      // Determine effective start/end date for non-range types
      const effectiveStart = startDate;
      const effectiveEnd = primaryCareType === 'overnight' ? endDate : startDate;

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
        compensationType: (offerPoints && offerMoney ? 'either' : offerMoney ? 'payment' : 'points') as CompensationType,
        pointsCost: offerPoints ? parseInt(pointsOffered, 10) : 0,
        ...paymentFields,
        ...careTypeFields,
        status: 'open' as const };

      const cleanData = Object.fromEntries(
        Object.entries(postData).filter(([, v]) => v !== undefined)
      );

      await createPost(cleanData as unknown as Parameters<typeof createPost>[0]);

      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      Alert.alert('Posted! 🐾', 'Your request is now visible to people in your area.', [
        { text: 'OK', onPress: () => navigation.goBack() },
      ]);
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
        automaticallyAdjustKeyboardInsets={true}
        style={[styles.container, { backgroundColor: colors.background }]}
        contentContainerStyle={styles.content}
        keyboardShouldPersistTaps="handled"
      >
        <Text style={[styles.pageTitle, { color: colors.text }]} accessibilityRole="header">
          Create Post 📋
        </Text>
        <Text style={[styles.pageSubtitle, { color: colors.textSecondary }]}>
          Your post will be visible to WatchDog members in your area.
        </Text>

        {/* ── Section 1: Select Your Dog(s) ── */}
        <View style={[styles.section, { backgroundColor: colors.surface }]}>
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
                      You'll be able to specify which care details apply to each dog below
                    </Text>
                  )}
                </View>
              )}

              {selectedDogs.length > 0 && (
                <View style={styles.dogChipsSection}>
                  {selectedDogs.map((dog) => (
                    <View key={dog.id} style={styles.dogChipGroup}>
                      {selectedDogs.length > 1 && (
                        <Text style={[styles.dogChipGroupLabel, { color: colors.textSecondary }]}>{dog.name}:</Text>
                      )}
                      <View style={styles.dogChipsRow}>
                        <Chip label={formatDogAge(dog.ageYears, dog.ageMonths)} />
                        <Chip label={dog.size.replace('_', ' ')} />
                        <Chip label={dog.sex} />
                        <Chip label={`${dog.energyLevel.replace('_', ' ')} energy`} />
                        {dog.vaccinated !== undefined && (
                          <Chip label={dog.vaccinated ? 'Vaccinated' : 'Not vaccinated'} />
                        )}
                        {dog.isSpayedNeutered !== undefined && (
                          <Chip label={dog.isSpayedNeutered ? '✅ Neutered' : '❌ Not neutered'} selected={!!dog.isSpayedNeutered} />
                        )}
                      </View>
                    </View>
                  ))}
                </View>
              )}
            </>
          )}
        </View>

        {/* ── Section 2: Type of Care ── */}
        <View style={[styles.section, { backgroundColor: colors.surface }]}>
          <Text style={[styles.sectionTitle, { color: colors.text }]}>🐾 Type of Care</Text>

          {/* Primary — must pick one */}
          <Text style={[styles.careTypeHint, { color: colors.textSecondary, marginBottom: 8 }]}>
            What kind of sitting do you need?
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

          {/* Add-ons — tap to toggle */}
          <Text style={[styles.careTypeHint, { color: colors.textSecondary, marginTop: 16, marginBottom: 8 }]}>
            Anything else? (optional)
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
        </View>

        {/* ── Dynamic Sections ── */}

        {/* ── Date/Time section (always shows when any care type selected) ── */}
        {(primaryCareType !== null || addOnCareTypes.size > 0) && (
              <View style={[styles.section, { backgroundColor: colors.surface }]}>
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
                      <Text style={[styles.dateButtonValue, { color: colors.text }]}>{formatDate(startDate)}</Text>
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
                          if (d) setStartDate(d);
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
                      <Text style={[styles.dateButtonValue, { color: colors.text }]}>
                        {endDateSelected ? `${formatDate(startDate)} → ${formatDate(endDate)}` : formatDate(startDate)}
                      </Text>
                    </TouchableOpacity>

                    {showRangeCalendar && (
                      <>
                        <Text style={[styles.rangeHint, { color: '#FF2D55' }]}>
                          {rangeSelectStep === 'start' ? 'Select your start date' : 'Start date selected!'}
                        </Text>
                        {rangeSelectStep === 'end' && (
                          <Text style={[styles.rangeHintSub, { color: '#FF2D55' }]}>
                            Now select your end date
                          </Text>
                        )}
                        <Calendar
                          markingType="period"
                          markedDates={buildMarkedDates()}
                          minDate={new Date().toISOString().split('T')[0]}
                          onDayPress={(day: DateData) => {
                            const selected = new Date(day.dateString + 'T12:00:00');
                            if (rangeSelectStep === 'start') {
                              setStartDate(selected);
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
                {(careType === 'overnight' || careType === 'daySitting') && (
                  <View ref={refFor('startTime')}>
                    <View style={styles.timeRow}>
                      <TouchableOpacity
                        style={[styles.timePickerButton, { borderColor: showStartTime ? colors.primary : colors.border }]}
                        onPress={() => { setShowStartTime(prev => !prev); setShowEndTime(false); }}
                        activeOpacity={0.7}
                      >
                        <Text style={[styles.timeFieldLabel, { color: colors.textSecondary }]}>Start Time</Text>
                        <Text style={[styles.timePickerValue, { color: colors.text }]}>{startTime}</Text>
                      </TouchableOpacity>
                      <Text style={[styles.timeSeparator, { color: colors.textSecondary }]}>→</Text>
                      <TouchableOpacity
                        style={[styles.timePickerButton, { borderColor: showEndTime ? colors.primary : colors.border }]}
                        onPress={() => { setShowEndTime(prev => !prev); setShowStartTime(false); }}
                        activeOpacity={0.7}
                      >
                        <Text style={[styles.timeFieldLabel, { color: colors.textSecondary }]}>End Time</Text>
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

              </View>
            )}

                {/* ── Feeding Time (add-on) ── */}
            {addOnCareTypes.has('feeding') && (
              <View style={[styles.section, { backgroundColor: colors.surface }]}>
                {feedingSlots.map((slot, idx) => (
                  <View key={idx} style={{ marginBottom: idx < feedingSlots.length - 1 ? 20 : 0 }}>
                    <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: collapsedFeedings.has(idx) ? 0 : 6 }}>
                      <TouchableOpacity
                        onPress={() => toggleCollapse(setCollapsedFeedings, idx)}
                        style={{ flexDirection: 'row', alignItems: 'center' }}
                        activeOpacity={0.7}
                      >
                        <Text style={{ color: colors.text, fontSize: 14, fontWeight: '600', marginRight: 6, width: 14 }}>
                          {collapsedFeedings.has(idx) ? '›' : '▾'}
                        </Text>
                        <Text style={[styles.sectionTitle, { color: colors.text, marginBottom: 0, fontSize: 16 }]}>
                          🍽️ {feedingSlots.length > 1 ? `Feeding #${idx + 1}` : 'Feeding'}
                        </Text>
                      </TouchableOpacity>
                      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
                        {primaryCareType === 'overnight' && (
                          <TouchableOpacity
                            style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}
                            onPress={() => updateFeedingSlot(idx, 'daily', !slot.daily)}
                            activeOpacity={0.7}
                          >
                            <Text style={{ fontSize: 15 }}>{slot.daily ? '🔁' : '📅'}</Text>
                            <Text style={{ fontSize: 13, fontWeight: '600', color: colors.primary }}>
                              {slot.daily ? '✓ ' : ''}Repeat daily?
                            </Text>
                          </TouchableOpacity>
                        )}
                        {feedingSlots.length > 1 && (
                          <TouchableOpacity
                            onPress={() => removeFeedingSlot(idx)}
                            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                          >
                            <Text style={{ fontSize: 13, color: colors.error, fontWeight: '600' }}>Remove</Text>
                          </TouchableOpacity>
                        )}
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

                    {/* Add another feeding — inside last card */}
                    {idx === feedingSlots.length - 1 && (
                      <TouchableOpacity
                        style={[styles.addSessionBtn, { borderColor: colors.primary, marginTop: 16 }]}
                        onPress={addFeedingSlot}
                        activeOpacity={0.7}
                      >
                        <Text style={[styles.addFeedingBtnText, { color: colors.primary }]}>
                          ➕ Add Feeding #{feedingSlots.length + 1}
                        </Text>
                      </TouchableOpacity>
                    )}
                    </>
                    )}
                  </View>
                ))}


              </View>
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
                  <View key={wIdx} style={[styles.section, { backgroundColor: colors.surface }]}>
                    <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: collapsedWalks.has(wIdx) ? 0 : 12 }}>
                      <TouchableOpacity
                        onPress={() => toggleCollapse(setCollapsedWalks, wIdx)}
                        style={{ flexDirection: 'row', alignItems: 'center' }}
                        activeOpacity={0.7}
                      >
                        <Text style={{ color: colors.text, fontSize: 14, fontWeight: '600', marginRight: 6, width: 14 }}>
                          {collapsedWalks.has(wIdx) ? '›' : '▾'}
                        </Text>
                        <Text style={[styles.sectionTitle, { color: colors.text, marginBottom: 0 }]}>
                          🐕 Walk #{wIdx + 1}
                        </Text>
                      </TouchableOpacity>
                      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
                        {primaryCareType === 'overnight' && (
                          <TouchableOpacity
                            style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}
                            onPress={() => updateWalkSession(wIdx, { repeatDaily: !ws.repeatDaily })}
                            activeOpacity={0.7}
                          >
                            <Text style={{ fontSize: 15 }}>{ws.repeatDaily ? '🔁' : '📅'}</Text>
                            <Text style={{ fontSize: 13, fontWeight: '600', color: colors.primary }}>
                              {ws.repeatDaily ? '✓ ' : ''}Repeat daily?
                            </Text>
                          </TouchableOpacity>
                        )}
                        {walkSessions.length > 1 && (
                          <TouchableOpacity onPress={() => removeWalkSession(wIdx)} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
                            <Text style={{ color: '#FF3B30', fontSize: 14, fontWeight: '600' }}>Remove</Text>
                          </TouchableOpacity>
                        )}
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

                    {/* Add another walk — inside last card */}
                    {wIdx === walkSessions.length - 1 && walkSessions.length < MAX_WALK_SESSIONS && (
                      <TouchableOpacity
                        style={[styles.addSessionBtn, { borderColor: colors.primary, marginTop: 16 }]}
                        onPress={addWalkSession}
                        activeOpacity={0.7}
                      >
                        <Text style={[styles.addFeedingBtnText, { color: colors.primary }]}>
                          ➕ Add Walk #{walkSessions.length + 1}
                        </Text>
                      </TouchableOpacity>
                    )}
                    </>
                    )}
                  </View>
                  );
                })}


              </>
            )}

        {/* ── Playtime (add-on) — multi-session ── */}
            {addOnCareTypes.has('playtime') && (
              <>
                {playSessions.map((pSession, pIdx) => (
                  <View key={pIdx} style={[styles.section, { backgroundColor: colors.surface }]}>
                    {/* Header row: title + repeat daily + remove */}
                    <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: collapsedPlay.has(pIdx) ? 0 : 12 }}>
                      <TouchableOpacity
                        onPress={() => toggleCollapse(setCollapsedPlay, pIdx)}
                        style={{ flexDirection: 'row', alignItems: 'center' }}
                        activeOpacity={0.7}
                      >
                        <Text style={{ color: colors.text, fontSize: 14, fontWeight: '600', marginRight: 6, width: 14 }}>
                          {collapsedPlay.has(pIdx) ? '›' : '▾'}
                        </Text>
                        <Text style={[styles.sectionTitle, { color: colors.text, marginBottom: 0 }]}>
                          🎾 Playtime Session #{pIdx + 1}
                        </Text>
                      </TouchableOpacity>
                      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
                        {/* Repeat Daily — only for overnight */}
                        {primaryCareType === 'overnight' && (
                          <TouchableOpacity
                            style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}
                            onPress={() => {
                              const newVal = !pSession.repeatDaily;
                              updatePlaySession(pIdx, { repeatDaily: newVal });
                              if (newVal) {
                                Alert.alert(
                                  'Repeat Daily',
                                  'By selecting this, the caretaker will be instructed to repeat this playtime session every day they are watching your dog.',
                                  [{ text: 'Got it' }],
                                );
                              }
                            }}
                            activeOpacity={0.7}
                          >
                            <Text style={{
                              fontSize: 13,
                              fontWeight: '600',
                              color: pSession.repeatDaily ? colors.primary : colors.primary,
                            }}>
                              {pSession.repeatDaily ? '✓ ' : ''}Repeat daily?
                            </Text>
                            {pSession.repeatDaily && (
                              <View style={{
                                width: 6, height: 6, borderRadius: 3,
                                backgroundColor: colors.primary, marginLeft: 2,
                              }} />
                            )}
                          </TouchableOpacity>
                        )}
                        {/* Remove button — only if more than 1 session */}
                        {playSessions.length > 1 && (
                          <TouchableOpacity
                            onPress={() => removePlaySession(pIdx)}
                            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                          >
                            <Text style={{ fontSize: 13, color: colors.error, fontWeight: '600' }}>Remove</Text>
                          </TouchableOpacity>
                        )}
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
                      <Text style={{ fontSize: 15 }}>{pSession.flexible ? '⏱️' : '🕐'}</Text>
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

                    {/* Add another session — inside last card */}
                    {pIdx === playSessions.length - 1 && playSessions.length < MAX_PLAY_SESSIONS && (
                      <TouchableOpacity
                        style={[styles.addSessionBtn, { borderColor: colors.primary, marginTop: 16 }]}
                        onPress={addPlaySession}
                        activeOpacity={0.7}
                      >
                        <Text style={[styles.addFeedingBtnText, { color: colors.primary }]}>
                          ➕ Add Playtime Session #{playSessions.length + 1}
                        </Text>
                      </TouchableOpacity>
                    )}
                    </>
                    )}
                  </View>
                ))}


              </>
            )}

        {/* ── Care Details ── */}
        {(primaryCareType !== null || addOnCareTypes.size > 0) && (
        <View ref={refFor('careDetails')} style={[styles.section, { backgroundColor: colors.surface }]}>
              <Text style={[styles.sectionTitle, { color: colors.text }]}>📋 Care Details</Text>
              <Text style={[styles.careHint, { color: colors.textSecondary }]}>
                Tell potential sitters what they need to know — schedule, feeding, medications, special needs, behavioral notes.
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
                placeholder="e.g. Bella eats twice a day (7am and 6pm). She needs a 30-min walk every morning..."
                placeholderTextColor={colors.textSecondary}
                value={careDetails}
                onChangeText={setCareDetails}
                multiline
                numberOfLines={6}
                textAlignVertical="top"
                accessibilityLabel="Care details for the sitter"
                returnKeyType="done"
                blurOnSubmit={true}
                autoCorrect={true}
                spellCheck={true}
                autoCapitalize="sentences"
                inputAccessoryViewID="careDetailsDone"
                onFocus={() => scrollToInput('careDetails')}
              />
              <Text
                style={[styles.charCount, { color: careDetails.length >= MIN_CARE_DETAILS ? colors.success : colors.textSecondary }]}
              >
                {careDetails.length} chars{careDetails.length < MIN_CARE_DETAILS ? ` (min ${MIN_CARE_DETAILS})` : ' ✓'}
              </Text>
            </View>
        )}

        {/* ── Compensation ── */}
            <View style={[styles.section, { backgroundColor: colors.surface }]}>
              <Text style={[styles.sectionTitle, { color: colors.text }]}>Compensation</Text>

              {/* Recommended points */}
              {recommendedPoints.total > 0 && (
                <View style={styles.recBox}>
                  <Text style={{ fontSize: 14, color: colors.textSecondary, lineHeight: 20 }}>
                    Suggested <Text style={{ fontWeight: '700', color: colors.primary }}>{recommendedPoints.total} pts</Text> based on the care you've selected… but it's ultimately up to you!
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
                    <View style={[styles.pricingGuideBody, { backgroundColor: colors.background, borderColor: colors.border }]}>
                      <Text style={[styles.guideTitle, { color: colors.text }]}>Point Guidelines</Text>
                      <Text style={[styles.guideAsterisk, { color: colors.textSecondary, marginBottom: 8 }]}>
                        *These are standard guidelines — actual value may vary based on holidays, last-minute requests, dogs needing extra attention, or whether a service is part of an overnight/day stay vs. a standalone visit.
                      </Text>
                      {recommendedPoints.breakdown.map((item, i) => (
                        <View key={i} style={styles.guideRow}>
                          <Text style={[styles.guideRowLabel, { color: colors.text }]}>{item.label}</Text>
                          <Text style={[styles.guideRowValue, { color: colors.primary }]}>{item.pts} pt{item.pts !== 1 ? 's' : ''}</Text>
                        </View>
                      ))}
                      {recommendedPoints.numDogs > 1 && (
                        <View style={[styles.guideRow, { borderTopWidth: 0.5, borderTopColor: colors.border, paddingTop: 8, marginTop: 4 }]}>
                          <Text style={[styles.guideRowLabel, { color: colors.text }]}>
                            Multi-dog adjustment ({recommendedPoints.numDogs} dogs, +{((recommendedPoints.numDogs - 1) * 10)}%)
                          </Text>
                          <Text style={[styles.guideRowValue, { color: colors.primary }]}>{recommendedPoints.total} pts</Text>
                        </View>
                      )}

                      {recommendedPoints.numDogs > 1 && (
                        <Text style={[styles.guideNote, { color: colors.textSecondary }]}>
                          Rates increase 10% for each additional dog that needs care.
                        </Text>
                      )}
                    </View>
                  )}
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
                  <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
                    <Text style={[styles.pointsInputLabel, { color: colors.text }]}>
                      How many points is this job worth?
                    </Text>
                    {recommendedPoints.total > 0 && !pointsOffered && (
                      <TouchableOpacity
                        onPress={() => setPointsOffered(String(recommendedPoints.total))}
                        activeOpacity={0.7}
                      >
                        <Text style={{ fontSize: 13, fontWeight: '600', color: colors.primary }}>
                          Use {recommendedPoints.total} pts
                        </Text>
                      </TouchableOpacity>
                    )}
                  </View>
                  <View style={{ height: 12 }} />
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
                            ⚠️ You only have {balance.toFixed(1)} points — need {pts}
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

                  <View style={[styles.offAppNote, { backgroundColor: '#FFF9E6', borderColor: '#F0C040' }]}>
                    <Text style={[styles.offAppNoteText, { color: '#7A6000' }]}>
                      💰 All payments are arranged and made outside of WatchDog. We do not process payments.
                    </Text>
                  </View>
                </>
              )}
            </View>

            {/* ── Submit ── */}
            <TouchableOpacity
              style={[styles.submitBtn, { backgroundColor: colors.primary, opacity: submitting ? 0.7 : 1 }]}
              onPress={validateAndSubmit}
              disabled={submitting || (offerPoints && parseInt(pointsOffered, 10) > 0 && parseInt(pointsOffered, 10) > (userProfile?.points ?? 0))}
              accessibilityLabel={submitting ? 'Posting...' : 'Post Request'}
              accessibilityRole="button"
            >
              <Text style={styles.submitBtnText}>{submitting ? 'Posting...' : 'Post Request 🐾'}</Text>
            </TouchableOpacity>

      </ScrollView>
      {Platform.OS === 'ios' && (
        <InputAccessoryView nativeID="careDetailsDone">
          <View style={styles.keyboardBar}>
            <View style={{ flex: 1 }} />
            <TouchableOpacity
              onPress={() => Keyboard.dismiss()}
              style={styles.keyboardDoneBtn}
              hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
            >
              <Ionicons name="checkmark-circle" size={28} color="#007AFF" />
            </TouchableOpacity>
          </View>
        </InputAccessoryView>
      )}
    </View>
  );
};

const styles = StyleSheet.create({
  container: { flex: 1 },
  content: { padding: spacing.md, paddingBottom: spacing.xl * 2 },
  pageTitle: { ...typography.h3, marginBottom: spacing.xs },
  pageSubtitle: { fontSize: 13, marginBottom: spacing.md, lineHeight: 18 },
  section: {
    borderRadius: borderRadius.lg,
    padding: spacing.md,
    marginBottom: spacing.md,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.06,
    shadowRadius: 2,
    elevation: 1 },
  sectionTitle: { fontSize: 16, fontWeight: '700', marginBottom: spacing.sm },

  // Dog multi-select
  dogSelectHint: { fontSize: 13, marginBottom: spacing.sm, fontStyle: 'italic' },
  dogGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  dogCard: { width: '47%', borderRadius: borderRadius.md, overflow: 'hidden', position: 'relative' },
  dogCardPhoto: { width: '100%', height: 110, resizeMode: 'cover' },
  dogCardPhotoPlaceholder: { width: '100%', height: 110, alignItems: 'center', justifyContent: 'center' },
  dogCardPhotoEmoji: { fontSize: 40 },
  dogCardInfo: { padding: spacing.xs + 2 },
  dogCardName: { fontSize: 15, fontWeight: '700', marginBottom: 1 },
  dogCardBreed: { fontSize: 12, marginBottom: 1 },
  dogCardAge: { fontSize: 11 },
  dogCardCheckmark: { position: 'absolute', top: 6, right: 6, width: 26, height: 26, borderRadius: 13, backgroundColor: RED, alignItems: 'center', justifyContent: 'center' },
  dogCardCheckmarkText: { color: '#FFFFFF', fontSize: 14, fontWeight: '800' },
  selectedSummary: { marginTop: spacing.sm, borderRadius: borderRadius.md, borderWidth: 1.5, padding: spacing.sm },
  selectedSummaryText: { fontSize: 14, fontWeight: '700' },
  multiDogHint: {
    fontSize: 13,
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
    fontSize: 14,
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
    fontSize: 14,
    fontWeight: '500',
  },
  recValue: {
    fontSize: 22,
    fontWeight: '800',
  },
  recSubtext: {
    fontSize: 13,
    marginTop: 4,
  },
  pricingGuideToggle: {
    marginTop: 10,
  },
  pricingGuideToggleText: {
    fontSize: 14,
    fontWeight: '600',
  },
  pricingGuideBody: {
    marginTop: 10,
    padding: 12,
    borderRadius: 10,
    borderWidth: 1,
  },
  guideTitle: {
    fontSize: 15,
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
    fontSize: 14,
    flex: 1,
  },
  guideRowValue: {
    fontSize: 14,
    fontWeight: '700',
    marginLeft: 8,
  },
  guideRateList: {
    fontSize: 12,
    marginTop: 10,
    lineHeight: 18,
  },
  guideNote: {
    fontSize: 12,
    marginTop: 4,
    lineHeight: 18,
  },
  guideAsterisk: {
    fontSize: 12,
    fontStyle: 'italic',
    marginTop: 8,
    lineHeight: 18,
  },
  selectedSummaryHint: { fontSize: 12, marginTop: 3, fontStyle: 'italic' },
  dogChipsSection: { marginTop: spacing.sm, gap: spacing.sm },
  dogChipGroup: {},
  dogChipGroupLabel: { fontSize: 12, fontWeight: '600', marginBottom: 4 },
  dogChipsRow: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs },
  noDogText: { fontSize: 14, fontStyle: 'italic' },

  // Care type selector
  careTypeHint: { fontSize: 13, marginBottom: spacing.sm, fontStyle: 'italic' },
  careTypeGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  careTypeCard: {
    width: '47%',
    borderRadius: borderRadius.md,
    padding: spacing.md,
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 80,
    position: 'relative' },
  careTypeIcon: { fontSize: 28, marginBottom: 4 },
  careTypeLabel: { fontSize: 13, fontWeight: '600', textAlign: 'center' },
  careTypeCheckmark: { position: 'absolute', top: 6, right: 6, width: 22, height: 22, borderRadius: 11, backgroundColor: RED, alignItems: 'center', justifyContent: 'center' },
  careTypeCheckmarkText: { color: '#FFFFFF', fontSize: 12, fontWeight: '800' },

  // Dates
  dateButton: { borderWidth: 1.5, borderRadius: borderRadius.md, padding: spacing.md, marginBottom: spacing.sm },
  dateButtonLabel: { fontSize: 11, fontWeight: '600', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 2 },
  dateButtonValue: { fontSize: 16, fontWeight: '600' },
  timePickerButton: {
    borderWidth: 1,
    borderRadius: borderRadius.md,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    flex: 1,
  },
  timePickerValue: {
    fontSize: 16,
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
    fontSize: 14,
    fontWeight: '600',
  },
  rangeHint: { fontSize: 16, fontWeight: '700', textAlign: 'center', marginTop: spacing.sm, marginBottom: 2 },
  rangeHintSub: { fontSize: 14, fontWeight: '500', textAlign: 'center', marginBottom: 4, opacity: 0.85 },
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
    fontSize: 18,
    fontWeight: '700',
  },
  dateSummaryText: { fontSize: 13 },

  // Time fields
  timeRow: { flexDirection: 'row', alignItems: 'flex-end', gap: spacing.sm, marginTop: spacing.sm },
  timeField: { flex: 1 },
  timeFieldLabel: { fontSize: 12, fontWeight: '600', marginBottom: 4 },
  timeInput: { borderWidth: 1, borderRadius: borderRadius.md, padding: spacing.sm, fontSize: 15, fontWeight: '600' },
  timeSeparator: { fontSize: 20, paddingBottom: spacing.sm },

  // Walk duration pills

  // Care details
  careHint: { fontSize: 13, fontStyle: 'italic', lineHeight: 18, marginBottom: spacing.sm },
  careInput: { borderWidth: 1, borderRadius: borderRadius.md, padding: spacing.md, fontSize: 14, minHeight: 120, lineHeight: 20 },
  charCount: { fontSize: 12, textAlign: 'right', marginTop: spacing.xs },

  // Compensation
  toggleRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: spacing.sm },
  toggleLabelGroup: { flex: 1, marginRight: spacing.sm },
  toggleLabel: { fontSize: 15, fontWeight: '600' },
  toggleHint: { fontSize: 12, marginTop: 2 },

  // Points input
  pointsInputLabel: { fontSize: 14, fontWeight: '600', marginBottom: spacing.xs },
  pointsInputRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs, marginBottom: spacing.sm },
  pointsInput: { flex: 1, borderWidth: 1.5, borderRadius: borderRadius.md, padding: spacing.sm, fontSize: 20, fontWeight: '700', textAlign: 'center' },
  pointsUnit: { fontSize: 16, fontWeight: '600' },
  pointsBadge: { borderWidth: 1.5, borderRadius: borderRadius.md, padding: spacing.sm, alignItems: 'center', marginTop: spacing.xs },
  pointsBadgeText: { fontSize: 15, fontWeight: '700' },

  // Payment input
  insufficientWarning: { backgroundColor: '#FF2D5520', borderRadius: 8, padding: 10, marginTop: 8, marginBottom: 4 },
  insufficientWarningText: { color: '#FF2D55', fontSize: 13, fontWeight: '600' },
  paymentInputRow: { flexDirection: 'row', alignItems: 'center', marginBottom: spacing.sm, gap: spacing.xs },
  dollarSign: { fontSize: 20, fontWeight: '700' },
  paymentInput: { flex: 1, borderWidth: 1, borderRadius: borderRadius.md, padding: spacing.sm, fontSize: 18, fontWeight: '600' },
  rateUnitLabel: { fontSize: 14, fontWeight: '500', paddingLeft: 2 },
  breakdownBadge: { borderWidth: 1.5, borderRadius: borderRadius.md, padding: spacing.sm, alignItems: 'center', marginBottom: spacing.sm },
  breakdownText: { fontSize: 15, fontWeight: '700' },
  calcHint: { fontSize: 13, fontStyle: 'italic', marginBottom: spacing.sm },
  offAppNote: { borderWidth: 1, borderRadius: borderRadius.md, padding: spacing.sm, marginTop: spacing.xs },
  offAppNoteText: { fontSize: 13, lineHeight: 18, fontWeight: '500' },

  // Submit
  submitBtn: { padding: spacing.md, borderRadius: borderRadius.md, alignItems: 'center', marginTop: spacing.sm },
  submitBtnText: { color: '#fff', ...typography.button },
  keyboardBar: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingVertical: 6,
    backgroundColor: '#D1D5DB',
  },
  keyboardDoneBtn: {
    padding: 4,
  },
  // Feeding time picker
  feedingPickerRow: { marginTop: 8 },
  feedingPickerCol: { marginBottom: 12 },
  feedingPickerLabel: { fontSize: 13, fontWeight: '600', marginBottom: 6 },
  feedingScrollContent: { gap: 8, paddingVertical: 4 },
  feedingPickerItem: {
    width: 44,
    height: 44,
    borderRadius: 22,
    borderWidth: 1.5,
    alignItems: 'center',
    justifyContent: 'center',
  },
  feedingPickerItemText: { fontSize: 15 },
  feedingAmPmRow: { flexDirection: 'row', gap: 8 },
  feedingAmPmBtn: {
    paddingHorizontal: 20,
    paddingVertical: 10,
    borderRadius: 12,
    borderWidth: 1.5,
  },
  feedingAmPmText: { fontSize: 15, fontWeight: '600' },
  feedingTimePreview: { fontSize: 18, fontWeight: '700', textAlign: 'center', marginTop: 4 },
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
  dailyToggleText: { fontSize: 14, fontWeight: '600' },
  addFeedingBtn: {
    marginTop: 16,
    paddingVertical: 12,
    borderRadius: 10,
    borderWidth: 1.5,
    borderStyle: 'dashed' as const,
    alignItems: 'center',
  },
  addSessionBtn: {
    borderWidth: 1.5,
    borderStyle: 'dashed',
    borderRadius: borderRadius.md,
    padding: spacing.md,
    alignItems: 'center',
    marginHorizontal: spacing.md,
    marginBottom: spacing.md,
  },
  addFeedingBtnText: { fontSize: 14, fontWeight: '600' },
  fieldHint: { fontSize: 13, marginBottom: 8 },
});

export default CreatePostScreen;
