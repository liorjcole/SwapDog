import React, { useState, useEffect, useRef } from 'react';
import { Image, View, Text, StyleProp, ViewStyle, ImageStyle, TouchableOpacity } from 'react-native';

/**
 * Avatar that falls back to a 🐶 emoji on a random-ish colored circle
 * when the photo URL is missing, empty, or fails to load.
 *
 * Auto-retries up to 3 times with increasing delay if the image fails
 * (covers transient CDN/network blips that caused permanent emoji fallback).
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
const MAX_RETRIES = 3;

const AvatarImage: React.FC<AvatarImageProps> = ({ photoURL, displayName, size, style, emojiSize, onPress }) => {
  const [retryCount, setRetryCount] = useState(0);
  const [failed, setFailed] = useState(false);
  const retryTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Reset everything when the URL changes
  useEffect(() => {
    setFailed(false);
    setRetryCount(0);
    return () => { if (retryTimer.current) clearTimeout(retryTimer.current); };
  }, [photoURL]);

  const handleError = () => {
    if (retryCount < MAX_RETRIES) {
      // Schedule a retry with increasing delay: 1s, 2s, 3s
      const delay = (retryCount + 1) * 1000;
      retryTimer.current = setTimeout(() => {
        setRetryCount(prev => prev + 1);
      }, delay);
    } else {
      // Exhausted retries — show fallback
      setFailed(true);
    }
  };

  const hasURL = !!photoURL && photoURL.length > 0 && !failed && !photoURL.startsWith('file://');
  const bgColor = BG_COLORS[(displayName?.length ?? 0) % BG_COLORS.length];
  const emoji = emojiSize ?? Math.round(size * 0.55);

  // Append retry count to bust the image cache on retry
  const uri = hasURL ? (retryCount > 0 ? `${photoURL}${photoURL!.includes('?') ? '&' : '?'}_r=${retryCount}` : photoURL!) : '';

  const imageEl = hasURL ? (
    <Image
      key={`avatar-${retryCount}`}
      source={{ uri }}
      style={[{ width: size, height: size, borderRadius: size / 2 }, style]}
      onError={handleError}
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
