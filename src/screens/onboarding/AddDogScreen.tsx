import React, { useState } from 'react';
import {
  View, Text, TextInput, TouchableOpacity, StyleSheet, ScrollView, Alert, Switch,
  Image, KeyboardAvoidingView, Platform, ActivityIndicator,
} from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import { ref as storageRef, uploadBytes, getDownloadURL } from 'firebase/storage';
import { storage } from '../../config/firebase';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import * as Haptics from 'expo-haptics';
import { OnboardingStackParamList } from '../../navigation/types';
import { useAuthContext } from '../../contexts/AuthContext';
import { useTheme } from '../../contexts/ThemeContext';
import { useDogs } from '../../hooks/useDogs';
import { DogSize, DogSex, EnergyLevel } from '../../models/types';
import { spacing, borderRadius, typography } from '../../config/theme';
import Chip from '../../components/common/Chip';

const MAX_PHOTOS = 10;

type Props = {
  navigation: NativeStackNavigationProp<OnboardingStackParamList, 'AddDog'>;
};

/** Blank form state — returned after each successful dog creation to reset the form */
const blankForm = () => ({
  name: '',
  breed: '',
  ageYears: 0,
  ageMonths: 1,
  size: DogSize.medium,
  sex: DogSex.male,
  energy: EnergyLevel.moderate,
  goodWithDogs: false,
  goodWithKids: false,
  vaccinated: false,
  photoURLs: [] as string[],
});

const AddDogScreen: React.FC<Props> = ({ navigation }) => {
  const { colors } = useTheme();
  const { user } = useAuthContext();
  const { createDog, deleteDog } = useDogs();

  const [form, setForm] = useState(blankForm());
  const [loading, setLoading] = useState(false);
  const [uploadingPhoto, setUploadingPhoto] = useState(false);
  // Track dogs saved this session
  const [savedCount, setSavedCount] = useState(0);
  const [savedDogs, setSavedDogs] = useState<Array<{ name: string; breed: string; photoURL?: string }>>([]);

  const set = <K extends keyof ReturnType<typeof blankForm>>(
    key: K,
    value: ReturnType<typeof blankForm>[K],
  ) => setForm((f) => ({ ...f, [key]: value }));

  const pickPhoto = async () => {
    if (form.photoURLs.length >= MAX_PHOTOS) {
      Alert.alert('Limit reached', `You can add up to ${MAX_PHOTOS} photos`);
      return;
    }
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: 'images',
      allowsMultipleSelection: true,
      allowsEditing: false,
      quality: 0.8,
    });
    if (result.canceled) return;
    setUploadingPhoto(true);
    try {
      const uriList: string[] = [];
      for (const asset of result.assets.slice(0, MAX_PHOTOS - form.photoURLs.length)) {
        const tempId = `temp_${user?.uid ?? 'anon'}_${Date.now()}`;
        const response = await fetch(asset.uri);
        if (!response) throw new Error('Failed to read image file');
        const blob = await response.blob();
        const fileRef = storageRef(storage, `dogs/${tempId}/${Date.now()}_${Math.random().toString(36).slice(2)}.jpg`);
        await uploadBytes(fileRef, blob, { contentType: 'image/jpeg' });
        const downloadURL = await getDownloadURL(fileRef);
        uriList.push(downloadURL);
      }
      set('photoURLs', [...form.photoURLs, ...uriList].slice(0, MAX_PHOTOS));
    } catch {
      Alert.alert('Error', 'Failed to upload photo. Please try again.');
    } finally {
      setUploadingPhoto(false);
    }
  };

  const removePhoto = (index: number) => {
    set('photoURLs', form.photoURLs.filter((_, i) => i !== index));
  };

  const saveDog = async (): Promise<string | null> => {
    if (!form.name.trim() || !form.breed.trim()) {
      Alert.alert('Required', 'Please fill in name and breed');
      return null;
    }
    if (form.ageYears === 0 && form.ageMonths === 0) {
      Alert.alert('Required', 'Please enter your dog\'s age');
      return null;
    }
    if (!user) return null;
    setLoading(true);
    try {
      const dogId = await createDog({
        ownerId: user.uid,
        name: form.name.trim(),
        breed: form.breed.trim(),
        ageYears: form.ageYears,
        ageMonths: form.ageYears === 0 ? form.ageMonths : form.ageMonths,
        size: form.size,
        sex: form.sex,
        energyLevel: form.energy,
        photoURLs: form.photoURLs,
        isGoodWithDogs: form.goodWithDogs,
        isGoodWithKids: form.goodWithKids,
        vaccinated: form.vaccinated,
      });
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      setSavedCount((c) => c + 1);
      return dogId;
    } catch (error: unknown) {
      Alert.alert('Error', error instanceof Error ? error.message : 'Failed to add dog');
      return null;
    } finally {
      setLoading(false);
    }
  };

  const handleContinue = async () => {
    const dogId = await saveDog();
    if (dogId) {
      navigation.navigate('Paywall');
    }
  };

  const handleAddAnother = async () => {
    const dogId = await saveDog();
    if (dogId) {
      // Save the dog info for display
      setSavedDogs((prev) => [...prev, { id: dogId, name: form.name, breed: form.breed, photoURL: form.photoURLs[0] }]);
      // Reset the form to blank so the user can enter another dog
      setForm(blankForm());
    }
  };

  const handleDeleteSavedDog = (dogId: string, dogName: string) => {
    Alert.alert(
      'Remove Dog',
      `Remove ${dogName}?`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Remove',
          style: 'destructive',
          onPress: async () => {
            try {
              await deleteDog(dogId);
              setSavedDogs((prev) => prev.filter((d) => d.id !== dogId));
              setSavedCount((c) => Math.max(0, c - 1));
              Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
            } catch (e: unknown) {
              Alert.alert('Error', e instanceof Error ? e.message : 'Failed to remove dog');
            }
          },
        },
      ],
    );
  };

  const SwitchRow = ({ label, value, onChange }: { label: string; value: boolean; onChange: (v: boolean) => void }) => (
    <View style={[styles.switchRow, { borderBottomColor: colors.border }]}>
      <Text style={[styles.switchLabel, { color: colors.text }]}>{label}</Text>
      <Switch
        value={value}
        onValueChange={onChange}
        trackColor={{ true: colors.primary }}
        accessibilityLabel={label}
        accessibilityRole="switch"
        accessibilityState={{ checked: value }}
      />
    </View>
  );

  return (
    <KeyboardAvoidingView
      style={{ flex: 1 }}
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      keyboardVerticalOffset={Platform.OS === 'ios' ? 90 : 0}
    >
    <ScrollView style={[styles.container, { backgroundColor: colors.background }]} contentContainerStyle={styles.content}>
      <Text style={[styles.title, { color: colors.text }]} accessibilityRole="header">
        {savedCount === 0 ? 'Add your dog' : `Add dog #${savedCount + 1}`}
      </Text>
      <Text style={[styles.sub, { color: colors.textSecondary }]}>
        {savedCount === 0
          ? 'Tell us about your furry friend'
          : `${savedCount} dog${savedCount > 1 ? 's' : ''} added — keep going!`}
      </Text>

      {/* Photo grid */}
      <Text style={[styles.label, { color: colors.text }]}>Photos ({form.photoURLs.length}/{MAX_PHOTOS})</Text>
      <View style={styles.photoGrid}>
        {form.photoURLs.map((uri, index) => (
          <View key={uri + index} style={styles.photoThumb}>
            <Image
              source={{ uri }}
              style={styles.thumbImg}
              accessibilityLabel={index === 0 ? 'Primary photo' : `Photo ${index + 1}`}
            />
            {index === 0 && (
              <View style={[styles.primaryBadge, { backgroundColor: colors.primary }]}>
                <Text style={styles.primaryBadgeText}>Primary</Text>
              </View>
            )}
            <TouchableOpacity
              style={[styles.removeBtn, { backgroundColor: colors.error }]}
              onPress={() => removePhoto(index)}
              accessibilityLabel={`Remove photo ${index + 1}`}
              accessibilityRole="button"
            >
              <Text style={styles.removeBtnText}>✕</Text>
            </TouchableOpacity>
          </View>
        ))}
        {form.photoURLs.length < MAX_PHOTOS && (
          <TouchableOpacity
            style={[styles.addPhotoTile, { backgroundColor: colors.surface, borderColor: colors.border }]}
            onPress={pickPhoto}
            disabled={uploadingPhoto}
            accessibilityLabel={`Add photo. ${MAX_PHOTOS - form.photoURLs.length} remaining`}
            accessibilityRole="button"
          >
            {uploadingPhoto ? (
              <ActivityIndicator color={colors.primary} size="small" />
            ) : (
              <>
                <Text style={[styles.addPhotoIcon, { color: colors.primary }]}>+</Text>
                <Text style={[styles.addPhotoLabel, { color: colors.textSecondary }]}>
                  {form.photoURLs.length}/{MAX_PHOTOS}
                </Text>
              </>
            )}
          </TouchableOpacity>
        )}
      </View>

      <TextInput
        style={[styles.input, { backgroundColor: colors.surface, borderColor: colors.border, color: colors.text }]}
        placeholder="Dog's name"
        placeholderTextColor={colors.textSecondary}
        value={form.name}
        onChangeText={(v) => set('name', v)}
        accessibilityLabel="Dog's name"
          returnKeyType="done"
          
      />
      <TextInput
        style={[styles.input, { backgroundColor: colors.surface, borderColor: colors.border, color: colors.text }]}
        placeholder="Breed"
        placeholderTextColor={colors.textSecondary}
        value={form.breed}
        onChangeText={(v) => set('breed', v)}
        accessibilityLabel="Dog's breed"
          returnKeyType="done"
      />

      {/* Age pickers */}
      <Text style={[styles.label, { color: colors.text }]}>Age</Text>
      <View style={styles.ageRow}>
        <View style={styles.agePicker}>
          <Text style={[styles.agePickerLabel, { color: colors.textSecondary }]}>Years</Text>
          <View style={styles.ageControls}>
            <TouchableOpacity
              style={[styles.ageBtn, { backgroundColor: colors.surface, borderColor: colors.border }]}
              onPress={() => set('ageYears', Math.max(0, form.ageYears - 1))}
              accessibilityLabel="Decrease years"
            >
              <Text style={[styles.ageBtnText, { color: colors.text }]}>−</Text>
            </TouchableOpacity>
            <Text style={[styles.ageValue, { color: colors.text }]}>{form.ageYears}</Text>
            <TouchableOpacity
              style={[styles.ageBtn, { backgroundColor: colors.surface, borderColor: colors.border }]}
              onPress={() => set('ageYears', Math.min(20, form.ageYears + 1))}
              accessibilityLabel="Increase years"
            >
              <Text style={[styles.ageBtnText, { color: colors.text }]}>+</Text>
            </TouchableOpacity>
          </View>
        </View>

        <View style={styles.agePicker}>
          <Text style={[styles.agePickerLabel, { color: colors.textSecondary }]}>
            {form.ageYears === 0 ? 'Months *' : 'Months'}
          </Text>
          <View style={styles.ageControls}>
            <TouchableOpacity
              style={[styles.ageBtn, { backgroundColor: colors.surface, borderColor: colors.border }]}
              onPress={() => set('ageMonths', Math.max(form.ageYears === 0 ? 1 : 0, form.ageMonths - 1))}
              accessibilityLabel="Decrease months"
            >
              <Text style={[styles.ageBtnText, { color: colors.text }]}>−</Text>
            </TouchableOpacity>
            <Text style={[styles.ageValue, { color: colors.text }]}>{form.ageMonths}</Text>
            <TouchableOpacity
              style={[styles.ageBtn, { backgroundColor: colors.surface, borderColor: colors.border }]}
              onPress={() => set('ageMonths', Math.min(11, form.ageMonths + 1))}
              accessibilityLabel="Increase months"
            >
              <Text style={[styles.ageBtnText, { color: colors.text }]}>+</Text>
            </TouchableOpacity>
          </View>
        </View>
      </View>
      {form.ageYears === 0 && (
        <Text style={[styles.ageHint, { color: colors.textSecondary }]}>Months required for puppies under 1 year</Text>
      )}

      <Text style={[styles.label, { color: colors.text }]}>Size</Text>
      <View style={styles.chips}>
        {([DogSize.small, DogSize.medium, DogSize.large, DogSize.extra_large] as DogSize[]).map((s) => (
          <Chip key={s} label={s.replace('_', ' ')} selected={form.size === s} onPress={() => set('size', s)} />
        ))}
      </View>

      <Text style={[styles.label, { color: colors.text }]}>Sex</Text>
      <View style={styles.chips}>
        {([DogSex.male, DogSex.female] as DogSex[]).map((s) => (
          <Chip key={s} label={s} selected={form.sex === s} onPress={() => set('sex', s)} />
        ))}
      </View>

      <Text style={[styles.label, { color: colors.text }]}>Energy Level</Text>
      <View style={styles.chips}>
        {([EnergyLevel.low, EnergyLevel.moderate, EnergyLevel.high, EnergyLevel.very_high] as EnergyLevel[]).map((e) => (
          <Chip key={e} label={e.replace('_', ' ')} selected={form.energy === e} onPress={() => set('energy', e)} />
        ))}
      </View>

      <SwitchRow label="Good with other dogs" value={form.goodWithDogs} onChange={(v) => set('goodWithDogs', v)} />
      <SwitchRow label="Good with kids" value={form.goodWithKids} onChange={(v) => set('goodWithKids', v)} />
      <SwitchRow label="Vaccinated" value={form.vaccinated} onChange={(v) => set('vaccinated', v)} />

      {/* Primary CTA — saves current dog and proceeds to location */}
      <TouchableOpacity
        style={[styles.btn, { backgroundColor: colors.primary, opacity: loading ? 0.7 : 1 }]}
        onPress={handleContinue}
        disabled={loading}
        accessibilityLabel={loading ? 'Saving...' : 'Continue to next step'}
        accessibilityRole="button"
      >
        <Text style={styles.btnText}>{loading ? 'Saving...' : 'Continue →'}</Text>
      </TouchableOpacity>

      {/* Add Another Dog — saves current dog and loops back to blank form */}
      <TouchableOpacity
        style={[styles.addAnotherBtn, { borderColor: colors.primary, opacity: loading ? 0.5 : 1 }]}
        onPress={handleAddAnother}
        disabled={loading}
        accessibilityLabel="Add another dog"
        accessibilityRole="button"
      >
        <Text style={[styles.addAnotherBtnText, { color: colors.primary }]}>➕ Add Another Dog</Text>
      </TouchableOpacity>

      <TouchableOpacity
        onPress={() => navigation.navigate('Paywall')}
        accessibilityLabel="Skip adding a dog"
        accessibilityRole="button"
      >
        <Text style={[styles.skip, { color: colors.textSecondary }]}>Skip for now</Text>
      </TouchableOpacity>
    </ScrollView>
    </KeyboardAvoidingView>
  );
};

const THUMB_SIZE = 80;

const styles = StyleSheet.create({
  container: { flex: 1 },
  content: { flexGrow: 1, padding: spacing.lg, paddingTop: 100 },
  title: { ...typography.h2, textAlign: 'center', marginBottom: spacing.xs },
  sub: { ...typography.body, textAlign: 'center', marginBottom: spacing.xl },
  input: { borderWidth: 1, borderRadius: borderRadius.md, padding: spacing.md, marginBottom: spacing.md, fontSize: 15 },
  label: { fontSize: 15, fontWeight: '600', marginBottom: spacing.sm, marginTop: spacing.sm },
  chips: { flexDirection: 'row', flexWrap: 'wrap', marginBottom: spacing.md },
  switchRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: spacing.sm, borderBottomWidth: 1 },
  switchLabel: { fontSize: 15 },
  btn: { padding: spacing.md, borderRadius: borderRadius.md, alignItems: 'center', marginTop: spacing.lg, marginBottom: spacing.sm },
  btnText: { color: '#fff', ...typography.button },
  addAnotherBtn: {
    borderWidth: 2,
    borderRadius: borderRadius.md,
    padding: spacing.md,
    alignItems: 'center',
    marginBottom: spacing.md,
  },
  addAnotherBtnText: { fontSize: 15, fontWeight: '700' },
  skip: { textAlign: 'center', fontSize: 15, marginBottom: spacing.lg },
  // Photo grid
  photoGrid: { flexDirection: 'row', flexWrap: 'wrap', marginBottom: spacing.md, gap: spacing.xs },
  photoThumb: { width: THUMB_SIZE, height: THUMB_SIZE, borderRadius: borderRadius.sm, overflow: 'visible', marginBottom: spacing.xs },
  thumbImg: { width: THUMB_SIZE, height: THUMB_SIZE, borderRadius: borderRadius.sm },
  primaryBadge: { position: 'absolute', bottom: 2, left: 2, paddingHorizontal: 4, paddingVertical: 1, borderRadius: 4 },
  primaryBadgeText: { color: '#fff', fontSize: 9, fontWeight: '700' },
  removeBtn: { position: 'absolute', top: -6, right: -6, width: 20, height: 20, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
  removeBtnText: { color: '#fff', fontSize: 10, fontWeight: '700' },
  addPhotoTile: { width: THUMB_SIZE, height: THUMB_SIZE, borderRadius: borderRadius.sm, borderWidth: 1.5, borderStyle: 'dashed', alignItems: 'center', justifyContent: 'center' },
  addPhotoIcon: { fontSize: 24, fontWeight: '300', lineHeight: 28 },
  addPhotoLabel: { fontSize: 10 },
  // Age
  ageRow: { flexDirection: 'row', gap: spacing.md, marginBottom: spacing.xs },
  agePicker: { flex: 1 },
  agePickerLabel: { fontSize: 13, marginBottom: spacing.xs },
  ageControls: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  ageBtn: { width: 32, height: 32, borderRadius: borderRadius.sm, borderWidth: 1, alignItems: 'center', justifyContent: 'center' },
  ageBtnText: { fontSize: 18, lineHeight: 22 },
  ageValue: { fontSize: 18, fontWeight: '700', minWidth: 28, textAlign: 'center' },
  ageHint: { fontSize: 12, fontStyle: 'italic', marginBottom: spacing.sm },
  savedDogsSection: { padding: 16, borderRadius: 12, borderWidth: 1, marginBottom: 20 },
  savedDogsTitle: { fontSize: 18, fontWeight: '700', marginBottom: 8 },
  savedDogRow: { flexDirection: 'row', alignItems: 'center', marginBottom: 6 },
  savedDogThumb: { width: 36, height: 36, borderRadius: 18, marginRight: 10 },
  savedDogThumbPlaceholder: { width: 36, height: 36, borderRadius: 18, marginRight: 10, alignItems: 'center', justifyContent: 'center' },
  savedDogName: { fontSize: 15, fontWeight: '500' },
  savedDogDelete: { marginLeft: 'auto', padding: 6 },
  savedDogDeleteText: { fontSize: 16, color: '#FF3B30', fontWeight: '700' },
  savedDogsHint: { fontSize: 13, marginTop: 6, fontStyle: 'italic' },
});

export default AddDogScreen;
