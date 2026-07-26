import React, { useEffect, useRef, useState } from 'react';
import {
  Animated, View, Text, TextInput, TouchableOpacity, StyleSheet, ScrollView, Alert, Image } from 'react-native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import * as ImagePicker from 'expo-image-picker';
import { doc, setDoc, serverTimestamp } from 'firebase/firestore';
import * as Haptics from 'expo-haptics';
import { OnboardingStackParamList } from '../../navigation/types';
import { useAuthContext } from '../../contexts/AuthContext';
import { useTheme } from '../../contexts/ThemeContext';
import { db } from '../../config/firebase';
import { spacing, borderRadius, typography } from '../../config/theme';
import { useOnboarding } from '../../contexts/OnboardingContext';
import { useKeyboardScroll } from '../../hooks/useKeyboardScroll';
import { ensureRemotePhotoURL } from '../../utils/uploadHelper';
import { validateReferralCode, redeemReferralCode } from '../../hooks/useReferrals';
import AuthVideoBackground from '../../components/auth/AuthVideoBackground';

type Props = {
  navigation: NativeStackNavigationProp<OnboardingStackParamList, 'ProfileSetup'>;
};


/** Extract clean Instagram handle from any format (handle, @handle, full URL) */
const cleanIgHandle = (raw: string): string => {
  const s = raw.trim();
  const urlMatch = s.match(/instagram\.com\/([a-zA-Z0-9_.]+)/);
  if (urlMatch) return urlMatch[1];
  return s.replace(/^@/, '');
};


const ProfileSetupScreen: React.FC<Props> = ({ navigation }) => {
  const { colors } = useTheme();
  const {
    scrollRef,
    onScroll,
    onLayout,
    onContentSizeChange,
    refFor,
    scrollToInput,
    keyboardHeight,
  } = useKeyboardScroll();
  const { user } = useAuthContext();
  const { displayName, setDisplayName, bio, setBio, instagramHandle, setInstagramHandle, photoURL, setPhotoURL } = useOnboarding();
  const [friendReferralCode, setFriendReferralCode] = useState('');
  const [showReferralField, setShowReferralField] = useState(false);
  const [loading, setLoading] = useState(false);
  const backgroundOverlayOpacity = useRef(new Animated.Value(0.38)).current;

  useEffect(() => {
    Animated.timing(backgroundOverlayOpacity, {
      toValue: 0.9,
      duration: 650,
      useNativeDriver: true,
    }).start();
  }, [backgroundOverlayOpacity]);

  /** Track y-offsets of inputs so we can scroll to them on focus */
  // Input scroll handled by useKeyboardScroll hook

  const pickImage = async () => {
    Alert.alert(
      'THIS IS A PHOTO OF YOU!\n(not your pup)',
      `This is your "dog parent" photo, so be sure to choose a pic of you and not your pup! Don’t worry… your dog’s photos come next :)`,
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Choose Photo', onPress: async () => { await openImagePicker(); } },
      ]
    );
  };

  const openImagePicker = async () => {
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      allowsEditing: true,
      aspect: [1, 1],
      quality: 0.8 });
    if (!result.canceled && result.assets[0]) {
      setPhotoURL(result.assets[0].uri);
    }
  };

  const handleNext = async () => {
    if (!displayName.trim()) { Alert.alert('Required', 'Please enter your name'); return; }
    if (!photoURL) {
      Alert.alert('Photo Required', 'Please add a profile photo so other dog parents can see who you are');
      return;
    }
    if (!instagramHandle.trim()) {
      Alert.alert(
        'Reconsider adding your Instagram?',
        "Your IG helps the other dog parents see you're a real, trustworthy person.",
        [
          { text: 'Add Instagram', style: 'cancel' },
          { text: 'Skip', onPress: () => proceedToSave() },
        ]
      );
      return;
    }
    await proceedToSave();
  };

  const proceedToSave = async () => {
    if (!user) return;
    setLoading(true);
    try {
      // Validate + redeem friend's referral code if entered
      let referredBy: string | null = null;
      const trimmedCode = friendReferralCode.trim();
      if (trimmedCode) {
        const codeResult = await validateReferralCode(trimmedCode);
        if (!codeResult) {
          Alert.alert('Invalid Code', 'That referral code is invalid or expired. You can skip this field.');
          setLoading(false);
          return;
        }
        if (codeResult.createdBy === user.uid) {
          Alert.alert('Invalid Code', "You can't use your own referral code!");
          setLoading(false);
          return;
        }
        referredBy = codeResult.createdBy;
        // Redeem the code (increments usage, sets referredBy on user doc)
        await redeemReferralCode(trimmedCode, user.uid);
      }

      // Upload the picked photo to Storage before persisting — never write a
      // local file:// URI to Firestore (it's unreadable from other devices and
      // is the root cause of disappearing profile photos).
      let finalPhotoURL = photoURL;
      if (photoURL && !photoURL.startsWith('http')) {
        try {
          finalPhotoURL = await ensureRemotePhotoURL(photoURL, `users/${user.uid}/profile`);
        } catch (uploadError: unknown) {
          Alert.alert(
            'Upload failed',
            uploadError instanceof Error
              ? uploadError.message
              : 'Could not upload your profile photo. Please try again.'
          );
          setLoading(false);
          return;
        }
      }

      await setDoc(doc(db, 'users', user.uid), {
        displayName: displayName.trim(),
        bio: bio.trim(),
        instagramHandle: cleanIgHandle(instagramHandle) || '',
        photoURL: finalPhotoURL,
        isOnboarded: false,
        ...(referredBy ? { referredBy } : {}),
        updatedAt: serverTimestamp(),
      }, { merge: true });
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
      navigation.navigate('AddDog');
    } catch (error: unknown) {
      Alert.alert('Error', error instanceof Error ? error.message : 'Failed to save profile');
    } finally {
      setLoading(false);
    }
  };

  return (
    <AuthVideoBackground scrimOpacity={backgroundOverlayOpacity}>
    <View style={{ flex: 1, backgroundColor: 'transparent' }}>
    <ScrollView
        ref={scrollRef}
        onScroll={onScroll}
        onLayout={onLayout}
        onContentSizeChange={onContentSizeChange}
        scrollEventThrottle={16}
        automaticallyAdjustKeyboardInsets={false}
        keyboardShouldPersistTaps="handled"
        style={styles.container}
        contentContainerStyle={[styles.content, { paddingBottom: spacing.lg + keyboardHeight }]}
    >
      <Text style={[styles.title, { color: colors.text }]} accessibilityRole="header">Set up your profile</Text>
      <Text style={[styles.sub, { color: colors.textSecondary }]}>Tell the community about yourself and your experience with dogs! This helps the dog parents in your neighborhood feel comfortable trusting you with their pup and excited to look after yours :)</Text>

      <TouchableOpacity
        style={styles.photoPicker}
        onPress={pickImage}
        accessibilityLabel="Upload profile photo"
        accessibilityRole="button"
        accessibilityHint="Opens your photo library to select a profile picture"
      >
        {photoURL ? (
          <Image source={{ uri: photoURL }} style={styles.photo} accessibilityLabel="Selected profile photo" />
        ) : (
          <View style={[styles.photoPlaceholder, { backgroundColor: colors.border }]}>
            <Text style={styles.photoPlaceholderText} accessibilityElementsHidden>📷</Text>
          </View>
        )}
        <Text style={[styles.photoHint, { color: colors.primary }]}>Add Your Profile Photo</Text>
        <Text style={[styles.photoSubHint, { color: colors.textSecondary }]}>
          (This is a photo of YOU not your pup!)
        </Text>
      </TouchableOpacity>

      <View ref={refFor('name')}>
        <TextInput
          style={[styles.input, { backgroundColor: colors.surface, borderColor: colors.border, color: colors.text }]}
          placeholder="Your name"
          placeholderTextColor={colors.textSecondary}
          value={displayName}
          onChangeText={setDisplayName}
          accessibilityLabel="Your display name"
          returnKeyType="done"
          onFocus={() => scrollToInput('name')}
        />
      </View>
      <View ref={refFor('bio')}>
        <TextInput
          style={[styles.input, styles.textArea, { backgroundColor: colors.surface, borderColor: colors.border, color: colors.text }]}
          placeholder="Tell the community about yourself (why someone should trust you with their pup and why they'd like you to look after theirs!)"
          placeholderTextColor={colors.textSecondary}
          value={bio}
          onChangeText={setBio}
          multiline
          numberOfLines={4}
          returnKeyType="done"
          blurOnSubmit={true}
          autoCorrect={true}
          spellCheck={true}
          autoCapitalize="sentences"
          textContentType="none"
          accessibilityLabel="Bio, optional"
          onFocus={() => scrollToInput('bio')}
        />
      </View>
      <View ref={refFor('ig')}>
        <TextInput
          style={[styles.input, { backgroundColor: colors.surface, borderColor: colors.border, color: colors.text }]}
          placeholder="@yourinstagram (optional)"
          placeholderTextColor={colors.textSecondary}
          value={instagramHandle}
          onChangeText={setInstagramHandle}
          autoCapitalize="none"
          autoCorrect={false}
          accessibilityLabel="Instagram handle, optional"
          returnKeyType="done"
          onFocus={() => scrollToInput('ig')}
        />
      </View>

      <TouchableOpacity
        onPress={() => setShowReferralField(!showReferralField)}
        style={styles.referralLink}
        accessibilityLabel={showReferralField ? 'Hide referral code field' : 'Tap to enter a referral code'}
        accessibilityRole="button"
      >
        <Text style={[styles.referralLinkText, { color: colors.textSecondary }]}>
          Referred by a friend? Tap to add their code
        </Text>
      </TouchableOpacity>
      {showReferralField && (
        <View ref={refFor('referral')}>
          <TextInput
            style={[styles.input, { backgroundColor: colors.surface, borderColor: colors.border, color: colors.text }]}
            placeholder="Paste referral code"
            placeholderTextColor={colors.textSecondary}
            value={friendReferralCode}
            onChangeText={(t) => setFriendReferralCode(t.toUpperCase())}
            autoCapitalize="characters"
            autoCorrect={false}
            autoFocus
            accessibilityLabel="Referral code from a friend"
            returnKeyType="done"
            blurOnSubmit={true}
            onFocus={() => scrollToInput('referral')}
          />
        </View>
      )}

      <TouchableOpacity
        style={[styles.btn, { backgroundColor: colors.primary, opacity: loading ? 0.7 : 1 }]}
        onPress={handleNext}
        disabled={loading}
        accessibilityLabel={loading ? 'Saving...' : 'Next step'}
        accessibilityRole="button"
      >
        <Text style={styles.btnText}>{loading ? 'Saving...' : 'Next →'}</Text>
      </TouchableOpacity>
    </ScrollView>



</View>
    </AuthVideoBackground>
  );
};

const styles = StyleSheet.create({
  container: { flex: 1 },
  content: { flexGrow: 1, padding: spacing.lg, paddingTop: spacing.lg },
  title: { ...typography.h2, textAlign: 'center', marginBottom: spacing.sm },
  sub: { ...typography.body, textAlign: 'center', marginBottom: spacing.xl },
  photoPicker: { alignItems: 'center', marginBottom: spacing.lg },
  photo: { width: 90, height: 90, borderRadius: 45, marginBottom: spacing.xs },
  photoPlaceholder: { width: 90, height: 90, borderRadius: 45, justifyContent: 'center', alignItems: 'center', marginBottom: spacing.xs },
  photoPlaceholderText: { fontSize: 34 },
  photoHint: { fontSize: 16, fontWeight: '600' },
  photoSubHint: { fontSize: 14, fontWeight: '600', marginTop: 4, textAlign: 'center' },
  fieldHint: { fontSize: 14, marginTop: 4, marginBottom: 8, paddingHorizontal: 4 },
  input: { borderWidth: 1, borderRadius: borderRadius.md, padding: spacing.md, marginBottom: spacing.md, fontSize: 17 },
  textArea: { minHeight: 140, textAlignVertical: 'top', paddingTop: spacing.sm },
  referralLink: { alignSelf: 'center', paddingVertical: spacing.sm, marginBottom: spacing.md },
  referralLinkText: { fontSize: 16, textDecorationLine: 'underline' },
  btn: { padding: spacing.md, borderRadius: borderRadius.md, alignItems: 'center', marginTop: spacing.sm },
  btnText: { color: '#fff', ...typography.button },


});

export default ProfileSetupScreen;
