import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  View, Text, TouchableOpacity, StyleSheet, ScrollView, Image, Alert,
  ActivityIndicator, Linking, Keyboard,
} from 'react-native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useFocusEffect } from '@react-navigation/native';
import * as Haptics from 'expo-haptics';
import { uploadPhotoToStorage } from '../../utils/uploadHelper';
import * as ImagePicker from 'expo-image-picker';
import { auth } from '../../config/firebase';
import { ProfileStackParamList } from '../../navigation/types';
import { useAuthContext } from '../../contexts/AuthContext';
import { useTheme } from '../../contexts/ThemeContext';
import AvatarImage from '../../components/common/AvatarImage';
import { useAuth } from '../../hooks/useAuth';
import { useDogs } from '../../hooks/useDogs';
import { getReferralCount } from '../../hooks/useReferrals';
import { Dog } from '../../models/types';
import { spacing, borderRadius, typography, shadow } from '../../config/theme';
import { formatDogAge } from '../../utils/formatDogAge';
import LoadingSpinner from '../../components/common/LoadingSpinner';
import { DraggablePhotoGrid } from '../../components/common/DraggablePhotoGrid';
import StarRating from '../../components/common/StarRating';

type Props = {
  navigation: NativeStackNavigationProp<ProfileStackParamList, 'Profile'>;
};

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
  const [dogs, setDogs] = useState<Dog[]>([]);
  const [loading, setLoading] = useState(true);
  const [referralCount, setReferralCount] = useState(0);
  const [uploadingDogId, setUploadingDogId] = useState<string | null>(null);
  const [uploadingPhotoCount, setUploadingPhotoCount] = useState(0);
  const [scrollEnabled, setScrollEnabled] = useState(true);

  useEffect(() => {
    if (!user) return;
    getDogsByOwner(user.uid).then(setDogs).finally(() => setLoading(false));
    getReferralCount(user.uid).then(setReferralCount);
  }, [user]);

  const refreshDogs = () => {
    if (!user) return;
    getDogsByOwner(user.uid).then(setDogs);
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
      const downloadURL = await uploadPhotoToStorage(uri, `users/${user.uid}/profile`);
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
    <ScrollView scrollEnabled={scrollEnabled} style={[styles.container, { backgroundColor: colors.background }]}>
      <View style={[styles.header, { backgroundColor: colors.surface }]}>
        <AvatarImage
          photoURL={userProfile?.photoURL}
          displayName={userProfile?.displayName}
          size={90}
          style={styles.avatar}
          emojiSize={36}
          onPress={handleChangeProfilePhoto}
        />
        <Text style={[styles.name, { color: colors.text }]} accessibilityRole="header">
          {userProfile?.displayName ?? 'User'}
        </Text>
        {userProfile?.locationName && (
          <Text style={[styles.location, { color: colors.textSecondary }]}>{userProfile.locationName}</Text>
        )}
        {userProfile?.instagramHandle ? (
          <TouchableOpacity
            onPress={() => { const h = cleanIgHandle(userProfile.instagramHandle ?? ''); Linking.openURL('https://www.instagram.com/' + h + '/'); }}
            accessibilityLabel={`Instagram: ${userProfile.instagramHandle}`}
            accessibilityRole="link"
          >
            <Text style={[styles.instagramHandle, { color: colors.primary }]}>@{cleanIgHandle(userProfile.instagramHandle ?? '')}</Text>
          </TouchableOpacity>
        ) : null}
        <View style={styles.ratingRow}>
          {userProfile?.rating !== undefined && userProfile?.reviewCount ? (
            <>
              <StarRating rating={Math.round(userProfile?.rating ?? 0)} />
              <Text style={[styles.ratingCount, { color: colors.textSecondary }]}>({userProfile?.reviewCount ?? 0} review{(userProfile?.reviewCount ?? 0) !== 1 ? 's' : ''})</Text>
            </>
          ) : (
            <Text style={{ color: colors.textSecondary, fontSize: 13 }}>No reviews yet</Text>
          )}
        </View>
        {userProfile?.bio && <Text style={[styles.bio, { color: colors.textSecondary }]}>{userProfile.bio}</Text>}


        {/* SUB-TASK 3: Points badge — tappable → PointsHistory */}
        <TouchableOpacity
          style={[styles.pointsBadge, { backgroundColor: colors.primary + '18', borderColor: colors.primary }]}
          onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); navigation.navigate('PointsHistory'); }}
          accessibilityLabel={`${(userProfile?.points ?? 0).toFixed(1)} points. Tap to see history.`}
          accessibilityRole="button"
        >
          <Text style={[styles.pointsBadgeText, { color: '#FFFFFF' }]}>
            {(userProfile?.points ?? 0).toFixed(1)} points {'>'}
          </Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={styles.editBtn}
          onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); navigation.navigate('EditProfile'); }}
          accessibilityLabel="Edit profile"
          accessibilityRole="button"
        >
          <Text style={styles.editBtnText}>Edit Profile</Text>
        </TouchableOpacity>
      </View>

      {/* View my profile as others see it */}
      {user && (
        <TouchableOpacity
          onPress={() => {
            Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
            navigation.navigate('UserDetail', { userId: user.uid });
          }}
          style={{ paddingHorizontal: spacing.lg, paddingTop: spacing.md, paddingBottom: spacing.xs }}
          accessibilityLabel="View my profile"
          accessibilityRole="link"
        >
          <Text style={{ fontSize: 15, color: colors.primary, textDecorationLine: 'underline', fontWeight: '600' }}>
            View my profile
          </Text>
        </TouchableOpacity>
      )}

      <View style={styles.section}>
        <Text style={[styles.sectionTitle, { color: colors.text }]}>My Dogs</Text>
        {dogs.map((dog) => (
          <View key={dog.id} style={[styles.dogCard, { backgroundColor: colors.surface, ...shadow.sm }]}>
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
            {/* Info row — tap to edit */}
            <TouchableOpacity
              onPress={() => navigation.navigate('EditDog', { dogId: dog.id })}
              accessibilityLabel={`${dog.name}, ${dog.breed}. Tap to edit.`}
              accessibilityRole="button"
            >
              <Text style={[styles.dogName, { color: colors.text }]}>{dog.name}</Text>
              <Text style={[styles.dogBreed, { color: colors.textSecondary }]}>{dog.breed} {'\u2022'} {formatDogAge(dog.ageYears, dog.ageMonths)}</Text>
            </TouchableOpacity>

            {/* Photo gallery grid — draggable reorder */}
            <Text style={{ fontSize: 11, color: colors.textSecondary, marginTop: 4, marginBottom: 6, fontStyle: 'italic' }}>
              Hold & drag to reorder. First photo is primary.
            </Text>
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


          </View>
        ))}

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

      <View style={styles.section}>
        <Text style={[styles.sectionTitle, { color: colors.text }]}>Referrals</Text>
        <TouchableOpacity
          style={[styles.prefRow, { backgroundColor: colors.surface, ...shadow.sm }]}
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

      <View style={styles.section}>
        <Text style={[styles.sectionTitle, { color: colors.text }]}>Community</Text>
        <TouchableOpacity
          style={[styles.prefRow, { backgroundColor: colors.surface, ...shadow.sm }]}
          onPress={handleCommunityStandards}
          accessibilityLabel="View SwapDog Community Standards"
          accessibilityRole="button"
        >
          <Text style={[styles.prefLabel, { color: colors.text }]}>{'\ud83d\udc3e'} Community Standards</Text>
          <Text style={[styles.prefChevron, { color: colors.textSecondary }]}>{'>'}</Text>
        </TouchableOpacity>
        {hasContract && (
          <TouchableOpacity
            style={[styles.prefRow, { backgroundColor: colors.surface, ...shadow.sm }]}
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
        <Text style={{ color: '#FF0000', fontSize: 15, fontWeight: '600', textDecorationLine: 'underline' }}>Sign Out</Text>
      </TouchableOpacity>
    </ScrollView>
  );
};

const styles = StyleSheet.create({
  container: { flex: 1 },
  header: { alignItems: 'center', padding: spacing.lg },
  avatar: { width: 90, height: 90, borderRadius: 45, marginBottom: spacing.sm },
  name: { ...typography.h2, marginBottom: spacing.xs },
  location: { fontSize: 14, marginBottom: spacing.xs },
  ratingRow: { flexDirection: 'row', alignItems: 'center', marginBottom: spacing.xs },
  ratingCount: { fontSize: 13, marginLeft: spacing.xs },
  bio: { fontSize: 14, textAlign: 'center', marginTop: spacing.sm },
  instagramHandle: { fontSize: 14, textAlign: 'center', marginTop: spacing.xs, fontWeight: '600' },
  pointsBadge: {
    borderWidth: 1.5,
    borderRadius: borderRadius.full,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.xs,
    marginTop: spacing.sm,
    alignItems: 'center',
  },
  pointsBadgeText: { fontSize: 16, fontWeight: '700' },
  editBtn: { paddingVertical: spacing.xs, marginTop: spacing.md },
  editBtnText: { fontWeight: '600', fontSize: 15, color: '#FFFFFF' },
  section: { padding: spacing.lg },
  sectionTitle: { ...typography.h3, marginBottom: spacing.md },
  dogCard: { padding: spacing.md, borderRadius: borderRadius.md, marginBottom: spacing.sm, position: 'relative' as const },
  dogCardDeleteX: { position: 'absolute' as const, top: 8, right: 8, width: 24, height: 24, borderRadius: 12, backgroundColor: 'rgba(255,59,48,0.15)', alignItems: 'center' as const, justifyContent: 'center' as const, zIndex: 2 },
  dogCardDeleteXText: { color: '#FF3B30', fontSize: 14, fontWeight: '600' as const },
  dogName: { fontSize: 16, fontWeight: '700' },
  dogBreed: { fontSize: 13, marginTop: 2 },
  prefRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', padding: spacing.md, borderRadius: borderRadius.md, marginBottom: spacing.sm },
  prefLabel: { fontSize: 15 },
  prefValue: { fontSize: 15 },
  prefChevron: { fontSize: 22, fontWeight: '300' },
  referralBadge: {
    borderRadius: 99,
    paddingHorizontal: 10,
    paddingVertical: 3,
  },
  referralBadgeText: { color: '#fff', fontSize: 12, fontWeight: '700' },
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
  dogPhotoCropHintText: { color: '#fff', fontSize: 11 },
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
  dogPhotoDeleteBadgeText: { color: '#fff', fontSize: 12, fontWeight: '700' },
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
  dogPhotoAddIcon: { fontSize: 28, fontWeight: '300', lineHeight: 32 },
  dogPhotoAddLabel: { fontSize: 10, marginTop: 2 },
  // Add Another Dog button
  deleteDogBtn: { marginTop: 8, alignSelf: 'flex-end', paddingVertical: 6, paddingHorizontal: 12 },
  deleteDogBtnText: { fontSize: 13, color: '#FF3B30', fontWeight: '600' },
  addAnotherDogBtn: {
    borderWidth: 2,
    borderRadius: borderRadius.full,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.lg,
    alignItems: 'center',
    marginTop: spacing.sm,
  },
  addAnotherDogBtnText: { fontSize: 15, fontWeight: '700' },
  signOutBtn: { margin: spacing.lg, padding: spacing.md, borderRadius: borderRadius.md, alignItems: 'center' },
  signOutText: { color: '#FF0000', ...typography.button },
});

export default ProfileScreen;
