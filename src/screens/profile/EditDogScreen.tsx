import React, { useEffect, useState } from 'react';
import {
  View, Text, TextInput, TouchableOpacity, StyleSheet, ScrollView, Alert, Image, Platform, ActivityIndicator, Dimensions, Modal, Switch, LayoutAnimation } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { RouteProp } from '@react-navigation/native';
import * as Haptics from 'expo-haptics';
import * as ImagePicker from 'expo-image-picker';
import { ref as storageRef, uploadBytes, getDownloadURL } from 'firebase/storage';
import { storage } from '../../config/firebase';
import { ProfileStackParamList } from '../../navigation/types';
import { useTheme } from '../../contexts/ThemeContext';
import CharCountHint from '../../components/common/CharCountHint';
import { useKeyboardScroll } from '../../hooks/useKeyboardScroll';
import { useAuthContext } from '../../contexts/AuthContext';
import { useDogs } from '../../hooks/useDogs';
import { Dog, DogSex, EnergyLevel } from '../../models/types';
import { spacing, borderRadius, typography } from '../../config/theme';
import LoadingSpinner from '../../components/common/LoadingSpinner';
import Chip from '../../components/common/Chip';
import KeyboardDoneBar, { DONE_ACCESSORY_ID } from '../../components/common/KeyboardDoneBar';

type Props = {
  navigation: NativeStackNavigationProp<ProfileStackParamList, 'EditDog'>;
  route: RouteProp<ProfileStackParamList, 'EditDog'>;
};

const EditDogScreen: React.FC<Props> = ({ navigation, route }) => {
  const { colors } = useTheme();
  const { scrollRef, onScroll, onLayout, onContentSizeChange, refFor, scrollToInput } = useKeyboardScroll();
  const insets = useSafeAreaInsets();
  const { user } = useAuthContext();
  const { getDog, updateDog, createDog, deleteDog } = useDogs();

  // If no dogId → create mode
  const dogId = route.params?.dogId;
  const isCreateMode = !dogId;
  // When opened from ProfileScreen's dog card, photos are already handled above — hide them here.
  const hidePhotos = route.params?.hidePhotos ?? false;

  const [dog, setDog] = useState<Dog | null>(null);
  const [name, setName] = useState('');
  const [breed, setBreed] = useState('');
  const [ageYears, setAgeYears] = useState(0);
  const [ageMonths, setAgeMonths] = useState(1);
  const [sex, setSex] = useState<DogSex>(DogSex.male);
  const [energy, setEnergy] = useState<EnergyLevel>(EnergyLevel.moderate);
  const [photoURLs, setPhotoURLs] = useState<string[]>([]);
  const [loading, setLoading] = useState(!isCreateMode);
  const [saving, setSaving] = useState(false);
  const [uploadingPhoto, setUploadingPhoto] = useState(false);
  const [previewIndex, setPreviewIndex] = useState<number | null>(null);
  const [weightLbs, setWeightLbs] = useState(0);
  const [goodWithDogs, setGoodWithDogs] = useState(true);
  const [goodWithKids, setGoodWithKids] = useState(true);
  const [vaccinated, setVaccinated] = useState(false);
  const [pottyTrained, setPottyTrained] = useState(false);
  const [dogBio, setDogBio] = useState('');
  const [showRefChart, setShowRefChart] = useState(false);

  useEffect(() => {
    if (isCreateMode) return; // skip fetching in create mode
    getDog(dogId).then((d) => {
      if (d) {
        setDog(d);
        setName(d.name);
        setBreed(d.breed);
        setAgeYears(d.ageYears);
        setAgeMonths(d.ageMonths);
        setSex(d.sex);
        setEnergy(d.energyLevel);
        setPhotoURLs(d.photoURLs);
        if (d.isGoodWithDogs !== undefined) setGoodWithDogs(d.isGoodWithDogs);
        if (d.isGoodWithKids !== undefined) setGoodWithKids(d.isGoodWithKids);
        if (d.vaccinated !== undefined) setVaccinated(d.vaccinated);
        if (d.pottyTrained !== undefined) setPottyTrained(d.pottyTrained);
        if ((d as any).bio) setDogBio((d as any).bio);
        setWeightLbs(d.weightLbs ?? 0);
      }
      setLoading(false);
    });
  }, [dogId]);

  const handleAddPhoto = async () => {
    const remaining = 10 - photoURLs.length;
    if (remaining <= 0) {
      Alert.alert('Limit reached', 'You can add up to 10 photos per dog');
      return;
    }

    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: 'images',
      allowsMultipleSelection: true,
      selectionLimit: remaining,
      quality: 0.8,
    });
    if (result.canceled || !result.assets?.length) return;

    const localUris = result.assets.map((a) => a.uri).slice(0, remaining);

    // Phase 2: Show local thumbnails immediately, upload in background
    setPhotoURLs((prev) => [...prev, ...localUris].slice(0, 10));
    setUploadingPhoto(true);

    const newURLs: string[] = [];
    for (const uri of localUris) {
      try {
        const tempId = dogId ?? `temp_${user?.uid ?? 'anon'}_${Date.now()}`;
        const response = await fetch(uri);
        if (!response) throw new Error('Failed to read image file');
        const blob = await response.blob();
        const fileRef = storageRef(storage, `dogs/${tempId}/${Date.now()}_${Math.random().toString(36).slice(2)}.jpg`);
        await uploadBytes(fileRef, blob, { contentType: 'image/jpeg' });
        const downloadURL = await getDownloadURL(fileRef);
        newURLs.push(downloadURL);
      } catch {
        Alert.alert('Error', 'One photo failed to upload. You can try adding it again.');
      }
    }

    // Replace local URIs with real download URLs
    setPhotoURLs((prev) => {
      const existing = prev.filter((u) => !localUris.includes(u));
      return [...existing, ...newURLs].slice(0, 10);
    });
    setUploadingPhoto(false);

    if (photoURLs.length + newURLs.length >= 10) {
      Alert.alert('All set!', "You've added 10 photos.");
    }
  };

  const handleRemovePhoto = (index: number) => {
    if (photoURLs.length <= 1) {
      Alert.alert(
        'Minimum 1 Photo Required 📸',
        'Each dog needs at least one photo. Add another photo before removing this one.',
      );
      return;
    }
    Alert.alert(
      'Remove Photo?',
      index === 0
        ? 'This is the primary photo. The next photo will become the new primary.'
        : 'Are you sure you want to remove this photo?',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Remove',
          style: 'destructive',
          onPress: () => {
            setPhotoURLs((prev) => prev.filter((_, i) => i !== index));
          },
        },
      ],
    );
  };

  const handleCropPhoto = async (index: number) => {
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: 'images',
      allowsEditing: true,
      aspect: [1, 1],
      quality: 0.8,
    });
    if (result.canceled || !result.assets?.length) return;

    const uri = result.assets[0].uri;
    // Show local preview immediately
    setPhotoURLs((prev) => {
      const updated = [...prev];
      updated[index] = uri;
      return updated;
    });

    // Upload in background
    setUploadingPhoto(true);
    try {
      const tempId = dogId ?? `temp_${user?.uid ?? 'anon'}_${Date.now()}`;
      const response = await fetch(uri);
      if (!response) throw new Error('Failed to read image file');
      const blob = await response.blob();
      const fileRef = storageRef(storage, `dogs/${tempId}/${Date.now()}_${Math.random().toString(36).slice(2)}.jpg`);
      await uploadBytes(fileRef, blob, { contentType: 'image/jpeg' });
      const downloadURL = await getDownloadURL(fileRef);
      setPhotoURLs((prev) => {
        const updated = [...prev];
        // Replace the local URI with the real download URL
        const localIdx = updated.indexOf(uri);
        if (localIdx !== -1) updated[localIdx] = downloadURL;
        return updated;
      });
    } catch {
      Alert.alert('Error', 'Photo failed to upload. Try again.');
    }
    setUploadingPhoto(false);
  };

    const handleSave = async () => {
    if (!name.trim()) { Alert.alert('Required', 'Dog name is required'); return; }
    if (!breed.trim()) { Alert.alert('Required', 'Breed is required'); return; }
    if (!user) return;
    setSaving(true);
    try {
      if (isCreateMode) {
        if (!weightLbs || weightLbs <= 0) {
          Alert.alert('Required', "Please enter your dog's weight");
          setSaving(false);
          return;
        }
        if (dogBio.trim().length < 20) {
          Alert.alert('Required', 'Please write at least 20 characters about your dog');
          setSaving(false);
          return;
        }
        await createDog({
          ownerId: user.uid,
          name: name.trim(),
          breed: breed.trim(),
          ageYears,
          ageMonths,
          weightLbs,
          sex,
          energyLevel: energy,
          photoURLs,
          isGoodWithDogs: goodWithDogs,
          isGoodWithKids: goodWithKids,
          vaccinated,
          pottyTrained,
          ...(dogBio.trim() ? { bio: dogBio.trim() } : {}) });
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
        navigation.goBack();
      } else {
        await updateDog(dogId, {
          name: name.trim(),
          breed: breed.trim(),
          ageYears,
          ageMonths,
          weightLbs,
          sex,
          energyLevel: energy,
          photoURLs,
          isGoodWithDogs: goodWithDogs,
          isGoodWithKids: goodWithKids,
          vaccinated,
          pottyTrained,
          ...(dogBio.trim() ? { bio: dogBio.trim() } : {}) });
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
        navigation.goBack();
      }
    } catch (error: unknown) {
      Alert.alert('Error', error instanceof Error ? error.message : 'Failed to save');
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = () => {
    if (!dogId) return;
    Alert.alert('Delete Dog', `Remove ${dog?.name}?`, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete', style: 'destructive',
        onPress: async () => {
          await deleteDog(dogId);
          navigation.goBack();
        } },
    ]);
  };

  if (loading) return <LoadingSpinner />;

  return (
    <>
    <View style={{ flex: 1, backgroundColor: colors.background }}>
    <ScrollView
        ref={scrollRef}
        onScroll={onScroll}
        onLayout={onLayout}
        onContentSizeChange={onContentSizeChange}
        scrollEventThrottle={16}
        automaticallyAdjustKeyboardInsets={false}
        keyboardShouldPersistTaps="handled"
        style={[styles.container, { backgroundColor: colors.background }]} contentContainerStyle={styles.content}>

      {isCreateMode && (
        <Text style={[styles.createTitle, { color: colors.text }]}>Add a New Dog 🐶</Text>
      )}

      {/* Photo gallery — hidden when opened from ProfileScreen (photos handled above) */}
      {!hidePhotos && (<>
      <Text style={[styles.label, { color: colors.text }]}>Photos ({photoURLs.length}/10)</Text>
      <View style={styles.photoGrid}>
        {photoURLs.map((uri, index) => (
          <View key={uri + index} style={styles.photoThumbWrap}>
            <View style={styles.photoThumb}>
              <Image
                source={{ uri }}
                style={styles.thumbImg}
              />
              {index === 0 && (
                <View style={[styles.primaryBadge, { backgroundColor: colors.primary }]}>
                  <Text style={styles.primaryBadgeText}>Primary</Text>
                </View>
              )}
            </View>
            <TouchableOpacity
              style={[styles.removePhotoBtn, { backgroundColor: colors.error }]}
              onPress={() => handleRemovePhoto(index)}
              hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}
              accessibilityLabel="Remove photo"
              accessibilityRole="button"
            >
              <Text style={styles.removePhotoBtnText}>✕</Text>
            </TouchableOpacity>
          </View>
        ))}
        {photoURLs.length < 10 && (
          <TouchableOpacity
            style={[styles.addPhotoTile, { borderColor: colors.border, backgroundColor: colors.surface }]}
            onPress={handleAddPhoto}
            disabled={uploadingPhoto}
            accessibilityLabel="Add photo"
            accessibilityRole="button"
          >
            {uploadingPhoto ? (
              <ActivityIndicator color={colors.primary} size="small" />
            ) : (
              <Text style={[styles.addPhotoIcon, { color: colors.primary }]}>+</Text>
            )}
          </TouchableOpacity>
        )}
      </View>
      </>)}

      <View ref={refFor('name')}>
        <TextInput
          style={[styles.input, { backgroundColor: colors.surface, borderColor: colors.border, color: colors.text }]}
          value={name}
          onChangeText={setName}
          placeholder="Dog name"
          placeholderTextColor={colors.textSecondary}
          accessibilityLabel="Dog name"
          returnKeyType="next"
          blurOnSubmit={false}
          onFocus={() => scrollToInput('name')}
        />
      </View>
      <View ref={refFor('breed')}>
        <TextInput
          style={[styles.input, { backgroundColor: colors.surface, borderColor: colors.border, color: colors.text }]}
          value={breed}
          onChangeText={setBreed}
          placeholder="Breed"
          placeholderTextColor={colors.textSecondary}
          accessibilityLabel="Dog breed"
          returnKeyType="done"
          onFocus={() => scrollToInput('breed')}
        />
      </View>

      {/* Age pickers */}
      <Text style={[styles.label, { color: colors.text }]}>Age</Text>
      <View style={styles.ageRow}>
        <View style={styles.agePicker}>
          <Text style={[styles.agePickerLabel, { color: colors.textSecondary }]}>Years</Text>
          <View style={styles.ageControls}>
            <TouchableOpacity
              style={[styles.ageBtn, { backgroundColor: colors.surface, borderColor: colors.border }]}
              onPress={() => setAgeYears((y) => Math.max(0, y - 1))}
              accessibilityLabel="Decrease years"
            >
              <Text style={[styles.ageBtnText, { color: colors.text }]}>−</Text>
            </TouchableOpacity>
            <Text style={[styles.ageValue, { color: colors.text }]}>{ageYears}</Text>
            <TouchableOpacity
              style={[styles.ageBtn, { backgroundColor: colors.surface, borderColor: colors.border }]}
              onPress={() => setAgeYears((y) => Math.min(20, y + 1))}
              accessibilityLabel="Increase years"
            >
              <Text style={[styles.ageBtnText, { color: colors.text }]}>+</Text>
            </TouchableOpacity>
          </View>
        </View>

        <View style={styles.agePicker}>
          <Text style={[styles.agePickerLabel, { color: colors.textSecondary }]}>
            {ageYears === 0 ? 'Months *' : 'Months'}
          </Text>
          <View style={styles.ageControls}>
            <TouchableOpacity
              style={[styles.ageBtn, { backgroundColor: colors.surface, borderColor: colors.border }]}
              onPress={() => setAgeMonths((m) => Math.max(ageYears === 0 ? 1 : 0, m - 1))}
              accessibilityLabel="Decrease months"
            >
              <Text style={[styles.ageBtnText, { color: colors.text }]}>−</Text>
            </TouchableOpacity>
            <Text style={[styles.ageValue, { color: colors.text }]}>{ageMonths}</Text>
            <TouchableOpacity
              style={[styles.ageBtn, { backgroundColor: colors.surface, borderColor: colors.border }]}
              onPress={() => setAgeMonths((m) => Math.min(11, m + 1))}
              accessibilityLabel="Increase months"
            >
              <Text style={[styles.ageBtnText, { color: colors.text }]}>+</Text>
            </TouchableOpacity>
          </View>
        </View>
      </View>

      <View ref={refFor('weight')}>
        <Text style={[styles.label, { color: colors.text }]}>Weight (lbs)</Text>
        <TextInput
          style={[styles.input, { backgroundColor: colors.surface, borderColor: colors.border, color: colors.text }]}
          placeholder="Estimated weight in pounds"
          placeholderTextColor={colors.textSecondary}
          value={weightLbs > 0 ? String(weightLbs) : ''}
          onChangeText={(v) => {
            const num = parseInt(v.replace(/[^0-9]/g, ''), 10);
            setWeightLbs(isNaN(num) ? 0 : num);
          }}
          keyboardType="number-pad"
          returnKeyType="done"
          onFocus={() => scrollToInput('weight')}
        />
      </View>
      <TouchableOpacity
        onPress={() => {
          LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
          setShowRefChart((v) => !v);
        }}
        style={styles.refChartToggle}
      >
        <Text style={[styles.refChartToggleText, { color: colors.primary }]}>
          {showRefChart ? "Not sure of your dog's weight? ▼" : "Not sure of your dog's weight? ▶"}
        </Text>
      </TouchableOpacity>
      {showRefChart && (
        <View style={[styles.refChart, { backgroundColor: colors.surface, borderColor: colors.border }]}>
          <Text style={[styles.refChartTitle, { color: colors.text }]}>Reference Chart</Text>
          <View style={styles.refChartRow}>
            <Text style={[styles.refChartBreed, { color: colors.textSecondary }]}>Yorkie</Text>
            <Text style={[styles.refChartWeight, { color: colors.text }]}>~5 lb</Text>
          </View>
          <View style={styles.refChartRow}>
            <Text style={[styles.refChartBreed, { color: colors.textSecondary }]}>Corgi</Text>
            <Text style={[styles.refChartWeight, { color: colors.text }]}>~25 lb</Text>
          </View>
          <View style={styles.refChartRow}>
            <Text style={[styles.refChartBreed, { color: colors.textSecondary }]}>Labrador</Text>
            <Text style={[styles.refChartWeight, { color: colors.text }]}>~65 lb</Text>
          </View>
          <View style={styles.refChartRow}>
            <Text style={[styles.refChartBreed, { color: colors.textSecondary }]}>Great Dane</Text>
            <Text style={[styles.refChartWeight, { color: colors.text }]}>~140 lb</Text>
          </View>
          <Text style={[styles.refChartNote, { color: colors.textSecondary }]}>
            *Typically lighter for female dogs, heavier for males.
          </Text>
        </View>
      )}

      <Text style={[styles.label, { color: colors.text }]}>Sex</Text>
      <View style={styles.chips}>
        {([DogSex.male, DogSex.female] as DogSex[]).map((s) => (
          <Chip key={s} label={s} selected={sex === s} onPress={() => setSex(s)} />
        ))}
      </View>

      <Text style={[styles.label, { color: colors.text }]}>Energy Level</Text>
      <View style={styles.chips}>
        {([EnergyLevel.low, EnergyLevel.moderate, EnergyLevel.high, EnergyLevel.very_high] as EnergyLevel[]).map((e) => (
          <Chip key={e} label={e.replace('_', ' ')} selected={energy === e} onPress={() => setEnergy(e)} />
        ))}
      </View>

      <View style={styles.switchRow}>
        <Text style={[styles.switchLabel, { color: colors.text }]}>Good with other dogs</Text>
        <Switch value={goodWithDogs} onValueChange={setGoodWithDogs} trackColor={{ true: colors.primary }} />
      </View>
      <View style={styles.switchRow}>
        <Text style={[styles.switchLabel, { color: colors.text }]}>Good with kids</Text>
        <Switch value={goodWithKids} onValueChange={setGoodWithKids} trackColor={{ true: colors.primary }} />
      </View>
      <View style={styles.switchRow}>
        <Text style={[styles.switchLabel, { color: colors.text }]}>Vaccinated</Text>
        <Switch value={vaccinated} onValueChange={setVaccinated} trackColor={{ true: colors.primary }} />
      </View>
      <View style={styles.switchRow}>
        <Text style={[styles.switchLabel, { color: colors.text }]}>Potty trained</Text>
        <Switch value={pottyTrained} onValueChange={setPottyTrained} trackColor={{ true: colors.primary }} />
      </View>

      <View ref={refFor('dogBio')}>
        <Text style={[styles.label, { color: colors.text, marginTop: spacing.md }]}>
          About {name.trim() || 'Your Dog'}
        </Text>
        <TextInput
          style={[styles.input, styles.dogBioInput, { borderColor: colors.border, color: colors.text }]}
          placeholder="Share their personality, quirks, favorite things, anything a new friend should know..."
          placeholderTextColor={colors.textSecondary}
          value={dogBio}
          onChangeText={setDogBio}
          multiline
          inputAccessoryViewID={DONE_ACCESSORY_ID}
          numberOfLines={4}
          textAlignVertical="top"
          maxLength={500}
          returnKeyType="done"
          blurOnSubmit={true}
          autoCorrect={true}
          spellCheck={true}
          autoCapitalize="sentences"
          onFocus={() => scrollToInput('dogBio')}
        />
        <CharCountHint current={dogBio.trim().length} min={20} max={500} />
      </View>

      <TouchableOpacity
        style={[styles.btn, { backgroundColor: colors.primary, opacity: saving ? 0.7 : 1 }]}
        onPress={handleSave}
        disabled={saving}
        accessibilityLabel={saving ? 'Saving...' : isCreateMode ? 'Add Dog' : 'Save changes'}
        accessibilityRole="button"
      >
        <Text style={styles.btnText}>{saving ? 'Saving...' : isCreateMode ? 'Add Dog' : 'Save Changes'}</Text>
      </TouchableOpacity>

      {!isCreateMode && (
        <TouchableOpacity
          style={[styles.deleteBtn, { borderColor: colors.error }]}
          onPress={handleDelete}
          accessibilityLabel={`Delete ${dog?.name}`}
          accessibilityRole="button"
          accessibilityHint="Permanently removes this dog from your profile"
        >
          <Text style={[styles.deleteBtnText, { color: colors.error }]}>Delete Dog</Text>
        </TouchableOpacity>
      )}
    </ScrollView>

      {/* Full-screen photo preview */}
      {previewIndex !== null && photoURLs[previewIndex] && (
        <Modal visible transparent animationType="fade" onRequestClose={() => setPreviewIndex(null)}>
          <View style={previewStyles.backdrop}>
            <ScrollView
              contentContainerStyle={previewStyles.zoomContainer}
              maximumZoomScale={4}
              minimumZoomScale={1}
              showsVerticalScrollIndicator={false}
              showsHorizontalScrollIndicator={false}
              centerContent
            >
              <Image
                source={{ uri: photoURLs[previewIndex] }}
                style={{ width: SCREEN_WIDTH, height: SCREEN_WIDTH }}
                resizeMode="contain"
              />
            </ScrollView>
            {/* Cancel */}
            <TouchableOpacity
              style={previewStyles.cancelBtn}
              onPress={() => setPreviewIndex(null)}
              accessibilityLabel="Cancel"
              accessibilityRole="button"
            >
              <Text style={previewStyles.cancelBtnText}>Cancel</Text>
            </TouchableOpacity>
            {/* Delete */}
            <TouchableOpacity
              style={previewStyles.deleteBtn}
              onPress={() => {
                const idx = previewIndex;
                setPreviewIndex(null);
                handleRemovePhoto(idx);
              }}
              accessibilityLabel="Delete this photo"
              accessibilityRole="button"
            >
              <Text style={previewStyles.deleteBtnText}>Delete Photo</Text>
            </TouchableOpacity>
          </View>
        </Modal>
      )}
          <KeyboardDoneBar />
</View>
    </>
  );
};

const { width: SCREEN_W, height: SCREEN_H } = Dimensions.get('window');

const previewStyles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.95)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  zoomContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    width: SCREEN_W,
    height: SCREEN_H,
  },
  cancelBtn: {
    position: 'absolute',
    top: 60,
    left: 20,
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 8,
    backgroundColor: 'rgba(255,255,255,0.2)',
  },
  cancelBtnText: {
    color: '#fff',
    fontSize: 18,
    fontWeight: '600',
  },
  deleteBtn: {
    position: 'absolute',
    bottom: 80,
    paddingHorizontal: 24,
    paddingVertical: 12,
    borderRadius: 12,
    backgroundColor: 'rgba(255,59,48,0.85)',
  },
  deleteBtnText: {
    color: '#fff',
    fontSize: 18,
    fontWeight: '700',
  },
});

const SCREEN_WIDTH = Dimensions.get('window').width;
const THUMB_SIZE = 80;

const styles = StyleSheet.create({
  container: { flex: 1 },
  content: { padding: spacing.lg },
  createTitle: { ...typography.h2, marginBottom: spacing.lg, textAlign: 'center' },
  input: { borderWidth: 1, borderRadius: borderRadius.md, padding: spacing.md, marginBottom: spacing.md, fontSize: 17 },
  label: { fontSize: 17, fontWeight: '600', marginBottom: spacing.sm },
  chips: { flexDirection: 'row', flexWrap: 'wrap', marginBottom: spacing.lg },
  btn: { padding: spacing.md, borderRadius: borderRadius.md, alignItems: 'center', marginBottom: spacing.md },
  btnText: { color: '#fff', ...typography.button },
  deleteBtn: { borderWidth: 1.5, borderRadius: borderRadius.md, padding: spacing.md, alignItems: 'center' },
  deleteBtnText: { fontWeight: '600' },
  // Photo grid
  photoGrid: { flexDirection: 'row', flexWrap: 'wrap', marginBottom: spacing.md, gap: spacing.xs },
  photoThumbWrap: { position: 'relative' },
  photoThumb: { width: THUMB_SIZE, height: THUMB_SIZE, borderRadius: borderRadius.sm, overflow: 'visible', marginBottom: spacing.xs },
  thumbImg: { width: THUMB_SIZE, height: THUMB_SIZE, borderRadius: borderRadius.sm },
  primaryBadge: { position: 'absolute', bottom: 2, left: 2, paddingHorizontal: 4, paddingVertical: 1, borderRadius: 4 },
  primaryBadgeText: { color: '#fff', fontSize: 11, fontWeight: '700' },
  removePhotoBtn: { position: 'absolute', top: -6, right: -6, width: 20, height: 20, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
  removePhotoBtnText: { color: '#fff', fontSize: 12, fontWeight: '700' },
  addPhotoTile: { width: THUMB_SIZE, height: THUMB_SIZE, borderRadius: borderRadius.sm, borderWidth: 1.5, borderStyle: 'dashed', alignItems: 'center', justifyContent: 'center' },
  addPhotoIcon: { fontSize: 26, fontWeight: '300', lineHeight: 28 },
  // Age
  ageRow: { flexDirection: 'row', gap: spacing.md, marginBottom: spacing.sm },
  agePicker: { flex: 1 },
  agePickerLabel: { fontSize: 15, marginBottom: spacing.xs },
  ageControls: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  ageBtn: { width: 32, height: 32, borderRadius: borderRadius.sm, borderWidth: 1, alignItems: 'center', justifyContent: 'center' },
  ageBtnText: { fontSize: 20, lineHeight: 22 },
  ageValue: { fontSize: 20, fontWeight: '700', minWidth: 28, textAlign: 'center' },
  refChartToggle: { marginTop: 4, marginBottom: spacing.md },
  refChartToggleText: { fontSize: 15, fontWeight: '600' },
  refChart: { padding: spacing.md, borderRadius: borderRadius.md, borderWidth: 1, marginBottom: spacing.md },
  refChartTitle: { fontSize: 16, fontWeight: '700', marginBottom: 8 },
  refChartRow: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 4 },
  refChartBreed: { fontSize: 15 },
  refChartWeight: { fontSize: 15, fontWeight: '600' },
  refChartNote: { fontSize: 13, fontStyle: 'italic', marginTop: 8 },
  switchRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: 10 },
  switchLabel: { fontSize: 17, fontWeight: '500' },
  dogBioInput: { height: 100, textAlignVertical: 'top', paddingTop: 12 },
  fieldHint: { fontSize: 14, marginTop: 4, marginBottom: spacing.sm } });



export default EditDogScreen;
