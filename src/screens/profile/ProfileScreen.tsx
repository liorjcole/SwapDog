import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  View, Text, TouchableOpacity, StyleSheet, ScrollView, Image, Alert,
  ActivityIndicator, Linking, Keyboard, TextInput, Switch, LayoutAnimation,
  NativeSyntheticEvent, NativeScrollEvent,
} from 'react-native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useFocusEffect } from '@react-navigation/native';
import * as Haptics from 'expo-haptics';
import { uploadPhotoToStorage, ensureRemotePhotoURL } from '../../utils/uploadHelper';
import * as ImagePicker from 'expo-image-picker';
import { auth } from '../../config/firebase';
import { ProfileStackParamList } from '../../navigation/types';
import { useAuthContext } from '../../contexts/AuthContext';
import { useTheme } from '../../contexts/ThemeContext';
import AvatarImage from '../../components/common/AvatarImage';
import { useAuth } from '../../hooks/useAuth';
import { useDogs } from '../../hooks/useDogs';
import { getReferralCount } from '../../hooks/useReferrals';
import { Dog, DogSex, EnergyLevel } from '../../models/types';
import { spacing, borderRadius, typography, shadow } from '../../config/theme';
import { formatDogAge } from '../../utils/formatDogAge';
import LoadingSpinner from '../../components/common/LoadingSpinner';
import { DraggablePhotoGrid } from '../../components/common/DraggablePhotoGrid';
import StarRating from '../../components/common/StarRating';
import { useKeyboardScroll } from '../../hooks/useKeyboardScroll';

type Props = {
  navigation: NativeStackNavigationProp<ProfileStackParamList, 'Profile'>;
};

type DogDetailsDraft = {
  name: string;
  breed: string;
  ageYears: number;
  ageMonths: number;
  weightLbs: string;
  sex: DogSex;
  energyLevel: EnergyLevel;
  isGoodWithDogs: boolean;
  isGoodWithKids: boolean;
  vaccinated: boolean;
  pottyTrained: boolean;
  bio: string;
};

const draftFromDog = (dog: Dog): DogDetailsDraft => ({
  name: dog.name ?? '',
  breed: dog.breed ?? '',
  ageYears: dog.ageYears ?? 0,
  ageMonths: dog.ageMonths ?? 0,
  weightLbs: dog.weightLbs > 0 ? String(dog.weightLbs) : '',
  sex: dog.sex ?? DogSex.male,
  energyLevel: dog.energyLevel ?? EnergyLevel.moderate,
  isGoodWithDogs: dog.isGoodWithDogs ?? true,
  isGoodWithKids: dog.isGoodWithKids ?? true,
  vaccinated: dog.vaccinated ?? false,
  pottyTrained: dog.pottyTrained ?? false,
  bio: dog.bio ?? '',
});

const isDogDraftDirty = (dog: Dog, draft?: DogDetailsDraft): boolean => {
  if (!draft) return false;
  return JSON.stringify(draftFromDog(dog)) !== JSON.stringify(draft);
};

const STICKY_SAVE_BANNER_HEIGHT = 52;

const cleanIgHandle = (raw: string): string => {
  let h = raw.trim();
  // Strip full URL
  h = h.replace(/^https?:\/\/(www\.)?instagram\.com\//i, '');
  // Strip leading @
  h = h.replace(/^@/, '');
  // Remove trailing slash
  h = h.replace(/\/$/, '');
  return h;
};

const ProfileScreen: React.FC<Props> = ({ navigation }) => {
  const { colors } = useTheme();
  const { userProfile, user, refreshUserProfile } = useAuthContext();
  const { signOut } = useAuth();
  const { getDogsByOwner, updateDog, deleteDog } = useDogs();
  const {
    scrollRef,
    onScroll,
    onLayout,
    onContentSizeChange,
    refFor,
    scrollToInput,
  } = useKeyboardScroll();
  const [dogs, setDogs] = useState<Dog[]>([]);
  const [loading, setLoading] = useState(true);
  const [referralCount, setReferralCount] = useState(0);
  const [uploadingDogId, setUploadingDogId] = useState<string | null>(null);
  const [uploadingPhotoCount, setUploadingPhotoCount] = useState(0);
  const [scrollEnabled, setScrollEnabled] = useState(true);
  const [expandedDogId, setExpandedDogId] = useState<string | null>(null);
  const [dogDrafts, setDogDrafts] = useState<Record<string, DogDetailsDraft>>({});
  const [savingDogId, setSavingDogId] = useState<string | null>(null);
  const [profileScrollY, setProfileScrollY] = useState(0);
  const [dogDetailLayouts, setDogDetailLayouts] = useState<Record<string, { y: number; height: number }>>({});
  const dogDetailRefs = useRef<Record<string, View | null>>({});

  useEffect(() => {
    if (!user) return;
    getDogsByOwner(user.uid).then(setDogs).finally(() => setLoading(false));
    getReferralCount(user.uid).then(setReferralCount);
  }, [user]);

  const refreshDogs = () => {
    if (!user) return;
    getDogsByOwner(user.uid).then(setDogs);
  };

  const toggleDogDetails = (dog: Dog) => {
    LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
    setExpandedDogId((current) => {
      const next = current === dog.id ? null : dog.id;
      if (next) {
        setDogDrafts((prev) => ({
          ...prev,
          [dog.id]: prev[dog.id] ?? draftFromDog(dog),
        }));
      }
      return next;
    });
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
  };

  const updateDogDraft = (dogId: string, patch: Partial<DogDetailsDraft>) => {
    setDogDrafts((prev) => ({
      ...prev,
      [dogId]: {
        ...(prev[dogId] ?? draftFromDog(dogs.find((dog) => dog.id === dogId)!)),
        ...patch,
      },
    }));
  };

  const handleProfileScroll = (event: NativeSyntheticEvent<NativeScrollEvent>) => {
    onScroll(event);
    setProfileScrollY(event.nativeEvent.contentOffset.y);
  };

  const measureDogDetails = (dogId: string) => {
    const node = dogDetailRefs.current[dogId];
    if (!node) return;
    node.measureInWindow((_x, winY, _width, height) => {
      const scrollNode = scrollRef.current as unknown as {
        measureInWindow?: (callback: (x: number, y: number, width: number, height: number) => void) => void;
      } | null;
      scrollNode?.measureInWindow?.((_sx: number, scrollWinY: number) => {
        setDogDetailLayouts((prev) => ({
          ...prev,
          [dogId]: {
            y: profileScrollY + winY - scrollWinY,
            height,
          },
        }));
      });
    });
  };

  const getStickySaveBannerTop = (dogId: string) => {
    const layout = dogDetailLayouts[dogId];
    if (!layout) return 0;
    const maxTop = Math.max(0, layout.height - STICKY_SAVE_BANNER_HEIGHT - spacing.sm);
    return Math.min(Math.max(profileScrollY - layout.y, 0), maxTop);
  };

  const handleSaveDogDetails = async (dog: Dog) => {
    const draft = dogDrafts[dog.id];
    if (!draft) return;

    const name = draft.name.trim();
    const breed = draft.breed.trim();
    const weightLbs = parseInt(draft.weightLbs.replace(/[^0-9]/g, ''), 10);

    if (!name) { Alert.alert('Required', 'Dog name is required'); return; }
    if (!breed) { Alert.alert('Required', 'Breed is required'); return; }
    if (!weightLbs || weightLbs <= 0) { Alert.alert('Required', "Please enter your dog's weight"); return; }

    setSavingDogId(dog.id);
    try {
      await updateDog(dog.id, {
        name,
        breed,
        ageYears: draft.ageYears,
        ageMonths: draft.ageMonths,
        weightLbs,
        sex: draft.sex,
        energyLevel: draft.energyLevel,
        isGoodWithDogs: draft.isGoodWithDogs,
        isGoodWithKids: draft.isGoodWithKids,
        vaccinated: draft.vaccinated,
        pottyTrained: draft.pottyTrained,
        bio: draft.bio.trim(),
      });
      setDogs((prev) =>
        prev.map((item) =>
          item.id === dog.id
            ? {
                ...item,
                name,
                breed,
                ageYears: draft.ageYears,
                ageMonths: draft.ageMonths,
                weightLbs,
                sex: draft.sex,
                energyLevel: draft.energyLevel,
                isGoodWithDogs: draft.isGoodWithDogs,
                isGoodWithKids: draft.isGoodWithKids,
                vaccinated: draft.vaccinated,
                pottyTrained: draft.pottyTrained,
                bio: draft.bio.trim(),
              }
            : item,
        ),
      );
      setDogDrafts((prev) => ({ ...prev, [dog.id]: { ...draft, name, breed, weightLbs: String(weightLbs), bio: draft.bio.trim() } }));
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    } catch (err) {
      Alert.alert('Error', err instanceof Error ? err.message : 'Failed to save dog details');
    } finally {
      setSavingDogId(null);
    }
  };

  const handleChangeProfilePhoto = async () => {
    try {
      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ImagePicker.MediaTypeOptions.Images,
        allowsEditing: true,
        aspect: [1, 1],
        quality: 0.8,
      });
      if (result.canceled || !result.assets?.[0]) return;
      const uri = result.assets[0].uri;
      if (!user) return;
      const downloadURL = await ensureRemotePhotoURL(uri, `users/${user.uid}/profile`);
      if (!downloadURL) {
        Alert.alert('Error', 'Failed to upload photo.');
        return;
      }
      const { updateDoc, doc, serverTimestamp } = await import('firebase/firestore');
      const { db } = await import('../../config/firebase');
      await updateDoc(doc(db, 'users', user.uid), { photoURL: downloadURL, updatedAt: serverTimestamp() });
      await refreshUserProfile();
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    } catch (err) {
      Alert.alert('Error', 'Failed to update photo.');
    }
  };

  // Re-fetch dogs every time the screen comes into focus (e.g. after adding a dog)
  useFocusEffect(
    useCallback(() => {
      refreshDogs();
    }, [user])
  );

  /**
   * Delete a photo from Firebase Storage via REST API DELETE request.
   * Non-fatal — if storage delete fails we still remove from Firestore.
   */
  const deletePhotoFromStorage = async (photoURL: string): Promise<void> => {
    try {
      const currentUser = auth.currentUser;
      if (!currentUser) return;
      // Extract encoded object path from Firebase Storage URL
      // URL format: https://firebasestorage.googleapis.com/v0/b/{bucket}/o/{encodedPath}?alt=media&token=...
      const match = photoURL.match(/\/o\/([^?]+)/);
      if (!match) return;
      const encodedPath = match[1];
      const bucket = 'swapdog-d0cfe.firebasestorage.app';
      const deleteUrl = `https://firebasestorage.googleapis.com/v0/b/${bucket}/o/${encodedPath}`;
      const token = await currentUser.getIdToken();
      await fetch(deleteUrl, {
        method: 'DELETE',
        headers: { 'Authorization': `Bearer ${token}` },
      });
      console.log('[PhotoDelete] Deleted from storage:', encodedPath);
    } catch (err) {
      // Non-fatal — continue with Firestore update even if storage delete fails
      console.warn('[PhotoDelete] Storage delete failed (continuing):', err);
    }
  };

  const handleAddDogPhoto = async (dogId: string, currentPhotos: string[]) => {
    const remaining = 10 - currentPhotos.length;
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

    const selectedUris = result.assets.map((a) => a.uri).slice(0, remaining);
    setUploadingDogId(dogId);
    setUploadingPhotoCount(selectedUris.length);

    const updatedPhotos = [...currentPhotos];
    for (const uri of selectedUris) {
      try {
        const storagePath = `dogs/${dogId}/${Date.now()}_${Math.random().toString(36).slice(2)}.jpg`;
        const downloadURL = await uploadPhotoToStorage(uri, storagePath);
        updatedPhotos.push(downloadURL);
        await updateDog(dogId, { photoURLs: updatedPhotos.slice(0, 10) });
        setUploadingPhotoCount((prev) => Math.max(0, prev - 1));
        refreshDogs();
      } catch (err: unknown) {
        setUploadingPhotoCount((prev) => Math.max(0, prev - 1));
        const msg = err instanceof Error ? err.message : 'An unexpected error occurred.';
        console.error('[PhotoUpload] handleAddDogPhoto error:', err);
        Alert.alert('Upload Failed', msg);
      }
    }
    setUploadingDogId(null);
    setUploadingPhotoCount(0);
  };

  // ─── Photo Action Sheet ───────────────────────────────────────────────────

  /** Opens iOS-style action sheet on photo tap. */
  const handlePhotoActionSheet = (dog: Dog, index: number) => {
    Alert.alert('Manage Photo', '', [
      {
        text: '\u2702\ufe0f Crop Photo',
        onPress: () => { void handleCropPhoto(dog, index); },
      },
      {
        text: '\ud83d\udcf7 Replace Photo',
        onPress: () => { void handleReplacePhoto(dog, index); },
      },
      {
        text: '\ud83d\uddd1\ufe0f Delete Photo',
        style: 'destructive',
        onPress: () => handleDeletePhotoBadge(dog, index),
      },
      { text: 'Cancel', style: 'cancel' },
    ]);
  };

  /**
   * Crop Photo: pick a new image with cropping, upload and replace at index.
   * React Native cannot re-crop an existing remote URL, so we let the user
   * pick a new version and crop it (Hinge/Bumble pattern).
   */
  const handleCropPhoto = async (dog: Dog, index: number) => {
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: 'images',
      allowsEditing: true,
      aspect: [1, 1] as [number, number],
      quality: 0.8,
    });
    if (result.canceled || !result.assets[0]) return;
    setUploadingDogId(dog.id);
    try {
      const uri = result.assets[0].uri;
      const storagePath = `dogs/${dog.id}/${Date.now()}.jpg`;
      const downloadURL = await uploadPhotoToStorage(uri, storagePath);
      // Best-effort: delete old photo from storage
      await deletePhotoFromStorage(dog.photoURLs[index]);
      const newPhotos = [...dog.photoURLs];
      newPhotos[index] = downloadURL;
      await updateDog(dog.id, { photoURLs: newPhotos });
      refreshDogs();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'An unexpected error occurred.';
      console.error('[PhotoUpload] handleCropPhoto error:', err);
      Alert.alert('Upload Failed', msg);
    } finally {
      setUploadingDogId(null);
    }
  };

  /**
   * Replace Photo: same flow as crop — picker with editing, upload, replace at index.
   */
  const handleReplacePhoto = async (dog: Dog, index: number) => {
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: 'images',
      allowsEditing: true,
      aspect: [1, 1] as [number, number],
      quality: 0.8,
    });
    if (result.canceled || !result.assets[0]) return;
    setUploadingDogId(dog.id);
    try {
      const uri = result.assets[0].uri;
      const storagePath = `dogs/${dog.id}/${Date.now()}.jpg`;
      const downloadURL = await uploadPhotoToStorage(uri, storagePath);
      // Best-effort: delete old photo from storage
      await deletePhotoFromStorage(dog.photoURLs[index]);
      const newPhotos = [...dog.photoURLs];
      newPhotos[index] = downloadURL;
      await updateDog(dog.id, { photoURLs: newPhotos });
      refreshDogs();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'An unexpected error occurred.';
      console.error('[PhotoUpload] handleReplacePhoto error:', err);
      Alert.alert('Upload Failed', msg);
    } finally {
      setUploadingDogId(null);
    }
  };

  // ─── Delete Photo (X badge + action sheet Delete option) ─────────────────

  /** Shows confirmation alert before deleting a photo (called from X badge and action sheet). */
  const handleDeleteDog = (dogId: string, dogName: string) => {
    Alert.alert(
      'Delete Dog',
      `Are you sure you want to remove ${dogName}? This cannot be undone.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: async () => {
            try {
              await deleteDog(dogId);
              await refreshDogs();
              Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
            } catch (e: unknown) {
              Alert.alert('Error', e instanceof Error ? e.message : 'Failed to delete dog');
            }
          },
        },
      ],
    );
  };

  const handleDeletePhotoBadge = (dog: Dog, index: number) => {
    Alert.alert(
      'Remove Photo',
      'Are you sure you want to remove this photo?',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: () => { void handleRemoveDogPhotoConfirmed(dog.id, dog.photoURLs, index); },
        },
      ],
    );
  };

  /** Performs the actual Storage + Firestore delete after confirmation. */
  const handleRemoveDogPhotoConfirmed = async (
    dogId: string,
    currentPhotos: string[],
    index: number,
  ) => {
    const photoURL = currentPhotos[index];
    const newPhotos = currentPhotos.filter((_, i) => i !== index);
    setUploadingDogId(dogId);
    try {
      // Delete from Firebase Storage (best-effort)
      await deletePhotoFromStorage(photoURL);
      // Remove URL from Firestore photoURLs array
      await updateDog(dogId, { photoURLs: newPhotos });
      refreshDogs();
    } catch {
      Alert.alert('Error', 'Failed to remove photo.');
    } finally {
      setUploadingDogId(null);
    }
  };

  const handleSignOut = () => {
    Alert.alert('Sign Out', 'Are you sure?', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Sign Out', style: 'destructive', onPress: () => signOut() },
    ]);
  };

  const handleCommunityStandards = () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    navigation.navigate('CommunityStandards');
  };

  const handleMyAgreement = () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    navigation.navigate('MyAgreement');
  };

  const handleInviteFriend = () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    navigation.navigate('Referral');
  };

  if (loading) return <LoadingSpinner />;

  const hasContract = !!userProfile?.contractSignedAt;

  return (
    <ScrollView
      ref={scrollRef}
      onScroll={handleProfileScroll}
      onLayout={onLayout}
      onContentSizeChange={onContentSizeChange}
      scrollEventThrottle={16}
      scrollEnabled={scrollEnabled}
      automaticallyAdjustKeyboardInsets={false}
      keyboardShouldPersistTaps="handled"
      style={[styles.container, { backgroundColor: colors.background }]}
      contentContainerStyle={{ paddingBottom: 16 }}
      bounces={false}
      overScrollMode="never"
    >
      <View style={[styles.header, { backgroundColor: colors.background }]}>

        {/* Name — above pfp */}
        <Text style={[styles.name, { color: colors.text }]} accessibilityRole="header">
          {userProfile?.displayName ?? 'User'}
        </Text>
        {userProfile?.locationName && (
          <Text style={[styles.location, { color: colors.textSecondary }]}>{userProfile.locationName}</Text>
        )}

        {/* Profile picture */}
        <AvatarImage
          photoURL={userProfile?.photoURL}
          displayName={userProfile?.displayName}
          size={90}
          style={styles.avatar}
          emojiSize={36}
          onPress={handleChangeProfilePhoto}
        />

        {/* Instagram — clickable */}
        {userProfile?.instagramHandle ? (
          <TouchableOpacity
            onPress={() => { const h = cleanIgHandle(userProfile.instagramHandle ?? ''); Linking.openURL('https://www.instagram.com/' + h + '/'); }}
            accessibilityLabel={`Instagram: ${userProfile.instagramHandle}`}
            accessibilityRole="link"
          >
            <Text style={[styles.instagramHandle, { color: colors.primary }]}>@{cleanIgHandle(userProfile.instagramHandle ?? '')}</Text>
          </TouchableOpacity>
        ) : null}

        {/* Bio in darker cell */}
        {userProfile?.bio ? (
          <View style={{ backgroundColor: 'rgba(0,0,0,0.35)', borderRadius: 12, padding: 14, marginTop: spacing.sm, width: '100%' }}>
            <Text style={{ fontSize: 16, color: '#FFFFFF', textAlign: 'center' }}>{userProfile.bio}</Text>
          </View>
        ) : null}

        {/* Points + Reviews — side by side below bio */}
        <View style={{ flexDirection: 'row', marginTop: spacing.sm, width: '100%', gap: 10 }}>
          {/* Points box */}
          <TouchableOpacity
            style={{ flex: 1, backgroundColor: colors.backgroundElevated, borderWidth: StyleSheet.hairlineWidth, borderColor: colors.border, borderRadius: 12, padding: 14, alignItems: 'center', justifyContent: 'center', ...shadow.sm }}
            onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); navigation.navigate('PointsHistory'); }}
            accessibilityLabel={`${(userProfile?.points ?? 0).toFixed(1)} points. Tap to see history.`}
            accessibilityRole="button"
          >
            <Text style={{ fontSize: 16, color: '#FFFFFF', textDecorationLine: 'underline' }}>
              {(userProfile?.points ?? 0).toFixed(1)} points
            </Text>
          </TouchableOpacity>

          {/* Reviews box — tap to open the layered anonymized reviews breakdown */}
          <TouchableOpacity
            style={{ flex: 1, backgroundColor: colors.backgroundElevated, borderWidth: StyleSheet.hairlineWidth, borderColor: colors.border, borderRadius: 12, padding: 14, alignItems: 'center', justifyContent: 'center', ...shadow.sm }}
            onPress={() => {
              if (!user?.uid) return;
              Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
              navigation.navigate('ReviewsList', { userId: user.uid, displayName: userProfile?.displayName ?? 'User' });
            }}
            accessibilityRole="button"
            accessibilityLabel="View reviews"
          >
            {userProfile?.rating !== undefined && userProfile?.reviewCount ? (
              <View style={{ alignItems: 'center' }}>
                <StarRating rating={Math.round(userProfile?.rating ?? 0)} />
                <Text style={{ fontSize: 14, color: '#FFFFFF', textDecorationLine: 'underline', marginTop: 4 }}>
                  {userProfile?.reviewCount ?? 0} review{(userProfile?.reviewCount ?? 0) !== 1 ? 's' : ''}
                </Text>
              </View>
            ) : (
              <Text style={{ color: colors.textSecondary, fontSize: 15 }}>No reviews yet</Text>
            )}
          </TouchableOpacity>
        </View>

        {/* Edit Profile — not bold, bottom right */}
        <TouchableOpacity
          style={{ alignSelf: 'center', paddingVertical: spacing.xs, marginTop: spacing.sm }}
          onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); navigation.navigate('EditProfile'); }}
          accessibilityLabel="Edit profile"
          accessibilityRole="button"
        >
          <Text style={{ fontSize: 15, color: '#FFFFFF', textDecorationLine: 'underline' }}>Edit Profile</Text>
        </TouchableOpacity>
      </View>



      <View style={[styles.section, { backgroundColor: colors.surface }]}>
        {/* View my profile — above dogs */}
        {user && (
          <TouchableOpacity
            onPress={() => {
              Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
              navigation.navigate('UserDetail', { userId: user.uid });
            }}
            style={[styles.viewMyProfileBtn, { backgroundColor: colors.primary }]}
            accessibilityLabel="View my profile"
            accessibilityRole="link"
          >
            <Text style={styles.viewMyProfileBtnText}>View my profile</Text>
          </TouchableOpacity>
        )}
        <Text style={[styles.sectionTitle, { color: colors.text }]}>My Dogs</Text>
        {dogs.map((dog) => {
          const isExpanded = expandedDogId === dog.id;
          const draft = dogDrafts[dog.id] ?? draftFromDog(dog);
          const dirty = isDogDraftDirty(dog, draft);
          const saving = savingDogId === dog.id;

          return (
          <View key={dog.id} style={[styles.dogCard, { backgroundColor: colors.backgroundElevated, borderWidth: StyleSheet.hairlineWidth, borderColor: colors.border, ...shadow.sm }]}>

            {/* X button to delete dog */}
            <TouchableOpacity
              onPress={() => handleDeleteDog(dog.id, dog.name)}
              style={styles.dogCardDeleteX}
              hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
              accessibilityLabel={`Remove ${dog.name}`}
              accessibilityRole="button"
            >
              <Text style={styles.dogCardDeleteXText}>✕</Text>
            </TouchableOpacity>
            <View>
              <View style={{ flexDirection: 'row', alignItems: 'baseline', paddingRight: 28 }}>
                <Text style={[styles.dogName, { color: colors.text }]}>{dog.name}</Text>
                <Text style={[styles.dogBreed, { color: colors.textSecondary, marginLeft: 8 }]}>{dog.breed} {'\u2022'} {formatDogAge(dog.ageYears, dog.ageMonths)}{dog.weightLbs > 0 ? ` • ${dog.weightLbs} lbs` : ''}</Text>
              </View>
            </View>

            {/* Photo gallery grid — draggable reorder */}
            <View style={{ marginTop: 14 }} />
            <DraggablePhotoGrid
              photos={dog.photoURLs}
              onReorder={(newPhotos) => { void updateDog(dog.id, { photoURLs: newPhotos }); }}
              onDelete={(idx) => {
                Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                handleDeletePhotoBadge(dog, idx);
              }}
              onAdd={() => { void handleAddDogPhoto(dog.id, dog.photoURLs); }}
              maxPhotos={10}
              uploading={uploadingDogId === dog.id}
              loadingCount={uploadingDogId === dog.id ? uploadingPhotoCount : 0}
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

            {/* Reorder hint — bottom right */}
            <Text style={{ fontSize: 13, color: colors.textSecondary, fontStyle: 'italic', alignSelf: 'flex-end', marginTop: 6 }}>
              * Hold & drag to reorder
            </Text>

            <TouchableOpacity
              onPress={() => toggleDogDetails(dog)}
              style={styles.expandDetailsBtn}
              accessibilityRole="button"
              accessibilityLabel={`${isExpanded ? 'Collapse' : 'Expand'} ${dog.name}'s details`}
              accessibilityState={{ expanded: isExpanded }}
            >
              <Text style={[styles.expandDetailsBtnText, { color: colors.primary }]}>
                {isExpanded ? 'Collapse ˅' : 'Expand >'}
              </Text>
            </TouchableOpacity>

            {isExpanded && (
              <View
                ref={(node) => { dogDetailRefs.current[dog.id] = node; }}
                onLayout={() => measureDogDetails(dog.id)}
                style={[styles.inlineDogDetails, dirty && { paddingTop: spacing.md + STICKY_SAVE_BANNER_HEIGHT }]}
              >
                {dirty && (
                  <View
                    style={[
                      styles.saveChangesBanner,
                      styles.saveChangesBannerSticky,
                      {
                        backgroundColor: colors.primary,
                        top: getStickySaveBannerTop(dog.id),
                      },
                    ]}
                  >
                    <Text style={styles.saveChangesText}>Unsaved changes</Text>
                    <TouchableOpacity
                      style={styles.saveChangesButton}
                      onPress={() => void handleSaveDogDetails(dog)}
                      disabled={saving}
                      accessibilityRole="button"
                      accessibilityLabel={`Save ${dog.name}'s changes`}
                    >
                      {saving ? (
                        <ActivityIndicator color="#FFFFFF" size="small" />
                      ) : (
                        <Text style={styles.saveChangesButtonText}>Save Changes</Text>
                      )}
                    </TouchableOpacity>
                  </View>
                )}
                <View ref={refFor(`dog-${dog.id}-name`)}>
                  <TextInput
                    style={[styles.inlineInput, { backgroundColor: colors.surface, borderColor: colors.border, color: colors.text }]}
                    value={draft.name}
                    onChangeText={(name) => updateDogDraft(dog.id, { name })}
                    placeholder="Dog name"
                    placeholderTextColor={colors.textSecondary}
                    accessibilityLabel={`${dog.name} name`}
                    returnKeyType="next"
                    onFocus={() => scrollToInput(`dog-${dog.id}-name`)}
                  />
                </View>
                <View ref={refFor(`dog-${dog.id}-breed`)}>
                  <TextInput
                    style={[styles.inlineInput, { backgroundColor: colors.surface, borderColor: colors.border, color: colors.text }]}
                    value={draft.breed}
                    onChangeText={(breed) => updateDogDraft(dog.id, { breed })}
                    placeholder="Breed"
                    placeholderTextColor={colors.textSecondary}
                    accessibilityLabel={`${dog.name} breed`}
                    returnKeyType="done"
                    onFocus={() => scrollToInput(`dog-${dog.id}-breed`)}
                  />
                </View>

                <Text style={[styles.inlineLabel, { color: colors.text }]}>Age</Text>
                <View style={styles.inlineTwoCol}>
                  <View style={styles.inlineFieldGroup}>
                    <Text style={[styles.inlineSubLabel, { color: colors.textSecondary }]}>Years</Text>
                    <View style={styles.stepperRow}>
                      <TouchableOpacity
                        style={[styles.stepperBtn, { backgroundColor: colors.surface, borderColor: colors.border }]}
                        onPress={() => updateDogDraft(dog.id, { ageYears: Math.max(0, draft.ageYears - 1), ageMonths: draft.ageYears - 1 <= 0 ? Math.max(1, draft.ageMonths) : draft.ageMonths })}
                        accessibilityLabel="Decrease years"
                      >
                        <Text style={[styles.stepperBtnText, { color: colors.text }]}>-</Text>
                      </TouchableOpacity>
                      <Text style={[styles.stepperValue, { color: colors.text }]}>{draft.ageYears}</Text>
                      <TouchableOpacity
                        style={[styles.stepperBtn, { backgroundColor: colors.surface, borderColor: colors.border }]}
                        onPress={() => updateDogDraft(dog.id, { ageYears: Math.min(20, draft.ageYears + 1) })}
                        accessibilityLabel="Increase years"
                      >
                        <Text style={[styles.stepperBtnText, { color: colors.text }]}>+</Text>
                      </TouchableOpacity>
                    </View>
                  </View>
                  <View style={styles.inlineFieldGroup}>
                    <Text style={[styles.inlineSubLabel, { color: colors.textSecondary }]}>Months</Text>
                    <View style={styles.stepperRow}>
                      <TouchableOpacity
                        style={[styles.stepperBtn, { backgroundColor: colors.surface, borderColor: colors.border }]}
                        onPress={() => updateDogDraft(dog.id, { ageMonths: Math.max(draft.ageYears === 0 ? 1 : 0, draft.ageMonths - 1) })}
                        accessibilityLabel="Decrease months"
                      >
                        <Text style={[styles.stepperBtnText, { color: colors.text }]}>-</Text>
                      </TouchableOpacity>
                      <Text style={[styles.stepperValue, { color: colors.text }]}>{draft.ageMonths}</Text>
                      <TouchableOpacity
                        style={[styles.stepperBtn, { backgroundColor: colors.surface, borderColor: colors.border }]}
                        onPress={() => updateDogDraft(dog.id, { ageMonths: Math.min(11, draft.ageMonths + 1) })}
                        accessibilityLabel="Increase months"
                      >
                        <Text style={[styles.stepperBtnText, { color: colors.text }]}>+</Text>
                      </TouchableOpacity>
                    </View>
                  </View>
                </View>

                <Text style={[styles.inlineLabel, { color: colors.text }]}>Weight (lbs)</Text>
                <View ref={refFor(`dog-${dog.id}-weight`)}>
                  <TextInput
                    style={[styles.inlineInput, { backgroundColor: colors.surface, borderColor: colors.border, color: colors.text }]}
                    value={draft.weightLbs}
                    onChangeText={(weightLbs) => updateDogDraft(dog.id, { weightLbs: weightLbs.replace(/[^0-9]/g, '') })}
                    placeholder="Estimated weight"
                    placeholderTextColor={colors.textSecondary}
                    keyboardType="number-pad"
                    returnKeyType="done"
                    onFocus={() => scrollToInput(`dog-${dog.id}-weight`)}
                  />
                </View>

                <Text style={[styles.inlineLabel, { color: colors.text }]}>Sex</Text>
                <View style={styles.inlineChipRow}>
                  {([DogSex.male, DogSex.female] as DogSex[]).map((sex) => (
                    <TouchableOpacity
                      key={sex}
                      style={[
                        styles.inlineChip,
                        {
                          borderColor: draft.sex === sex ? colors.primary : colors.border,
                          backgroundColor: draft.sex === sex ? colors.primary + '18' : colors.surface,
                        },
                      ]}
                      onPress={() => updateDogDraft(dog.id, { sex })}
                    >
                      <Text style={[styles.inlineChipText, { color: draft.sex === sex ? colors.primary : colors.textSecondary }]}>{sex}</Text>
                    </TouchableOpacity>
                  ))}
                </View>

                <Text style={[styles.inlineLabel, { color: colors.text }]}>Energy Level</Text>
                <View style={styles.inlineChipRow}>
                  {([EnergyLevel.low, EnergyLevel.moderate, EnergyLevel.high, EnergyLevel.very_high] as EnergyLevel[]).map((energyLevel) => (
                    <TouchableOpacity
                      key={energyLevel}
                      style={[
                        styles.inlineChip,
                        {
                          borderColor: draft.energyLevel === energyLevel ? colors.primary : colors.border,
                          backgroundColor: draft.energyLevel === energyLevel ? colors.primary + '18' : colors.surface,
                        },
                      ]}
                      onPress={() => updateDogDraft(dog.id, { energyLevel })}
                    >
                      <Text style={[styles.inlineChipText, { color: draft.energyLevel === energyLevel ? colors.primary : colors.textSecondary }]}>
                        {energyLevel.replace('_', ' ')}
                      </Text>
                    </TouchableOpacity>
                  ))}
                </View>

                <View style={styles.inlineSwitchRow}>
                  <Text style={[styles.inlineSwitchLabel, { color: colors.text }]}>Good with other dogs</Text>
                  <Switch value={draft.isGoodWithDogs} onValueChange={(isGoodWithDogs) => updateDogDraft(dog.id, { isGoodWithDogs })} trackColor={{ true: colors.primary }} />
                </View>
                <View style={styles.inlineSwitchRow}>
                  <Text style={[styles.inlineSwitchLabel, { color: colors.text }]}>Good with kids</Text>
                  <Switch value={draft.isGoodWithKids} onValueChange={(isGoodWithKids) => updateDogDraft(dog.id, { isGoodWithKids })} trackColor={{ true: colors.primary }} />
                </View>
                <View style={styles.inlineSwitchRow}>
                  <Text style={[styles.inlineSwitchLabel, { color: colors.text }]}>Vaccinated</Text>
                  <Switch value={draft.vaccinated} onValueChange={(vaccinated) => updateDogDraft(dog.id, { vaccinated })} trackColor={{ true: colors.primary }} />
                </View>
                <View style={styles.inlineSwitchRow}>
                  <Text style={[styles.inlineSwitchLabel, { color: colors.text }]}>Potty trained</Text>
                  <Switch value={draft.pottyTrained} onValueChange={(pottyTrained) => updateDogDraft(dog.id, { pottyTrained })} trackColor={{ true: colors.primary }} />
                </View>

                <Text style={[styles.inlineLabel, { color: colors.text }]}>About {draft.name.trim() || dog.name}</Text>
                <View ref={refFor(`dog-${dog.id}-bio`)}>
                  <TextInput
                    style={[styles.inlineInput, styles.inlineBioInput, { backgroundColor: colors.surface, borderColor: colors.border, color: colors.text }]}
                    value={draft.bio}
                    onChangeText={(bio) => updateDogDraft(dog.id, { bio })}
                    placeholder="Personality, quirks, favorite things..."
                    placeholderTextColor={colors.textSecondary}
                    multiline
                    textAlignVertical="top"
                    maxLength={500}
                    onFocus={() => scrollToInput(`dog-${dog.id}-bio`)}
                  />
                </View>

                <TouchableOpacity
                  style={styles.fullDogProfileBtn}
                  onPress={() => navigation.navigate('DogDetail', { dogId: dog.id })}
                  accessibilityRole="button"
                  accessibilityLabel={`Open ${dog.name}'s full dog profile`}
                >
                  <Text style={styles.fullDogProfileBtnText}>Open full dog profile</Text>
                </TouchableOpacity>
              </View>
            )}
          </View>
          );
        })}

        {/* Add Another Dog button */}
        <TouchableOpacity
          style={[styles.addAnotherDogBtn, { borderColor: '#888' }]}
          onPress={() => {
            Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
            navigation.navigate('EditDog', {});
          }}
          accessibilityLabel="Add another dog"
          accessibilityRole="button"
        >
          <Text style={[styles.addAnotherDogBtnText, { color: '#999' }]}>+ Add Another Dog</Text>
        </TouchableOpacity>
      </View>

      <View style={[styles.section, { backgroundColor: colors.surface }]}>
        <Text style={[styles.sectionTitle, { color: colors.text }]}>Referrals</Text>
        <TouchableOpacity
          style={[styles.prefRow, styles.prefRowCard, { backgroundColor: colors.backgroundElevated, borderColor: colors.border, ...shadow.sm }]}
          onPress={handleInviteFriend}
          accessibilityLabel="Invite a Friend"
          accessibilityRole="button"
        >
          <Text style={[styles.prefLabel, { color: colors.text }]}>{'\ud83c\udf81'} Invite a Friend</Text>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
            {referralCount > 0 && (
              <View style={[styles.referralBadge, { backgroundColor: colors.primary }]}>
                <Text style={styles.referralBadgeText}>{referralCount} {referralCount === 1 ? 'referral' : 'referrals'}</Text>
              </View>
            )}
            <Text style={[styles.prefChevron, { color: colors.textSecondary }]}>{'>'}</Text>
          </View>
        </TouchableOpacity>
      </View>

      <View style={[styles.section, { backgroundColor: colors.surface }]}>
        <Text style={[styles.sectionTitle, { color: colors.text }]}>Community</Text>
        <TouchableOpacity
          style={[styles.prefRow, styles.prefRowCard, { backgroundColor: colors.backgroundElevated, borderColor: colors.border, ...shadow.sm }]}
          onPress={handleCommunityStandards}
          accessibilityLabel="View SwapDog Community Standards"
          accessibilityRole="button"
        >
          <Text style={[styles.prefLabel, { color: colors.text }]}>{'\ud83d\udc3e'} Community Standards</Text>
          <Text style={[styles.prefChevron, { color: colors.textSecondary }]}>{'>'}</Text>
        </TouchableOpacity>
        {hasContract && (
          <TouchableOpacity
            style={[styles.prefRow, styles.prefRowCard, { backgroundColor: colors.backgroundElevated, borderColor: colors.border, ...shadow.sm }]}
            onPress={handleMyAgreement}
            accessibilityLabel="View My Membership Agreement"
            accessibilityRole="button"
          >
            <Text style={[styles.prefLabel, { color: colors.text }]}>{'\ud83d\udcdc'} My Agreement</Text>
            <Text style={[styles.prefChevron, { color: colors.textSecondary }]}>{'>'}</Text>
          </TouchableOpacity>
        )}
      </View>



      <TouchableOpacity
        onPress={handleSignOut}
        style={{ alignItems: 'center', marginVertical: 24 }}
        accessibilityLabel="Sign out"
        accessibilityRole="button"
        accessibilityHint="Signs you out of your WatchDog account"
      >
        <Text style={{ color: '#FF0000', fontSize: 17, fontWeight: '600', textDecorationLine: 'underline' }}>Sign Out</Text>
      </TouchableOpacity>
    </ScrollView>
  );
};

const styles = StyleSheet.create({
  container: { flex: 1 },
  header: { alignItems: 'center', padding: spacing.lg },
  avatar: { width: 90, height: 90, borderRadius: 45, marginBottom: spacing.sm },
  name: { ...typography.h2, marginBottom: spacing.xs },
  location: { fontSize: 16, marginBottom: spacing.xs },
  ratingRow: { flexDirection: 'row', alignItems: 'center', marginBottom: spacing.xs },
  ratingCount: { fontSize: 15, marginLeft: spacing.xs },
  bio: { fontSize: 16, textAlign: 'center', marginTop: spacing.sm },
  instagramHandle: { fontSize: 16, textAlign: 'center', marginTop: spacing.xs, fontWeight: '600' },
  pointsBadge: {
    borderWidth: 1.5,
    borderRadius: borderRadius.full,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.xs,
    marginTop: spacing.sm,
    alignItems: 'center',
  },
  pointsBadgeText: { fontSize: 18, fontWeight: '700' },
  editBtn: { paddingVertical: spacing.xs, marginTop: spacing.md },
  editBtnText: { fontWeight: '600', fontSize: 17, color: '#FFFFFF' },
  section: { padding: spacing.lg },
  sectionTitle: { ...typography.h3, marginBottom: spacing.md },
  dogCard: { padding: spacing.md, borderRadius: borderRadius.md, marginBottom: spacing.sm, position: 'relative' as const },
  dogCardDeleteX: { position: 'absolute' as const, top: 8, right: 8, width: 24, height: 24, borderRadius: 12, backgroundColor: 'rgba(255,59,48,0.15)', alignItems: 'center' as const, justifyContent: 'center' as const, zIndex: 2 },
  dogCardDeleteXText: { color: '#FF3B30', fontSize: 16, fontWeight: '600' as const },
  dogName: { fontSize: 18, fontWeight: '700' },
  dogBreed: { fontSize: 15, marginTop: 2 },
  prefRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', padding: spacing.md, borderRadius: borderRadius.md, marginBottom: spacing.sm },
  // Elevated card treatment for tappable pref rows (Invite a Friend, Community Standards, My Agreement).
  prefRowCard: { borderWidth: StyleSheet.hairlineWidth },
  prefLabel: { fontSize: 17 },
  prefValue: { fontSize: 17 },
  prefChevron: { fontSize: 24, fontWeight: '300' },
  referralBadge: {
    borderRadius: 99,
    paddingHorizontal: 10,
    paddingVertical: 3,
  },
  referralBadgeText: { color: '#fff', fontSize: 14, fontWeight: '700' },
  // Dog photo gallery
  dogPhotoGrid: { marginTop: spacing.sm, flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs },
  dogPhotoScroll: { marginBottom: spacing.xs },
  // Outer container — no overflow:hidden so the X badge (top:-6,right:-6) is visible
  dogPhotoThumbContainer: {
    width: 80,
    height: 80,
    marginRight: spacing.xs,
    // zIndex ensures the badge stacks correctly
    zIndex: 0,
  },
  // Inner touch target — overflow:hidden clips the photo corners
  dogPhotoThumbWrap: {
    width: 80,
    height: 80,
    borderRadius: borderRadius.sm,
    overflow: 'hidden',
  },
  dogPhotoThumb: { width: 80, height: 80 },
  // ✎ edit badge — bottom-right of photo
  dogPhotoCropHint: {
    position: 'absolute',
    bottom: 4,
    right: 4,
    width: 24,
    height: 24,
    borderRadius: 12,
    backgroundColor: 'rgba(0,0,0,0.6)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  dogPhotoCropHintText: { color: '#fff', fontSize: 13 },
  // ✕ delete badge — top-right corner, outside the 80x80 bounds
  dogPhotoDeleteBadge: {
    position: 'absolute',
    top: -6,
    right: -6,
    width: 22,
    height: 22,
    borderRadius: 11,
    backgroundColor: 'rgba(0,0,0,0.7)',
    borderWidth: 1.5,
    borderColor: '#666',
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 2,
  },
  dogPhotoDeleteBadgeText: { color: '#fff', fontSize: 14, fontWeight: '700' },
  // "+ Add Photo" dashed tile
  dogPhotoAddTile: {
    width: 80,
    height: 80,
    borderRadius: 12,
    borderWidth: 2,
    borderStyle: 'dashed',
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: spacing.xs,
  },
  dogPhotoAddIcon: { fontSize: 30, fontWeight: '300', lineHeight: 32 },
  dogPhotoAddLabel: { fontSize: 12, marginTop: 2 },
  // Add Another Dog button
  deleteDogBtn: { marginTop: 8, alignSelf: 'flex-end', paddingVertical: 6, paddingHorizontal: 12 },
  deleteDogBtnText: { fontSize: 15, color: '#FF3B30', fontWeight: '600' },
  addAnotherDogBtn: {
    borderWidth: 2,
    borderRadius: borderRadius.full,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.lg,
    alignItems: 'center',
    marginTop: spacing.sm,
  },
  addAnotherDogBtnText: { fontSize: 17, fontWeight: '700' },
  expandDetailsBtn: { alignSelf: 'flex-start', marginTop: spacing.sm, paddingVertical: 6 },
  expandDetailsBtnText: { fontSize: 15, fontWeight: '700' },
  inlineDogDetails: { marginTop: spacing.sm, paddingTop: spacing.md, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: '#444', position: 'relative' as const, overflow: 'hidden' as const },
  fullDogProfileBtn: {
    alignSelf: 'flex-end',
    marginTop: spacing.xs,
    backgroundColor: '#F0C040',
    borderRadius: borderRadius.full,
    paddingVertical: 9,
    paddingHorizontal: spacing.md,
  },
  fullDogProfileBtnText: { color: '#2B2100', fontSize: 14, fontWeight: '800' },
  inlineInput: {
    borderWidth: 1,
    borderRadius: borderRadius.md,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    marginBottom: spacing.md,
    fontSize: 16,
  },
  inlineBioInput: { minHeight: 96, paddingTop: spacing.sm },
  inlineLabel: { fontSize: 16, fontWeight: '700', marginBottom: spacing.sm },
  inlineSubLabel: { fontSize: 14, marginBottom: spacing.xs },
  inlineTwoCol: { flexDirection: 'row', gap: spacing.md, marginBottom: spacing.md },
  inlineFieldGroup: { flex: 1 },
  stepperRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  stepperBtn: {
    width: 32,
    height: 32,
    borderRadius: borderRadius.sm,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  stepperBtnText: { fontSize: 20, lineHeight: 22 },
  stepperValue: { fontSize: 20, fontWeight: '700', minWidth: 28, textAlign: 'center' },
  inlineChipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs, marginBottom: spacing.md },
  inlineChip: {
    borderWidth: 1.5,
    borderRadius: borderRadius.full,
    paddingHorizontal: spacing.md,
    paddingVertical: 7,
  },
  inlineChipText: { fontSize: 15, fontWeight: '700', textTransform: 'capitalize' },
  inlineSwitchRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 10,
  },
  inlineSwitchLabel: { fontSize: 16, fontWeight: '500', flex: 1, paddingRight: spacing.md },
  saveChangesBanner: {
    borderRadius: borderRadius.md,
    padding: spacing.sm,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: spacing.xs,
  },
  saveChangesBannerSticky: {
    position: 'absolute' as const,
    left: 0,
    right: 0,
    zIndex: 5,
    elevation: 5,
    marginTop: 0,
  },
  saveChangesText: { color: '#FFFFFF', fontSize: 15, fontWeight: '700' },
  saveChangesButton: {
    borderWidth: 1,
    borderColor: '#FFFFFF',
    borderRadius: borderRadius.full,
    paddingHorizontal: spacing.md,
    paddingVertical: 7,
    minWidth: 112,
    alignItems: 'center',
  },
  saveChangesButtonText: { color: '#FFFFFF', fontSize: 14, fontWeight: '800' },
  // "View my profile" pill button above the My Dogs section
  viewMyProfileBtn: { alignSelf: 'flex-end', borderRadius: borderRadius.full, paddingVertical: 6, paddingHorizontal: spacing.md, marginBottom: spacing.md },
  viewMyProfileBtnText: { fontSize: 14, fontWeight: '600', color: '#FFFFFF' },
  signOutBtn: { margin: spacing.lg, padding: spacing.md, borderRadius: borderRadius.md, alignItems: 'center' },
  signOutText: { color: '#FF0000', ...typography.button },
});

export default ProfileScreen;
