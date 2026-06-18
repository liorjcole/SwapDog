import React, { useEffect, useState } from 'react';
import {
  View, Text, TextInput, TouchableOpacity, StyleSheet, ScrollView, Alert, Image, Platform, ActivityIndicator } from 'react-native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { RouteProp } from '@react-navigation/native';
import * as Haptics from 'expo-haptics';
import * as ImagePicker from 'expo-image-picker';
import { ref as storageRef, uploadBytes, getDownloadURL } from 'firebase/storage';
import { storage } from '../../config/firebase';
import { ProfileStackParamList } from '../../navigation/types';
import { useTheme } from '../../contexts/ThemeContext';
import { useAuthContext } from '../../contexts/AuthContext';
import { useDogs } from '../../hooks/useDogs';
import { Dog, DogSize, DogSex, EnergyLevel } from '../../models/types';
import { spacing, borderRadius, typography } from '../../config/theme';
import LoadingSpinner from '../../components/common/LoadingSpinner';
import Chip from '../../components/common/Chip';

type Props = {
  navigation: NativeStackNavigationProp<ProfileStackParamList, 'EditDog'>;
  route: RouteProp<ProfileStackParamList, 'EditDog'>;
};

const EditDogScreen: React.FC<Props> = ({ navigation, route }) => {
  const { colors } = useTheme();
  const { user } = useAuthContext();
  const { getDog, updateDog, createDog, deleteDog } = useDogs();

  // If no dogId → create mode
  const dogId = route.params?.dogId;
  const isCreateMode = !dogId;

  const [dog, setDog] = useState<Dog | null>(null);
  const [name, setName] = useState('');
  const [breed, setBreed] = useState('');
  const [ageYears, setAgeYears] = useState(0);
  const [ageMonths, setAgeMonths] = useState(1);
  const [size, setSize] = useState<DogSize>(DogSize.medium);
  const [sex, setSex] = useState<DogSex>(DogSex.male);
  const [energy, setEnergy] = useState<EnergyLevel>(EnergyLevel.moderate);
  const [photoURLs, setPhotoURLs] = useState<string[]>([]);
  const [loading, setLoading] = useState(!isCreateMode);
  const [saving, setSaving] = useState(false);
  const [uploadingPhoto, setUploadingPhoto] = useState(false);

  useEffect(() => {
    if (isCreateMode) return; // skip fetching in create mode
    getDog(dogId).then((d) => {
      if (d) {
        setDog(d);
        setName(d.name);
        setBreed(d.breed);
        setAgeYears(d.ageYears);
        setAgeMonths(d.ageMonths);
        setSize(d.size);
        setSex(d.sex);
        setEnergy(d.energyLevel);
        setPhotoURLs(d.photoURLs);
      }
      setLoading(false);
    });
  }, [dogId]);

  const handleAddPhoto = async () => {
    if (photoURLs.length >= 10) {
      Alert.alert('Limit reached', 'You can add up to 10 photos per dog');
      return;
    }

    // Phase 1: Collect all cropped photos — picker stays open until cancel or max
    const localUris: string[] = [];
    let totalCount = photoURLs.length;

    while (totalCount < 10) {
      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: 'images',
        allowsMultipleSelection: false,
        allowsEditing: true,
        aspect: [1, 1] as [number, number],
        quality: 0.8,
      });
      if (result.canceled || !result.assets?.length) break;
      localUris.push(result.assets[0].uri);
      totalCount++;
    }

    if (localUris.length === 0) return;

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
    setPhotoURLs((prev) => prev.filter((_, i) => i !== index));
  };

  const handleSave = async () => {
    if (!name.trim()) { Alert.alert('Required', 'Dog name is required'); return; }
    if (!breed.trim()) { Alert.alert('Required', 'Breed is required'); return; }
    if (!user) return;
    setSaving(true);
    try {
      if (isCreateMode) {
        await createDog({
          ownerId: user.uid,
          name: name.trim(),
          breed: breed.trim(),
          ageYears,
          ageMonths,
          size,
          sex,
          energyLevel: energy,
          photoURLs });
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
        navigation.goBack();
      } else {
        await updateDog(dogId, {
          name: name.trim(),
          breed: breed.trim(),
          ageYears,
          ageMonths,
          size,
          sex,
          energyLevel: energy,
          photoURLs });
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
    <View style={{ flex: 1, backgroundColor: colors.background }}>
    <ScrollView
        automaticallyAdjustKeyboardInsets={true} style={[styles.container, { backgroundColor: colors.background }]} contentContainerStyle={styles.content}>

      {isCreateMode && (
        <Text style={[styles.createTitle, { color: colors.text }]}>Add a New Dog 🐶</Text>
      )}

      {/* Photo gallery */}
      <Text style={[styles.label, { color: colors.text }]}>Photos ({photoURLs.length}/10)</Text>
      <View style={styles.photoGrid}>
        {photoURLs.map((uri, index) => (
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
              style={[styles.removePhotoBtn, { backgroundColor: colors.error }]}
              onPress={() => handleRemovePhoto(index)}
              accessibilityLabel={`Remove photo ${index + 1}`}
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

      <TextInput
        style={[styles.input, { backgroundColor: colors.surface, borderColor: colors.border, color: colors.text }]}
        value={name}
        onChangeText={setName}
        placeholder="Dog name"
        placeholderTextColor={colors.textSecondary}
        accessibilityLabel="Dog name"
          returnKeyType="next"
          blurOnSubmit={false}
      />
      <TextInput
        style={[styles.input, { backgroundColor: colors.surface, borderColor: colors.border, color: colors.text }]}
        value={breed}
        onChangeText={setBreed}
        placeholder="Breed"
        placeholderTextColor={colors.textSecondary}
        accessibilityLabel="Dog breed"
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

      <Text style={[styles.label, { color: colors.text }]}>Size</Text>
      <View style={styles.chips}>
        {([DogSize.small, DogSize.medium, DogSize.large, DogSize.extra_large] as DogSize[]).map((s) => (
          <Chip key={s} label={s.replace('_', ' ')} selected={size === s} onPress={() => setSize(s)} />
        ))}
      </View>

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
    </View>
  );
};

const THUMB_SIZE = 80;

const styles = StyleSheet.create({
  container: { flex: 1 },
  content: { padding: spacing.lg },
  createTitle: { ...typography.h2, marginBottom: spacing.lg, textAlign: 'center' },
  input: { borderWidth: 1, borderRadius: borderRadius.md, padding: spacing.md, marginBottom: spacing.md, fontSize: 15 },
  label: { fontSize: 15, fontWeight: '600', marginBottom: spacing.sm },
  chips: { flexDirection: 'row', flexWrap: 'wrap', marginBottom: spacing.lg },
  btn: { padding: spacing.md, borderRadius: borderRadius.md, alignItems: 'center', marginBottom: spacing.md },
  btnText: { color: '#fff', ...typography.button },
  deleteBtn: { borderWidth: 1.5, borderRadius: borderRadius.md, padding: spacing.md, alignItems: 'center' },
  deleteBtnText: { fontWeight: '600' },
  // Photo grid
  photoGrid: { flexDirection: 'row', flexWrap: 'wrap', marginBottom: spacing.md, gap: spacing.xs },
  photoThumb: { width: THUMB_SIZE, height: THUMB_SIZE, borderRadius: borderRadius.sm, overflow: 'visible', marginBottom: spacing.xs },
  thumbImg: { width: THUMB_SIZE, height: THUMB_SIZE, borderRadius: borderRadius.sm },
  primaryBadge: { position: 'absolute', bottom: 2, left: 2, paddingHorizontal: 4, paddingVertical: 1, borderRadius: 4 },
  primaryBadgeText: { color: '#fff', fontSize: 9, fontWeight: '700' },
  removePhotoBtn: { position: 'absolute', top: -6, right: -6, width: 20, height: 20, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
  removePhotoBtnText: { color: '#fff', fontSize: 10, fontWeight: '700' },
  addPhotoTile: { width: THUMB_SIZE, height: THUMB_SIZE, borderRadius: borderRadius.sm, borderWidth: 1.5, borderStyle: 'dashed', alignItems: 'center', justifyContent: 'center' },
  addPhotoIcon: { fontSize: 24, fontWeight: '300', lineHeight: 28 },
  // Age
  ageRow: { flexDirection: 'row', gap: spacing.md, marginBottom: spacing.sm },
  agePicker: { flex: 1 },
  agePickerLabel: { fontSize: 13, marginBottom: spacing.xs },
  ageControls: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  ageBtn: { width: 32, height: 32, borderRadius: borderRadius.sm, borderWidth: 1, alignItems: 'center', justifyContent: 'center' },
  ageBtnText: { fontSize: 18, lineHeight: 22 },
  ageValue: { fontSize: 18, fontWeight: '700', minWidth: 28, textAlign: 'center' } });

export default EditDogScreen;
