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

// Walk duration options: 15-min increments up to 3 hours
const WALK_MINUTES = Array.from({ length: 60 }, (_, i) => i + 1);

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
  const { scrollRef: kbScrollRef, registerInputGroup, scrollToInput } = useKeyboardScroll();
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
  const [playtimeDetails, setPlaytimeDetails] = useState('');
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

  // Time fields
  const [startTime, setStartTime] = useState('9:00 AM');
  const [endTime, setEndTime] = useState('5:00 PM');
  const [feedingTime, setFeedingTime] = useState('8:00 AM');

  // Walk duration
  const [walks, setWalks] = useState<number[]>([30]); // array of durations in minutes

  // Care details
  const [careDetails, setCareDetails] = useState('');

  // Compensation
  const [offerPoints, setOfferPoints] = useState(true);
  const [offerMoney, setOfferMoney] = useState(false);
  const [paymentAmount, setPaymentAmount] = useState('');
  // Points offered (set by poster when NOT offering payment)
  const [pointsOffered, setPointsOffered] = useState('');

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

  /** Hours from startTime → endTime for day sitting */
  const daySittingHours = useMemo(() => {
    try {
      const parse = (t: string) => {
        const [timePart, meridiem] = t.trim().split(' ');
        let [h, m] = timePart.split(':').map(Number);
        if (meridiem === 'PM' && h !== 12) h += 12;
        if (meridiem === 'AM' && h === 12) h = 0;
        return h + m / 60;
      };
      const hrs = parse(endTime) - parse(startTime);
      return hrs > 0 ? parseFloat(hrs.toFixed(2)) : undefined;
    } catch {
      return undefined;
    }
  }, [startTime, endTime]);


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

    // For overnight: care starts on startDate (assume check-in at noon if no time)
    // For non-overnight: care starts on startDate at startTime
    const careStart = new Date(startDate);
    if (careType !== 'overnight') {
      const { h, m } = parseTime12(startTime);
      careStart.setHours(h, m, 0, 0);
    } else {
      careStart.setHours(12, 0, 0, 0); // assume noon check-in for overnight
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
      if (careType !== 'overnight' && (!daySittingHours || daySittingHours <= 0)) {
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
        careTypeFields.walks = walks; // array of durations
        careTypeFields.walkCount = walks.length;
      }
      if (addOnCareTypes.has('feeding')) {
        careTypeFields.feedingTime = feedingTime;
      }
      if (primaryCareType !== 'overnight') {
        careTypeFields.startTime = startTime;
        careTypeFields.endTime = endTime;
      }
      if (addOnCareTypes.has('playtime') && playtimeDetails.trim()) {
        careTypeFields.playtimeDetails = playtimeDetails.trim();
      }

      // Determine effective start/end date for non-range types
      const effectiveStart = startDate;
      const effectiveEnd = careType === 'overnight' ? endDate : startDate;

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
                  {selectedDogs.length > 1 && dogTitleHint ? (
                    <Text style={[styles.selectedSummaryHint, { color: colors.textSecondary }]}>
                      "{dogTitleHint}"
                    </Text>
                  ) : null}
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
                  📅 {careType === 'overnight' ? 'Dates Needed' : 'Date & Time'}
                </Text>
                <TouchableOpacity
                  style={[styles.dateButton, { borderColor: '#FFFFFF' }]}
                  onPress={() => setShowStart(true)}
                  accessibilityLabel={`Date: ${formatDate(startDate)}`}
                  accessibilityRole="button"
                >
                  <Text style={[styles.dateButtonLabel, { color: colors.textSecondary }]}>
                    {careType === 'overnight' ? 'From' : 'Date'}
                  </Text>
                  <Text style={[styles.dateButtonValue, { color: colors.text }]}>{formatDate(startDate)}</Text>
                </TouchableOpacity>
                {showStart && (
                  <DateTimePicker
                    value={startDate}
                    mode="date"
                    display={Platform.OS === 'ios' ? 'inline' : 'default'}
                    minimumDate={new Date()}
                    onChange={(_: DateTimePickerEvent, d?: Date) => {
                      setShowStart(Platform.OS === 'ios');
                      if (d) {
                        setStartDate(d);
                        if (d >= endDate) {
                          const newEnd = new Date(d);
                          newEnd.setDate(newEnd.getDate() + 1);
                          setEndDate(newEnd);
                        }
                      }
                      if (Platform.OS !== 'ios') setShowStart(false);
                    }}
                  />
                )}

                {/* End date only for overnight */}
                {careType === 'overnight' && (
                  <>
                    <TouchableOpacity
                      style={[styles.dateButton, { borderColor: '#FFFFFF' }]}
                      onPress={() => setShowEnd(true)}
                      accessibilityLabel={`End date: ${formatDate(endDate)}`}
                      accessibilityRole="button"
                    >
                      <Text style={[styles.dateButtonLabel, { color: colors.textSecondary }]}>To</Text>
                      <Text style={[styles.dateButtonValue, { color: colors.text }]}>{formatDate(endDate)}</Text>
                    </TouchableOpacity>
                    {showEnd && (
                      <DateTimePicker
                        value={endDate}
                        mode="date"
                        display={Platform.OS === 'ios' ? 'inline' : 'default'}
                        minimumDate={startDate}
                        onChange={(_: DateTimePickerEvent, d?: Date) => {
                          if (d) setEndDate(d);
                          if (Platform.OS !== 'ios') setShowEnd(false);
                        }}
                      />
                    )}
                    <View style={[styles.dateSummary, { backgroundColor: colors.background }]}>
                      <Text style={[styles.dateSummaryText, { color: colors.textSecondary }]}>
                        {dayCount} night{dayCount !== 1 ? 's' : ''} of care
                      </Text>
                    </View>
                  </>
                )}

                {/* Time fields for day sitting */}
                {careType !== 'overnight' && (
                  <View style={styles.timeRow}>
                    <View style={styles.timeField}>
                      <Text style={[styles.timeFieldLabel, { color: colors.textSecondary }]}>Start Time</Text>
                      <TextInput
                        style={[styles.timeInput, { borderColor: colors.border, backgroundColor: colors.background, color: colors.text }]}
                        value={startTime}
                        onChangeText={setStartTime}
                        placeholder="9:00 AM"
                        placeholderTextColor={colors.textSecondary}
                        accessibilityLabel="Start time"
                      returnKeyType="done"
                                              />
                    </View>
                    <Text style={[styles.timeSeparator, { color: colors.textSecondary }]}>→</Text>
                    <View style={styles.timeField}>
                      <Text style={[styles.timeFieldLabel, { color: colors.textSecondary }]}>End Time</Text>
                      <TextInput
                        style={[styles.timeInput, { borderColor: colors.border, backgroundColor: colors.background, color: colors.text }]}
                        value={endTime}
                        onChangeText={setEndTime}
                        placeholder="5:00 PM"
                        placeholderTextColor={colors.textSecondary}
                        accessibilityLabel="End time"
                      returnKeyType="done"
                                              />
                    </View>
                  </View>
                )}
                {careType !== 'overnight' && daySittingHours && daySittingHours > 0 && (
                  <View style={[styles.dateSummary, { backgroundColor: colors.background }]}>
                    <Text style={[styles.dateSummaryText, { color: colors.textSecondary }]}>
                      {daySittingHours} hr{daySittingHours !== 1 ? 's' : ''} of sitting
                    </Text>
                  </View>
                )}

              </View>
            )}

        {/* ── Feeding Details (add-on) ── */}
            {addOnCareTypes.has('feeding') && (
              <View style={[styles.section, { backgroundColor: colors.surface }]}>
                <Text style={[styles.sectionTitle, { color: colors.text }]}>🍽️ Feeding Details</Text>
                <View style={styles.timeRow}>
                  <View style={{ flex: 1, backgroundColor: colors.background }}>
                    <Text style={[styles.timeFieldLabel, { color: colors.textSecondary }]}>Feeding Time</Text>
                    <TextInput
                      style={[styles.timeInput, { borderColor: colors.border, backgroundColor: colors.background, color: colors.text }]}
                      value={feedingTime}
                      onChangeText={setFeedingTime}
                      placeholder="8:00 AM"
                      placeholderTextColor={colors.textSecondary}
                      accessibilityLabel="Feeding time"
                      returnKeyType="done"
                    />
                  </View>
                </View>
              </View>
            )}

        {/* ── Walk Details (add-on) ── */}
            {addOnCareTypes.has('dogWalking') && (
              <View style={[styles.section, { backgroundColor: colors.surface }]}>
                <Text style={[styles.sectionTitle, { color: colors.text }]}>🐕 Walk Details</Text>

                {walks.map((dur, idx) => (
                  <View key={idx} style={{ marginBottom: 16 }}>
                    <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
                      <Text style={[styles.careTypeHint, { color: colors.textSecondary }]}>
                        Walk {idx + 1} — duration
                      </Text>
                      {walks.length > 1 && (
                        <TouchableOpacity
                          onPress={() => setWalks(walks.filter((_, i) => i !== idx))}
                          hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                        >
                          <Text style={{ fontSize: 13, color: colors.error, fontWeight: '600' }}>Remove</Text>
                        </TouchableOpacity>
                      )}
                    </View>
                    <ScrollView
                      horizontal
                      showsHorizontalScrollIndicator={false}
                      contentContainerStyle={styles.durationPillsRow}
                    >
                      {WALK_MINUTES.map((min) => {
                        const isSelected = dur === min;
                        return (
                          <TouchableOpacity
                            key={min}
                            style={[
                              styles.durationPill,
                              {
                                backgroundColor: isSelected ? RED : colors.background,
                                borderColor: isSelected ? RED : colors.border },
                            ]}
                            onPress={() => {
                              const updated = [...walks];
                              updated[idx] = min;
                              setWalks(updated);
                              Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                            }}
                            accessibilityLabel={`Walk ${idx + 1}: ${min} minute${min !== 1 ? 's' : ''}`}
                            accessibilityRole="radio"
                            accessibilityState={{ checked: isSelected }}
                          >
                            <Text style={[
                              styles.durationPillText,
                              { color: isSelected ? '#fff' : colors.text },
                            ]}>
                              {min} min
                            </Text>
                          </TouchableOpacity>
                        );
                      })}
                    </ScrollView>
                  </View>
                ))}

                <TouchableOpacity
                  style={[styles.addAnotherWalkBtn, { borderColor: colors.primary }]}
                  onPress={() => {
                    setWalks([...walks, 30]);
                    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                  }}
                >
                  <Text style={[styles.addAnotherWalkBtnText, { color: colors.primary }]}>➕ Add Another Walk</Text>
                </TouchableOpacity>

                <Text style={[styles.fieldHint, { color: colors.textSecondary, marginTop: 12, fontStyle: 'italic' }]}>
                  If there are more details about the walk — like where to find the leash, specific times, or preferred routes — add them to the Care Details section below.
                </Text>
              </View>
            )}

        {/* ── Playtime Details (add-on) ── */}
            {addOnCareTypes.has('playtime') && (
              <View style={[styles.section, { backgroundColor: colors.surface }]}>
                <Text style={[styles.sectionTitle, { color: colors.text }]}>🎾 Playtime Details</Text>
                <Text style={[styles.careTypeHint, { color: colors.textSecondary, marginBottom: 8 }]}>
                  How often and how should they play with your dog?
                </Text>
                <TextInput
                  style={[
                    styles.careInput,
                    { backgroundColor: colors.background, borderColor: colors.border, color: colors.text, minHeight: 80 },
                  ]}
                  placeholder="e.g. Play fetch in the backyard for 20 min twice a day. She loves tug-of-war too..."
                  placeholderTextColor={colors.textSecondary}
                  value={playtimeDetails}
                  onChangeText={setPlaytimeDetails}
                  multiline
                  numberOfLines={3}
                  textAlignVertical="top"
                  maxLength={500}
                  autoCorrect={true}
                  spellCheck={true}
                  autoCapitalize="sentences"
                  returnKeyType="done"
                  blurOnSubmit={true}
                />
              </View>
            )}

        {/* ── Care Details ── */}
        {(primaryCareType !== null || addOnCareTypes.size > 0) && (
        <View style={[styles.section, { backgroundColor: colors.surface }]}>
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
                  <Text style={[styles.pointsInputLabel, { color: colors.text }]}>
                    How many points is this job worth?
                  </Text>
                  <View style={{ height: 12 }} />
                  <View style={styles.pointsInputRow}>
                    <TextInput
                      style={[styles.pointsInput, { borderColor: '#FFFFFF', backgroundColor: colors.background, color: colors.text }]}
                      placeholder="e.g. 5"
                      placeholderTextColor={colors.textSecondary}
                      value={pointsOffered}
                      onChangeText={(t) => setPointsOffered(t.replace(/[^0-9]/g, ''))}
                      keyboardType="number-pad"
                      accessibilityLabel="Points offered"
                    returnKeyType="done"
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
                  <View style={styles.paymentInputRow}>
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
  dateSummary: { padding: spacing.sm, borderRadius: borderRadius.sm, alignItems: 'center', marginTop: spacing.xs },
  dateSummaryText: { fontSize: 13 },

  // Time fields
  timeRow: { flexDirection: 'row', alignItems: 'flex-end', gap: spacing.sm, marginTop: spacing.sm },
  timeField: { flex: 1 },
  timeFieldLabel: { fontSize: 12, fontWeight: '600', marginBottom: 4 },
  timeInput: { borderWidth: 1, borderRadius: borderRadius.md, padding: spacing.sm, fontSize: 15, fontWeight: '600' },
  timeSeparator: { fontSize: 20, paddingBottom: spacing.sm },

  // Walk duration pills
  durationPillsRow: { paddingVertical: spacing.sm, gap: spacing.sm },
  durationPill: { borderWidth: 1.5, borderRadius: borderRadius.full, paddingHorizontal: spacing.md, paddingVertical: 8 },
  durationPillText: { fontSize: 13, fontWeight: '600' },

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
});

export default CreatePostScreen;
