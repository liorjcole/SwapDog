import React, { useState, useRef, useCallback, useEffect, useLayoutEffect } from 'react';
import {
  View, Text, TextInput, TouchableOpacity, StyleSheet, ScrollView, Alert, Switch,
  Image, Platform, ActivityIndicator, Linking, Animated as RNAnimated, LayoutAnimation,
  Dimensions, Keyboard } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
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
import DogAddedTransition from '../../components/onboarding/DogAddedTransition';
import { DraggablePhotoGrid } from '../../components/common/DraggablePhotoGrid';
import { useOnboarding } from '../../contexts/OnboardingContext';

const MAX_DOGS = 10;

const ordinal = (n: number) => {
  const s = ['th', 'st', 'nd', 'rd'];
  const v = n % 100;
  return n + (s[(v - 20) % 10] || s[v] || s[0]);
};

const ordinalWord = (n: number): string => {
  const words = ['first', 'second', 'third', 'fourth', 'fifth', 'sixth', 'seventh', 'eighth', 'ninth', 'tenth'];
  return words[n - 1] || ordinal(n);
};

const MAX_PHOTOS = 10;

type Props = {
  navigation: NativeStackNavigationProp<OnboardingStackParamList, 'AddDog'>;
};



const AddDogScreen: React.FC<Props> = ({ navigation }) => {
  const { colors } = useTheme();
  const { user } = useAuthContext();
  const { createDog, deleteDog } = useDogs();

  const { dogForm: form, setDogForm: setForm, updateDogForm: set, savedDogs, savedCount, addSavedDog, removeSavedDog, popLastSavedDog, resetDogForm } = useOnboarding();
  const scrollRef = useRef<ScrollView>(null);
  const insets = useSafeAreaInsets();
  const [loading, setLoading] = useState(false);
  const [showRefChart, setShowRefChart] = useState(false);

  // Auto-map weight to size category
  const weightToSize = (lbs: number): DogSize => {
    if (lbs <= 0) return DogSize.medium;
    if (lbs <= 15) return DogSize.small;
    if (lbs <= 50) return DogSize.medium;
    if (lbs <= 100) return DogSize.large;
    return DogSize.extra_large;
  };

  // Custom back: go to previous dog instead of ProfileSetup
  const doGoBack = useCallback(() => {
    if (savedCount > 0) {
      const popped = popLastSavedDog();
      if (popped?.id) {
        deleteDog(popped.id).catch(() => {});
      }
      setTimeout(() => {
        scrollRef.current?.scrollTo({ y: 0, animated: false });
      }, 50);
      setTimeout(() => {
        scrollRef.current?.scrollTo({ y: 0, animated: false });
      }, 300);
    } else {
      navigation.goBack();
    }
  }, [savedCount, popLastSavedDog, deleteDog, navigation]);

  const handleBack = useCallback(() => {
    if (savedCount > 0) {
      // Warn that unsaved progress on the current dog will be lost
      Alert.alert(
        'Lose progress?',
        'Any progress on this dog will be lost if you go back. Don\'t worry — all your previously saved dogs are safe and won\'t be affected!',
        [
          { text: 'Cancel', style: 'cancel' },
          { text: 'Go Back', style: 'destructive', onPress: doGoBack },
        ]
      );
    } else {
      navigation.goBack();
    }
  }, [savedCount, doGoBack, navigation]);

  const [showTransition, setShowTransition] = useState(false);

  useLayoutEffect(() => {
    navigation.setOptions({
      headerShown: !showTransition,
      headerLeft: savedCount > 0 ? () => (
        <TouchableOpacity
          onPress={handleBack}
          hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
          style={{ width: 34, height: 34, borderRadius: 17, backgroundColor: 'rgba(255,255,255,0.15)', alignItems: 'center', justifyContent: 'center' }}
        >
          <Text style={{ fontSize: 20, color: '#FFFFFF', fontWeight: '600', marginLeft: -2, marginTop: -1 }}>{'‹'}</Text>
        </TouchableOpacity>
      ) : undefined,
    });
  }, [navigation, savedCount, handleBack, colors.primary, showTransition]);

  // Intercept swipe-back gesture too
  useEffect(() => {
    if (savedCount === 0) return;
    const unsub = navigation.addListener('beforeRemove', (e) => {
      e.preventDefault();
      handleBack();
    });
    return unsub;
  }, [navigation, savedCount, handleBack]);

  /** Track y-offsets of inputs so we can scroll to them on focus */
  const [uploadingPhoto, setUploadingPhoto] = useState(false);
  const [scrollEnabled, setScrollEnabled] = useState(true);
  const [transitionMode, setTransitionMode] = useState<'addAnother' | 'continue'>('addAnother');
  const [transitionDogName, setTransitionDogName] = useState('');



  const pickPhoto = async () => {
    const remaining = MAX_PHOTOS - form.photoURLs.length;
    if (remaining <= 0) return;

    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: 'images',
      allowsMultipleSelection: true,
      selectionLimit: remaining,
      quality: 0.8,
    });
    if (result.canceled || !result.assets?.length) return;

    const localUris = result.assets.map((a) => a.uri).slice(0, remaining);

    // Phase 2: Show local thumbnails immediately, then upload in background
    const localPhotos = [...form.photoURLs, ...localUris].slice(0, MAX_PHOTOS);
    set('photoURLs', localPhotos);
    setUploadingPhoto(true);

    const uploaded: string[] = [...form.photoURLs];
    for (const uri of localUris) {
      try {
        const tempId = `temp_${user?.uid ?? 'anon'}_${Date.now()}`;
        const response = await fetch(uri);
        if (!response) throw new Error('Failed to read image file');
        const blob = await response.blob();
        const fileRef = storageRef(storage, `dogs/${tempId}/${Date.now()}_${Math.random().toString(36).slice(2)}.jpg`);
        await uploadBytes(fileRef, blob, { contentType: 'image/jpeg' });
        const downloadURL = await getDownloadURL(fileRef);
        uploaded.push(downloadURL);
      } catch {
        Alert.alert('Error', 'One photo failed to upload. You can try adding it again.');
      }
    }

    // Replace local URIs with real download URLs
    set('photoURLs', uploaded.slice(0, MAX_PHOTOS));
    setUploadingPhoto(false);

    if (uploaded.length >= MAX_PHOTOS) {
      Alert.alert('All set!', `You've added ${MAX_PHOTOS} photos.`);
    }
  };

  const removePhoto = (index: number) => {
    set('photoURLs', form.photoURLs.filter((_, i) => i !== index));
  };

  const cropPhoto = async (index: number) => {
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      allowsEditing: true,
      aspect: [1, 1] as [number, number],
      quality: 0.8,
    });
    if (result.canceled || !result.assets?.length) return;

    const croppedUri = result.assets[0].uri;
    const oldUri = form.photoURLs[index];
    // Show local preview immediately
    const updated = [...form.photoURLs];
    updated[index] = croppedUri;
    set('photoURLs', updated);

    // Upload cropped photo in background
    try {
      const tempId = `temp_${user?.uid ?? 'anon'}_${Date.now()}`;
      const response = await fetch(croppedUri);
      if (!response) throw new Error('Failed to read cropped image');
      const blob = await response.blob();
      const fileRef = storageRef(storage, `dogs/${tempId}/${Date.now()}_${Math.random().toString(36).slice(2)}.jpg`);
      await uploadBytes(fileRef, blob, { contentType: 'image/jpeg' });
      const downloadURL = await getDownloadURL(fileRef);
      set('photoURLs', form.photoURLs.map((u: string, i: number) => i === index ? downloadURL : u));
    } catch {
      Alert.alert('Error', 'Failed to upload cropped photo. Please try again.');
      set('photoURLs', form.photoURLs.map((u: string, i: number) => i === index ? oldUri : u));
    }
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
    if (form.photoURLs.length === 0) {
      Alert.alert('Photo Required', 'Please add at least one photo of your dog');
      return null;
    }
    if (!form.weightLbs || form.weightLbs <= 0) {
      Alert.alert('Required', "Please enter your dog's weight");
      return null;
    }
    if (form.dogBio.trim().length < 20) {
      Alert.alert('Required', 'Please write at least 20 characters about your dog');
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
        size: weightToSize(form.weightLbs),
        sex: form.sex,
        energyLevel: form.energy,
        photoURLs: form.photoURLs,
        isGoodWithDogs: form.goodWithDogs,
        isGoodWithKids: form.goodWithKids,
        vaccinated: form.vaccinated,
        ...(form.dogBio.trim() ? { bio: form.dogBio.trim() } : {}) });
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      return dogId;
    } catch (error: unknown) {
      Alert.alert('Error', error instanceof Error ? error.message : 'Failed to add dog');
      return null;
    } finally {
      setLoading(false);
    }
  };

  const handleContinue = async () => {
    Keyboard.dismiss();
    const dogId = await saveDog();
    if (dogId) {
      const justSavedName = form.name.trim();
      addSavedDog({ id: dogId, name: justSavedName, breed: form.breed, photoURL: form.photoURLs[0], formSnapshot: { ...form } });
      setTransitionDogName(justSavedName);
      setTransitionMode('continue');
      setShowTransition(true);
    }
  };

  const handleAddAnother = async () => {
    Keyboard.dismiss();
    if (savedCount + 1 >= MAX_DOGS) {
      Alert.alert(
        '10 Dog Limit Reached',
        'Reach out to support to request a special account for 10+ dogs!',
        [
          { text: 'Cancel', style: 'cancel' },
          {
            text: 'Email Support',
            onPress: () => Linking.openURL('mailto:david@joinwatchdog.com?subject=Request%20for%2010%2B%20Dogs%20Account'),
          },
        ]
      );
      return;
    }
    const dogId = await saveDog();
    if (dogId) {
      const justSavedName = form.name.trim();
      addSavedDog({ id: dogId, name: justSavedName, breed: form.breed, photoURL: form.photoURLs[0], formSnapshot: { ...form } });
      setTransitionDogName(justSavedName);
      setTransitionMode('addAnother');
      setShowTransition(true);
    }
  };

  const handleDeleteCurrentDog = () => {
    Keyboard.dismiss();
    const currentOrdinal = ordinalWord(savedCount + 1);
    Alert.alert(
      `Remove your ${currentOrdinal} dog?`,
      `This will discard ${form.name.trim() || 'this dog'} and go back to your previous dog.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Remove',
          style: 'destructive',
          onPress: () => {
            // Discard current form, pop previous dog and restore its data
            const popped = popLastSavedDog();
            if (popped?.id) {
              deleteDog(popped.id).catch(() => {});
            }
            setTimeout(() => {
              scrollRef.current?.scrollTo({ y: 0, animated: false });
            }, 50);
            setTimeout(() => {
              scrollRef.current?.scrollTo({ y: 0, animated: false });
            }, 300);
            Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
          },
        },
      ]
    );
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
              removeSavedDog(dogId);
              // Don't reset the current form — only the specific saved dog was removed
              Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
            } catch (e: unknown) {
              Alert.alert('Error', e instanceof Error ? e.message : 'Failed to remove dog');
            }
          } },
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
    <>
    <View style={{ flex: 1, backgroundColor: colors.background }}>
    <ScrollView
        ref={scrollRef}
        scrollEnabled={scrollEnabled}
        automaticallyAdjustKeyboardInsets={true}
        keyboardShouldPersistTaps="handled"
        style={[styles.container, { backgroundColor: colors.background }]} contentContainerStyle={styles.content}>
      <Text style={[styles.title, { color: colors.text }]} accessibilityRole="header">
        {savedCount === 0 ? 'Add your dog' : `Add your ${ordinalWord(savedCount + 1)} dog`}
      </Text>
      <Text style={[styles.sub, { color: colors.textSecondary }]}>
        {savedCount === 0
          ? "Fill out your pup's profile!"
          : `${savedCount} dog${savedCount > 1 ? 's' : ''} added — keep going!`}
      </Text>

      {savedCount === 0 && (
        <View style={[styles.multiDogHint, { backgroundColor: colors.primary + '12' }]}>
          <Text style={[styles.multiDogHintText, { color: colors.primary }]}>
            🐾  Have multiple dogs? You'll be able to add them one at a time after this!
          </Text>
        </View>
      )}

      {/* Photo grid — draggable reorder, first = primary */}
      <Text style={[styles.label, { color: colors.text }]}>Photos ({form.photoURLs.length}/{MAX_PHOTOS})</Text>
      <Text style={{ fontSize: 11, color: colors.textSecondary, marginBottom: 8, fontStyle: 'italic' }}>
        Hold & drag to reorder. First photo is your primary.
      </Text>
      <DraggablePhotoGrid
        photos={form.photoURLs}
        onReorder={(newPhotos) => set('photoURLs', newPhotos)}
        onDelete={(index) => removePhoto(index)}
        onAdd={pickPhoto}
        maxPhotos={MAX_PHOTOS}
        uploading={uploadingPhoto}
        onDragStart={() => setScrollEnabled(false)}
        onDragEnd={() => setScrollEnabled(true)}
        colors={{
          primary: colors.primary,
          surface: colors.surface,
          border: colors.border,
          textSecondary: colors.textSecondary,
          background: colors.background,
        }}
      />



      <View>
        <TextInput
          style={[styles.input, { backgroundColor: colors.surface, borderColor: colors.border, color: colors.text }]}
          placeholder="Dog's name"
          placeholderTextColor={colors.textSecondary}
          value={form.name}
          onChangeText={(v) => set('name', v)}
          accessibilityLabel="Dog's name"
          returnKeyType="done"
          blurOnSubmit={true}
          autoCapitalize="words"
        />
      </View>

            <View>
        <TextInput
          style={[styles.input, { backgroundColor: colors.surface, borderColor: colors.border, color: colors.text }]}
          placeholder="Breed"
          placeholderTextColor={colors.textSecondary}
          value={form.breed}
          onChangeText={(v) => set('breed', v)}
          autoCorrect={true}
          spellCheck={true}
          autoCapitalize="words"
          accessibilityLabel="Dog's breed"
          returnKeyType="done"
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

      <View>
        <Text style={[styles.label, { color: colors.text }]}>Weight (lbs)</Text>
        <TextInput
          style={[styles.input, { backgroundColor: colors.surface, borderColor: colors.border, color: colors.text }]}
          placeholder="Estimated weight in pounds"
          placeholderTextColor={colors.textSecondary}
          value={form.weightLbs > 0 ? String(form.weightLbs) : ''}
          onChangeText={(v) => {
            const num = parseInt(v.replace(/[^0-9]/g, ''), 10);
            set('weightLbs', isNaN(num) ? 0 : num);
          }}
          keyboardType="number-pad"
          returnKeyType="done"
          accessibilityLabel="Dog weight in pounds"
        />
      </View>
      <TouchableOpacity
        onPress={() => {
          LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
          setShowRefChart((v) => !v);
        }}
        style={styles.refChartToggle}
        accessibilityLabel={showRefChart ? 'Hide reference chart' : 'Show reference chart'}
        accessibilityRole="button"
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

      {/* Dog bio / about field */}
      <View>
        <Text style={[styles.label, { color: colors.text, marginTop: spacing.md }]}>
          About {form.name.trim() || 'Your Dog'}
        </Text>
        <TextInput
          style={[styles.input, styles.dogBioInput, { borderColor: colors.border, color: colors.text }]}
          placeholder="Share their personality, quirks, favorite things, anything a new friend should know..."
          placeholderTextColor={colors.textSecondary}
          value={form.dogBio}
          onChangeText={(v) => set('dogBio', v)}
          multiline
          numberOfLines={4}
          textAlignVertical="top"
          maxLength={500}
          returnKeyType="done"
          blurOnSubmit={true}
          autoCorrect={true}
          spellCheck={true}
          autoCapitalize="sentences"
        />
        <Text style={[styles.fieldHint, { color: form.dogBio.trim().length >= 20 ? colors.success : colors.textSecondary }]}>
          {form.dogBio.trim().length < 20
            ? `${form.dogBio.trim().length}/20 characters minimum`
            : `${form.dogBio.trim().length} characters ✓`}
        </Text>
      </View>

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
      {savedCount + 1 < MAX_DOGS ? (
        <TouchableOpacity
          style={[styles.addAnotherBtn, { borderColor: colors.primary, opacity: loading ? 0.5 : 1 }]}
          onPress={handleAddAnother}
          disabled={loading}
          accessibilityLabel="Add another dog"
          accessibilityRole="button"
        >
          <Text style={[styles.addAnotherBtnText, { color: colors.primary }]}>➕ Add Another Dog</Text>
        </TouchableOpacity>
      ) : savedCount + 1 >= MAX_DOGS ? (
        <TouchableOpacity
          style={[styles.addAnotherBtn, { borderColor: colors.textSecondary, opacity: 0.8 }]}
          onPress={() => Linking.openURL('mailto:david@joinwatchdog.com?subject=Request%20for%2010%2B%20Dogs%20Account')}
          accessibilityLabel="Contact support for more than 10 dogs"
          accessibilityRole="button"
        >
          <Text style={[styles.addAnotherBtnText, { color: colors.textSecondary }]}>
            10 dog limit reached — email david@joinwatchdog.com for a special account!
          </Text>
        </TouchableOpacity>
      ) : null}

      {/* Delete current dog — only shown for 2nd+ dog */}
      {savedCount > 0 && (
        <TouchableOpacity
          style={styles.deleteCurrentBtn}
          onPress={handleDeleteCurrentDog}
          accessibilityLabel={`Delete ${ordinalWord(savedCount + 1)} dog`}
          accessibilityRole="button"
        >
          <Text style={styles.deleteCurrentBtnText}>
            Delete {ordinalWord(savedCount + 1)} dog
          </Text>
        </TouchableOpacity>
      )}

    </ScrollView>

      {showTransition && (
        <DogAddedTransition
          dogName={transitionDogName}
          dogNumber={savedCount}
          allDogs={savedDogs.map((d) => ({ name: d.name }))}
          mode={transitionMode}
          nextDogNumber={savedCount + 1}
          onFinish={() => {
            setShowTransition(false);
            if (transitionMode === 'continue') {
              navigation.navigate('Paywall');
            } else {
              resetDogForm();
              setTimeout(() => {
                scrollRef.current?.scrollTo({ y: 0, animated: false });
              }, 50);
              setTimeout(() => {
                scrollRef.current?.scrollTo({ y: 0, animated: false });
              }, 300);
            }
          }}
        />
      )}



    </View>

    </>
  );
};

const { width: SCREEN_W, height: SCREEN_H } = Dimensions.get('window');
const THUMB_SIZE = 80;

const styles = StyleSheet.create({
  container: { flex: 1 },
  content: { flexGrow: 1, padding: spacing.lg, paddingTop: spacing.lg },
  title: { ...typography.h2, textAlign: 'center', marginBottom: spacing.xs },
  sub: { ...typography.body, textAlign: 'center', marginBottom: spacing.md },
  multiDogHint: {
    borderRadius: borderRadius.md,
    paddingVertical: spacing.sm + 2,
    paddingHorizontal: spacing.md,
    marginBottom: spacing.lg,
  },
  multiDogHintText: {
    fontSize: 14,
    fontWeight: '600',
    textAlign: 'center',
    lineHeight: 20,
  },
  input: { borderWidth: 1, borderRadius: borderRadius.md, padding: spacing.md, marginBottom: spacing.md, fontSize: 15 },
  label: { fontSize: 15, fontWeight: '600', marginBottom: spacing.sm, marginTop: spacing.sm },
  chips: { flexDirection: 'row', flexWrap: 'wrap', marginBottom: spacing.md },
  switchRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: spacing.sm, borderBottomWidth: 1 },
  switchLabel: { fontSize: 15 },
  btn: { padding: spacing.md, borderRadius: borderRadius.md, alignItems: 'center', marginTop: spacing.lg, marginBottom: spacing.md },
  btnText: { color: '#fff', ...typography.button },
  addAnotherBtn: {
    borderWidth: 2,
    borderRadius: borderRadius.md,
    padding: spacing.md,
    alignItems: 'center',
    marginBottom: spacing.xl },
  addAnotherBtnText: { fontSize: 15, fontWeight: '700' },
  deleteCurrentBtn: {
    alignItems: 'center',
    paddingVertical: spacing.sm,
    marginTop: spacing.sm,
    marginBottom: spacing.lg,
  },
  deleteCurrentBtnText: {
    fontSize: 15,
    fontWeight: '600',
    color: '#FF3B30',
  },
  dogBioInput: { minHeight: 100, paddingTop: spacing.md },
  fieldHint: { fontSize: 12, color: '#999', marginTop: -8, marginBottom: 4 },
  refChartToggle: { alignSelf: 'flex-start', marginBottom: spacing.sm, paddingVertical: 4 },
  refChartToggleText: { fontSize: 14, fontWeight: '600' },
  refChart: { borderWidth: 1, borderRadius: borderRadius.md, padding: spacing.md, marginBottom: spacing.md },
  refChartTitle: { fontSize: 14, fontWeight: '700', marginBottom: spacing.sm },
  refChartRow: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 6, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: 'rgba(255,255,255,0.1)' },
  refChartBreed: { fontSize: 14 },
  refChartWeight: { fontSize: 14, fontWeight: '600' },
  refChartNote: { fontSize: 12, fontStyle: 'italic', marginTop: spacing.sm },
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
  // Photo preview modal
});




export default AddDogScreen;
