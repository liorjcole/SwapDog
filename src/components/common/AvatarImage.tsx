import React, { useState } from 'react';
import { Image, View, Text, StyleProp, ViewStyle, ImageStyle, TouchableOpacity } from 'react-native';

/**
 * Avatar that falls back to a 🐶 emoji on a random-ish colored circle
 * when the photo URL is missing, empty, or fails to load.
 */
interface AvatarImageProps {
  photoURL: string | undefined | null;
  displayName?: string;
  size: number;
  style?: StyleProp<ImageStyle>;
  emojiSize?: number;
  onPress?: () => void;
}

const BG_COLORS = ['#FF6B6B','#4ECDC4','#45B7D1','#96CEB4','#FFEAA7','#DDA0DD','#98D8C8','#F7DC6F'];

const AvatarImage: React.FC<AvatarImageProps> = ({ photoURL, displayName, size, style, emojiSize, onPress }) => {
  const [failed, setFailed] = useState(false);
  const hasURL = !!photoURL && photoURL.length > 0 && !failed && !photoURL.startsWith('file://');
  const bgColor = BG_COLORS[(displayName?.length ?? 0) % BG_COLORS.length];
  const emoji = emojiSize ?? Math.round(size * 0.55);

  const imageEl = hasURL ? (
    <Image
      source={{ uri: photoURL }}
      style={[{ width: size, height: size, borderRadius: size / 2 }, style]}
      onError={() => setFailed(true)}
      accessibilityLabel={displayName ? `${displayName}'s photo` : 'Profile photo'}
    />
  ) : (
    <View
      style={[
        { width: size, height: size, borderRadius: size / 2, backgroundColor: bgColor, alignItems: 'center', justifyContent: 'center' },
        style,
      ]}
      accessibilityLabel={displayName ? `${displayName}'s avatar` : 'Avatar'}
    >
      <Text style={{ fontSize: emoji }}>🐶</Text>
    </View>
  );

  if (onPress) {
    return (
      <TouchableOpacity onPress={onPress} activeOpacity={0.7} accessibilityRole="button" accessibilityLabel="Change photo">
        {imageEl}
      </TouchableOpacity>
    );
  }
  return imageEl;
};

export default AvatarImage;
