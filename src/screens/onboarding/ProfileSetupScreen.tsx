import React, { useState } from 'react';
import {
  View, Text, TextInput, TouchableOpacity, StyleSheet, ScrollView, Alert, Image,
  KeyboardAvoidingView, Platform,
} from 'react-native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import * as ImagePicker from 'expo-image-picker';
import { doc, setDoc, serverTimestamp } from 'firebase/firestore';
import * as Haptics from 'expo-haptics';
import { OnboardingStackParamList } from '../../navigation/types';
import { useAuthContext } from '../../contexts/AuthContext';
import { useTheme } from '../../contexts/ThemeContext';
import { db } from '../../config/firebase';
import { spacing, borderRadius, typography } from '../../config/theme';

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
  const { user } = useAuthContext();
  const [displayName, setDisplayName] = useState('');
  const [bio, setBio] = useState('');
  const [instagramHandle, setInstagramHandle] = useState('');
  const [photoURL, setPhotoURL] = useState('');
  const [loading, setLoading] = useState(false);

  const pickImage = async () => {
    Alert.alert(
      'Add Your Profile Photo',
      "This is your dog parent profile photo so be sure to choose a pic of you and not your pup! Don't worry… your dog's photos come next :)",
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
      quality: 0.8,
    });
    if (!result.canceled && result.assets[0]) {
      setPhotoURL(result.assets[0].uri);
    }
  };

  const handleNext = async () => {
    if (!displayName.trim()) { Alert.alert('Required', 'Please enter your name'); return; }
    if (!instagramHandle.trim()) {
      Alert.alert(
        'Reconsider adding your Instagram?',
        "Are you sure you don\u2019t want to add your Instagram? Your IG helps the other dog parents see you\u2019re a real, trustworthy person.",
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
      await setDoc(doc(db, 'users', user.uid), {
        email: user.email,
        displayName: displayName.trim(),
        bio: bio.trim(),
        instagramHandle: cleanIgHandle(instagramHandle) || '',
        photoURL,
        isOnboarded: false,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
      navigation.navigate('AddDog');
    } catch (error: unknown) {
      Alert.alert('Error', error instanceof Error ? error.message : 'Failed to save profile');
    } finally {
      setLoading(false);
    }
  };

  return (
    <KeyboardAvoidingView
      style={{ flex: 1, backgroundColor: colors.background }}
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      keyboardVerticalOffset={Platform.OS === 'ios' ? 90 : 0}
    >
    <ScrollView
      style={[styles.container, { backgroundColor: colors.background }]}
      contentContainerStyle={styles.content}
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
      </TouchableOpacity>

      <TextInput
        style={[styles.input, { backgroundColor: colors.surface, borderColor: colors.border, color: colors.text }]}
        placeholder="Your name"
        placeholderTextColor={colors.textSecondary}
        value={displayName}
        onChangeText={setDisplayName}
        accessibilityLabel="Your display name"
          returnKeyType="next"
          blurOnSubmit={false}
      />
      <TextInput
        style={[styles.input, styles.textArea, { backgroundColor: colors.surface, borderColor: colors.border, color: colors.text }]}
        placeholder="Share your experience with dogs, your lifestyle, and what makes you a great pet sitter..."
        placeholderTextColor={colors.textSecondary}
        value={bio}
        onChangeText={setBio}
        multiline
        numberOfLines={4}
        accessibilityLabel="Bio, optional"
      returnKeyType="done"
              blurOnSubmit={true}
              />
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
      />


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
    </KeyboardAvoidingView>
  );
};

const styles = StyleSheet.create({
  container: { flex: 1 },
  content: { flexGrow: 1, padding: spacing.lg, justifyContent: 'center' },
  title: { ...typography.h2, textAlign: 'center', marginBottom: spacing.xs },
  sub: { ...typography.body, textAlign: 'center', marginBottom: spacing.xl },
  photoPicker: { alignItems: 'center', marginBottom: spacing.lg },
  photo: { width: 90, height: 90, borderRadius: 45, marginBottom: spacing.xs },
  photoPlaceholder: { width: 90, height: 90, borderRadius: 45, justifyContent: 'center', alignItems: 'center', marginBottom: spacing.xs },
  photoPlaceholderText: { fontSize: 32 },
  photoHint: { fontSize: 14, fontWeight: '600' },
  fieldHint: { fontSize: 12, marginTop: 4, marginBottom: 8, paddingHorizontal: 4 },
  input: { borderWidth: 1, borderRadius: borderRadius.md, padding: spacing.md, marginBottom: spacing.md, fontSize: 15 },
  textArea: { height: 100, textAlignVertical: 'top' },
  btn: { padding: spacing.md, borderRadius: borderRadius.md, alignItems: 'center', marginTop: spacing.sm },
  btnText: { color: '#fff', ...typography.button },
});

export default ProfileSetupScreen;
