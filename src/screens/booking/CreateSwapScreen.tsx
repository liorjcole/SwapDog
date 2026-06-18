import React, { useEffect, useMemo, useState } from 'react';
import {
  View, Text, TextInput, TouchableOpacity, StyleSheet, ScrollView, Alert, Platform, Switch } from 'react-native';
import DateTimePicker, { DateTimePickerEvent } from '@react-native-community/datetimepicker';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { RouteProp } from '@react-navigation/native';
import * as Haptics from 'expo-haptics';
import { DiscoverStackParamList } from '../../navigation/types';
import { useAuthContext } from '../../contexts/AuthContext';
import { useTheme } from '../../contexts/ThemeContext';
import { useDogs } from '../../hooks/useDogs';
import { useUsers } from '../../hooks/useUsers';
import { useSwaps } from '../../hooks/useSwaps';
import { Dog, User, SwapStatus, PaymentType } from '../../models/types';
import { calculatePoints } from '../../utils/calculatePoints';
import { spacing, borderRadius, typography } from '../../config/theme';
import LoadingSpinner from '../../components/common/LoadingSpinner';
import PhotoCarousel from '../../components/common/PhotoCarousel';
import Chip from '../../components/common/Chip';
import { formatDogAge } from '../../utils/formatDogAge';

const MIN_CARE_DETAILS = 50;

type Props = {
  navigation: NativeStackNavigationProp<DiscoverStackParamList, 'CreateSwap'>;
  route: RouteProp<DiscoverStackParamList, 'CreateSwap'>;
};

const CreateSwapScreen: React.FC<Props> = ({ navigation, route }) => {
  const { colors } = useTheme();
  const { user } = useAuthContext();
  const { getDogsByOwner } = useDogs();
  const { getUser } = useUsers();
  const { createSwap } = useSwaps();

  const [myDogs, setMyDogs] = useState<Dog[]>([]);
  const [receiver, setReceiver] = useState<User | null>(null);
  const [receiverDogs, setReceiverDogs] = useState<Dog[]>([]);
  const [selectedMyDogId, setSelectedMyDogId] = useState<string | null>(null);
  const [selectedReceiverDogs, setSelectedReceiverDogs] = useState<string[]>([]);

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

  // Payment options
  const [offerPayment, setOfferPayment] = useState(false);
  const [paymentAmount, setPaymentAmount] = useState('');

  const [careDetails, setCareDetails] = useState('');
  const [message, setMessage] = useState('');
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);

  const targetUserId = route.params?.userId ?? '';

  useEffect(() => {
    if (!user) return;
    Promise.all([
      getDogsByOwner(user.uid),
      getDogsByOwner(targetUserId),
      getUser(targetUserId),
    ]).then(([mine, theirs, u]) => {
      setMyDogs(mine);
      if (mine.length > 0) setSelectedMyDogId(mine[0].id);
      setReceiverDogs(theirs);
      setReceiver(u);
    }).finally(() => setLoading(false));
  }, [user, targetUserId]);

  const selectedDog = myDogs.find((d) => d.id === selectedMyDogId) ?? null;

  // Auto-calculate points from dates
  const pointsCost = useMemo(
    () => calculatePoints(startDate, endDate),
    [startDate, endDate]
  );

  // Derive payment type
  const paymentType: PaymentType = useMemo(() => {
    if (!offerPayment) return 'points';
    const amt = parseFloat(paymentAmount);
    if (!amt || amt <= 0) return 'points';
    return 'either';
  }, [offerPayment, paymentAmount]);

  const toggleReceiverDog = (id: string) => {
    setSelectedReceiverDogs((prev) =>
      prev.includes(id) ? prev.filter((d) => d !== id) : [...prev, id]
    );
  };

  const handleSubmit = async () => {
    if (!selectedMyDogId) {
      Alert.alert('Required', 'Select your dog for this swap');
      return;
    }
    if (endDate <= startDate) {
      Alert.alert('Invalid dates', 'End date must be after start date');
      return;
    }
    if (careDetails.trim().length < MIN_CARE_DETAILS) {
      Alert.alert('Care Details Required', `Please provide at least ${MIN_CARE_DETAILS} characters of care details`);
      return;
    }
    const paymentAmountNum = offerPayment ? parseFloat(paymentAmount) : undefined;
    if (offerPayment && (!paymentAmountNum || paymentAmountNum <= 0)) {
      Alert.alert('Invalid Payment', 'Please enter a valid dollar amount');
      return;
    }
    if (!user || !receiver) return;
    setSubmitting(true);
    try {
      await createSwap({
        requesterId: user.uid,
        receiverId: receiver.id,
        requesterDogIds: [selectedMyDogId],
        receiverDogIds: selectedReceiverDogs,
        startDate,
        endDate,
        careDetails: careDetails.trim(),
        message: message.trim() || undefined,
        status: SwapStatus.pending,
        pointsCost,
        paymentOffered: paymentAmountNum,
        paymentType });
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      Alert.alert('Sent!', 'Swap request sent successfully', [
        { text: 'OK', onPress: () => navigation.goBack() },
      ]);
    } catch (error: unknown) {
      Alert.alert('Error', error instanceof Error ? error.message : 'Failed to send request');
    } finally {
      setSubmitting(false);
    }
  };

  if (loading) return <LoadingSpinner />;

  const formatDate = (d: Date) =>
    d.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' });

  return (
    <View style={{ flex: 1, backgroundColor: colors.background }}>
    <ScrollView
        automaticallyAdjustKeyboardInsets={true}
      style={[styles.container, { backgroundColor: colors.background }]}
      contentContainerStyle={styles.content}
      keyboardShouldPersistTaps="handled"
    >
      <Text style={[styles.pageTitle, { color: colors.text }]} accessibilityRole="header">
        Request Swap{receiver ? ` with ${receiver.displayName}` : ''}
      </Text>

      {/* ── Section 1: Coverage Dates ── */}
      <View style={[styles.section, { backgroundColor: colors.surface }]}>
        <Text style={[styles.sectionTitle, { color: colors.text }]}>📅 Coverage Dates</Text>

        <TouchableOpacity
          style={[styles.dateButton, { borderColor: colors.primary }]}
          onPress={() => setShowStart(true)}
          accessibilityLabel={`Start date: ${formatDate(startDate)}`}
          accessibilityRole="button"
        >
          <Text style={[styles.dateButtonLabel, { color: colors.textSecondary }]}>Start Date</Text>
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

        <TouchableOpacity
          style={[styles.dateButton, { borderColor: colors.secondary }]}
          onPress={() => setShowEnd(true)}
          accessibilityLabel={`End date: ${formatDate(endDate)}`}
          accessibilityRole="button"
        >
          <Text style={[styles.dateButtonLabel, { color: colors.textSecondary }]}>End Date</Text>
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

        <View style={[styles.dateRange, { backgroundColor: colors.background }]}>
          <Text style={[styles.dateRangeText, { color: colors.textSecondary }]}>
            {Math.max(1, Math.round((endDate.getTime() - startDate.getTime()) / 86400000))} day(s) coverage
          </Text>
        </View>

        {/* Points cost display — auto-calculated */}
        <View style={[styles.pointsCostBadge, { backgroundColor: colors.primary + '18', borderColor: colors.primary }]}>
          <Text style={[styles.pointsCostText, { color: colors.primary }]}>
            🐾 Points Cost: {pointsCost.toFixed(1)} point{pointsCost !== 1 ? 's' : ''}
          </Text>
        </View>
      </View>

      {/* ── Section 2: Payment Option ── */}
      <View style={[styles.section, { backgroundColor: colors.surface }]}>
        <Text style={[styles.sectionTitle, { color: colors.text }]}>💰 Payment Option</Text>
        <View style={styles.toggleRow}>
          <View style={styles.toggleLabelGroup}>
            <Text style={[styles.toggleLabel, { color: colors.text }]}>Also willing to pay instead of points?</Text>
            <Text style={[styles.toggleHint, { color: colors.textSecondary }]}>
              Gives sitters the choice to accept points or cash
            </Text>
          </View>
          <Switch
            value={offerPayment}
            onValueChange={(v) => {
              setOfferPayment(v);
              Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
            }}
            trackColor={{ false: colors.border, true: colors.primary }}
            thumbColor="#fff"
            accessibilityLabel="Toggle payment option"
            accessibilityRole="switch"
            accessibilityState={{ checked: offerPayment }}
          />
        </View>
        {offerPayment && (
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
          </View>
        )}
        <Text style={[styles.paymentTypeSummary, { color: colors.textSecondary }]}>
          {paymentType === 'points' && '🐾 Offering: Points only'}
          {paymentType === 'either' && `🐾💰 Offering: Points or $${paymentAmount} — sitter chooses`}
        </Text>
      </View>

      {/* ── Section 3: Your Dog's Info ── */}
      <View style={[styles.section, { backgroundColor: colors.surface }]}>
        <Text style={[styles.sectionTitle, { color: colors.text }]}>🐶 Your Dog</Text>

        {myDogs.length > 1 && (
          <View style={styles.dogSelector}>
            {myDogs.map((dog) => (
              <TouchableOpacity
                key={dog.id}
                style={[
                  styles.dogSelectorTab,
                  {
                    backgroundColor: selectedMyDogId === dog.id ? colors.primary : colors.background,
                    borderColor: colors.border },
                ]}
                onPress={() => setSelectedMyDogId(dog.id)}
                accessibilityLabel={dog.name}
                accessibilityRole="tab"
                accessibilityState={{ selected: selectedMyDogId === dog.id }}
              >
                <Text style={[styles.dogSelectorTabText, { color: selectedMyDogId === dog.id ? '#fff' : colors.text }]}>
                  {dog.name}
                </Text>
              </TouchableOpacity>
            ))}
          </View>
        )}

        {selectedDog ? (
          <>
            {selectedDog.photoURLs.length > 0 && (
              <View style={styles.carouselWrapper}>
                <PhotoCarousel photos={selectedDog.photoURLs} height={180} />
              </View>
            )}
            <View style={styles.dogInfo}>
              <Text style={[styles.dogInfoName, { color: colors.text }]}>{selectedDog.name}</Text>
              <Text style={[styles.dogInfoBreed, { color: colors.textSecondary }]}>{selectedDog.breed}</Text>
              <View style={styles.dogInfoChips}>
                <Chip label={formatDogAge(selectedDog.ageYears, selectedDog.ageMonths)} />
                <Chip label={selectedDog.size.replace('_', ' ')} />
                <Chip label={selectedDog.sex} />
                <Chip label={`${selectedDog.energyLevel.replace('_', ' ')} energy`} />
                {selectedDog.vaccinated !== undefined && (
                  <Chip label={selectedDog.vaccinated ? 'Vaccinated' : 'Not vaccinated'} />
                )}
                {selectedDog.isSpayedNeutered !== undefined && (
                  <Chip label={selectedDog.isSpayedNeutered ? '✅ Neutered' : '❌ Not neutered'} selected={!!selectedDog.isSpayedNeutered} />
                )}
              </View>
              {selectedDog.temperament && (
                <Text style={[styles.dogInfoTemperament, { color: colors.textSecondary }]}>
                  Temperament: {selectedDog.temperament}
                </Text>
              )}
            </View>
          </>
        ) : (
          <Text style={[styles.noDogText, { color: colors.textSecondary }]}>No dog added yet</Text>
        )}
      </View>

      {/* ── Receiver's dogs (optional) ── */}
      {receiverDogs.length > 0 && (
        <View style={[styles.section, { backgroundColor: colors.surface }]}>
          <Text style={[styles.sectionTitle, { color: colors.text }]}>🐾 Their Dogs (select to watch)</Text>
          {receiverDogs.map((dog) => (
            <TouchableOpacity
              key={dog.id}
              style={[
                styles.dogRow,
                {
                  backgroundColor: colors.background,
                  borderColor: selectedReceiverDogs.includes(dog.id) ? colors.secondary : colors.border },
              ]}
              onPress={() => toggleReceiverDog(dog.id)}
              accessibilityLabel={dog.name}
              accessibilityRole="checkbox"
              accessibilityState={{ checked: selectedReceiverDogs.includes(dog.id) }}
            >
              <Text style={[styles.checkMark, { color: selectedReceiverDogs.includes(dog.id) ? colors.secondary : colors.textSecondary }]}>
                {selectedReceiverDogs.includes(dog.id) ? '☑' : '☐'}
              </Text>
              <View>
                <Text style={[styles.dogRowName, { color: colors.text }]}>{dog.name}</Text>
                <Text style={[styles.dogRowBreed, { color: colors.textSecondary }]}>
                  {dog.breed} • {formatDogAge(dog.ageYears, dog.ageMonths)}
                </Text>
              </View>
            </TouchableOpacity>
          ))}
        </View>
      )}

      {/* ── Section 4: Care Details ── */}
      <View style={[styles.section, { backgroundColor: colors.surface }]}>
        <Text style={[styles.sectionTitle, { color: colors.text }]}>📋 Care Details</Text>
        <Text style={[styles.careHint, { color: colors.textSecondary }]}>
          Describe what the dog watcher needs to know — daily schedule, exercise requirements,
          food/feeding schedule, medications, special needs, behavioral notes
        </Text>
        <TextInput
          style={[
            styles.careInput,
            {
              backgroundColor: colors.background,
              borderColor: careDetails.trim().length > 0 && careDetails.trim().length < MIN_CARE_DETAILS
                ? colors.error
                : colors.border,
              color: colors.text },
          ]}
          placeholder="e.g. Bella eats twice a day (7am and 6pm). She needs a 30-min walk every morning. Takes allergy medication in food..."
          placeholderTextColor={colors.textSecondary}
          value={careDetails}
          onChangeText={setCareDetails}
          multiline
          numberOfLines={6}
          textAlignVertical="top"
          accessibilityLabel="Care details for the dog watcher"
        returnKeyType="done"
                  />
        <Text style={[
          styles.charCount,
          {
            color: careDetails.length >= MIN_CARE_DETAILS ? colors.success : colors.textSecondary },
        ]}>
          {careDetails.length} chars{careDetails.length < MIN_CARE_DETAILS ? ` (min ${MIN_CARE_DETAILS})` : ' ✓'}
        </Text>
      </View>

      {/* ── Section 5: Optional message ── */}
      <View style={[styles.section, { backgroundColor: colors.surface }]}>
        <Text style={[styles.sectionTitle, { color: colors.text }]}>💬 Message (optional)</Text>
        <TextInput
          style={[styles.messageInput, { backgroundColor: colors.background, borderColor: colors.border, color: colors.text }]}
          placeholder="Say hi or add a personal note..."
          placeholderTextColor={colors.textSecondary}
          value={message}
          onChangeText={setMessage}
          multiline
          numberOfLines={3}
          textAlignVertical="top"
          accessibilityLabel="Optional message to the other user"
        returnKeyType="done"
                  blurOnSubmit={true}
                  />
      </View>

      <TouchableOpacity
        style={[styles.submitBtn, { backgroundColor: colors.primary, opacity: submitting ? 0.7 : 1 }]}
        onPress={handleSubmit}
        disabled={submitting}
        accessibilityLabel={submitting ? 'Sending request...' : 'Send swap request'}
        accessibilityRole="button"
      >
        <Text style={styles.submitBtnText}>{submitting ? 'Sending...' : 'Send Swap Request 🔄'}</Text>
      </TouchableOpacity>
    </ScrollView>
  </View>
  );
};

const styles = StyleSheet.create({
  container: { flex: 1 },
  content: { padding: spacing.md, paddingBottom: spacing.xl * 2 },
  pageTitle: { ...typography.h3, marginBottom: spacing.md },
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
  // Dates
  dateButton: {
    borderWidth: 1.5,
    borderRadius: borderRadius.md,
    padding: spacing.md,
    marginBottom: spacing.sm },
  dateButtonLabel: { fontSize: 11, fontWeight: '600', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 2 },
  dateButtonValue: { fontSize: 16, fontWeight: '600' },
  dateRange: { padding: spacing.sm, borderRadius: borderRadius.sm, alignItems: 'center', marginTop: spacing.xs },
  dateRangeText: { fontSize: 13 },
  // Points cost
  pointsCostBadge: {
    borderWidth: 1.5,
    borderRadius: borderRadius.md,
    padding: spacing.sm,
    alignItems: 'center',
    marginTop: spacing.sm },
  pointsCostText: { fontSize: 16, fontWeight: '700' },
  // Payment option
  toggleRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: spacing.sm },
  toggleLabelGroup: { flex: 1, marginRight: spacing.sm },
  toggleLabel: { fontSize: 15, fontWeight: '600' },
  toggleHint: { fontSize: 12, marginTop: 2 },
  paymentInputRow: { flexDirection: 'row', alignItems: 'center', marginBottom: spacing.sm, gap: spacing.xs },
  dollarSign: { fontSize: 20, fontWeight: '700' },
  paymentInput: {
    flex: 1,
    borderWidth: 1,
    borderRadius: borderRadius.md,
    padding: spacing.sm,
    fontSize: 18,
    fontWeight: '600' },
  paymentTypeSummary: { fontSize: 13, fontStyle: 'italic' },
  // Dog selector
  dogSelector: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs, marginBottom: spacing.sm },
  dogSelectorTab: { paddingHorizontal: spacing.sm, paddingVertical: spacing.xs, borderRadius: borderRadius.full, borderWidth: 1 },
  dogSelectorTabText: { fontSize: 14, fontWeight: '600' },
  // Dog info
  carouselWrapper: { borderRadius: borderRadius.md, overflow: 'hidden', marginBottom: spacing.sm },
  dogInfo: { paddingTop: spacing.xs },
  dogInfoName: { fontSize: 18, fontWeight: '700', marginBottom: 2 },
  dogInfoBreed: { fontSize: 14, marginBottom: spacing.sm },
  dogInfoChips: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs, marginBottom: spacing.xs },
  dogInfoTemperament: { fontSize: 13, fontStyle: 'italic', marginTop: spacing.xs },
  noDogText: { fontSize: 14, fontStyle: 'italic' },
  // Receiver dogs
  dogRow: { flexDirection: 'row', alignItems: 'center', borderWidth: 1.5, borderRadius: borderRadius.sm, padding: spacing.sm, marginBottom: spacing.xs, gap: spacing.sm },
  checkMark: { fontSize: 20 },
  dogRowName: { fontSize: 15, fontWeight: '600' },
  dogRowBreed: { fontSize: 13 },
  // Care details
  careHint: { fontSize: 13, fontStyle: 'italic', lineHeight: 18, marginBottom: spacing.sm },
  careInput: { borderWidth: 1, borderRadius: borderRadius.md, padding: spacing.md, fontSize: 14, minHeight: 120, lineHeight: 20 },
  charCount: { fontSize: 12, textAlign: 'right', marginTop: spacing.xs },
  // Message
  messageInput: { borderWidth: 1, borderRadius: borderRadius.md, padding: spacing.md, fontSize: 14, minHeight: 80 },
  // Submit
  submitBtn: { padding: spacing.md, borderRadius: borderRadius.md, alignItems: 'center', marginTop: spacing.sm },
  submitBtnText: { color: '#fff', ...typography.button } });

export default CreateSwapScreen;
