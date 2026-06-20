import React, { useState } from 'react';
import {
  View, Text, TextInput, TouchableOpacity, StyleSheet, ScrollView, Alert, Image, Platform, Linking, InputAccessoryView, Keyboard } from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import * as Haptics from 'expo-haptics';
import { useAuthContext } from '../../contexts/AuthContext';
import { useTheme } from '../../contexts/ThemeContext';
import { useKeyboardScroll } from '../../hooks/useKeyboardScroll';
import { useUsers } from '../../hooks/useUsers';
import { spacing, borderRadius, typography } from '../../config/theme';


/** Extract clean Instagram handle from any format (handle, @handle, full URL) */
const cleanIgHandle = (raw: string): string => {
  const s = raw.trim();
  const urlMatch = s.match(/instagram\.com\/([a-zA-Z0-9_.]+)/);
  if (urlMatch) return urlMatch[1];
  return s.replace(/^@/, '');
};

const EditProfileScreen: React.FC<{ navigation: { goBack: () => void } }> = ({ navigation }) => {
  const { colors } = useTheme();
  const { scrollRef, onScroll, refFor, scrollToInput } = useKeyboardScroll();
  const { user, userProfile, refreshUserProfile } = useAuthContext();
  const { updateUser } = useUsers();
  const [displayName, setDisplayName] = useState(userProfile?.displayName ?? '');
  const [bio, setBio] = useState(userProfile?.bio ?? '');
  const [instagramHandle, setInstagramHandle] = useState(userProfile?.instagramHandle ?? '');
  const [photoURL, setPhotoURL] = useState(userProfile?.photoURL ?? '');
  const [loading, setLoading] = useState(false);

  const pickImage = async () => {
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      allowsEditing: true,
      aspect: [1, 1],
      quality: 0.8 });
    if (!result.canceled && result.assets[0]) {
      setPhotoURL(result.assets[0].uri);
    }
  };

  const handleSave = async () => {
    if (!displayName.trim()) { Alert.alert('Required', 'Name cannot be empty'); return; }
    if (!user) return;
    setLoading(true);
    try {
      await updateUser(user.uid, { displayName: displayName.trim(), bio: bio.trim(), instagramHandle: cleanIgHandle(instagramHandle) || '', photoURL });
      await refreshUserProfile();
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      navigation.goBack();
    } catch (error: unknown) {
      Alert.alert('Error', error instanceof Error ? error.message : 'Failed to update profile');
    } finally {
      setLoading(false);
    }
  };

  return (
    <>
    <View style={{ flex: 1, backgroundColor: colors.background }}>
    <ScrollView
        ref={scrollRef}
        onScroll={onScroll}
        scrollEventThrottle={16}
        automaticallyAdjustKeyboardInsets={true} style={[styles.container, { backgroundColor: colors.background }]} contentContainerStyle={styles.content}>
      <TouchableOpacity
        style={styles.photoPicker}
        onPress={pickImage}
        accessibilityLabel="Change profile photo"
        accessibilityRole="button"
      >
        <Image
          source={photoURL ? { uri: photoURL } : require('../../../assets/icon.png')}
          style={styles.photo}
          accessibilityLabel="Profile photo"
        />
        <Text style={[styles.changePhoto, { color: colors.primary }]}>Change Photo</Text>
      </TouchableOpacity>
      <View ref={refFor('name')}>
        <TextInput
          style={[styles.input, { backgroundColor: colors.surface, borderColor: colors.border, color: colors.text }]}
          placeholder="Display name"
          placeholderTextColor={colors.textSecondary}
          value={displayName}
          onChangeText={setDisplayName}
          accessibilityLabel="Display name"
          returnKeyType="next"
          blurOnSubmit={false}
          onFocus={() => scrollToInput('name')}
        />
      </View>
      <View ref={refFor('bio')}>
        <TextInput
          style={[styles.input, styles.textArea, { backgroundColor: colors.surface, borderColor: colors.border, color: colors.text }]}
          placeholder="Share your experience with dogs, your lifestyle, and what makes you a great pet sitter..."
          placeholderTextColor={colors.textSecondary}
          value={bio}
          onChangeText={setBio}
          multiline
          numberOfLines={4}
          accessibilityLabel="Bio"
          returnKeyType="done"
          blurOnSubmit={true}
          onFocus={() => scrollToInput('bio')}
          inputAccessoryViewID="bioDoneBar"
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
        <Text style={[styles.fieldHint, { color: colors.textSecondary }]}>Visible on your profile</Text>
      </View>
      <TouchableOpacity
        style={[styles.btn, { backgroundColor: colors.primary, opacity: loading ? 0.7 : 1 }]}
        onPress={handleSave}
        disabled={loading}
        accessibilityLabel={loading ? 'Saving...' : 'Save changes'}
        accessibilityRole="button"
      >
        <Text style={styles.btnText}>{loading ? 'Saving...' : 'Save Changes'}</Text>
      </TouchableOpacity>
    </ScrollView>


    </View>
    {Platform.OS === 'ios' && (
      <InputAccessoryView nativeID="bioDoneBar">
        <View style={styles.kbToolbar}>
          <View style={{ flex: 1 }} />
          <TouchableOpacity onPress={() => Keyboard.dismiss()} style={styles.kbDoneBtn}>
            <Text style={styles.kbDoneText}>Done</Text>
          </TouchableOpacity>
        </View>
      </InputAccessoryView>
    )}
    </>
  );
};

const styles = StyleSheet.create({
  container: { flex: 1 },
  content: { padding: spacing.lg },
  photoPicker: { alignItems: 'center', marginBottom: spacing.lg },
  photo: { width: 90, height: 90, borderRadius: 45, marginBottom: spacing.xs },
  changePhoto: { fontSize: 14, fontWeight: '600' },
  fieldHint: { fontSize: 12, marginTop: 4, marginBottom: 4, paddingHorizontal: 4 },
  input: { borderWidth: 1, borderRadius: borderRadius.md, padding: spacing.md, marginBottom: spacing.md, fontSize: 15 },
  textArea: { minHeight: 100, textAlignVertical: 'top' },
  btn: { padding: spacing.md, borderRadius: borderRadius.md, alignItems: 'center' },
  btnText: { color: '#fff', ...typography.button },
  keyboardBar: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#F0F0F0',
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: '#C8C8C8',
    paddingHorizontal: 12,
    paddingVertical: 6,
  },
  keyboardDoneBtn: {
    backgroundColor: '#007AFF',
    width: 32,
    height: 32,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
  },
  keyboardDoneText: {
    color: '#fff',
    fontSize: 18,
    fontWeight: '700',
  },
  kbToolbar: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: '#8E8E93',
    backgroundColor: '#D1D5DB',
  },
  kbDoneBtn: {
    paddingHorizontal: 12,
    paddingVertical: 6,
  },
  kbDoneText: {
    color: '#007AFF',
    fontSize: 17,
    fontWeight: '600',
  },
});

export default EditProfileScreen;
