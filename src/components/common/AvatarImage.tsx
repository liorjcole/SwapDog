import React, { useState, useEffect, useRef } from 'react';
import { Image, View, Text, StyleProp, ViewStyle, ImageStyle, TouchableOpacity, StyleSheet } from 'react-native';

/**
 * Avatar that falls back to a 🐶 emoji on a random-ish colored circle
 * when the photo URL is missing, empty, or fails to load.
 *
 * Auto-retries up to 3 times with increasing delay if the image fails
 * (covers transient CDN/network blips that caused permanent emoji fallback).
 *
 * Border styles are extracted to a wrapper View so they never clip the image on iOS.
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

/** Split border/margin/layout props into wrapper; keep the rest for image/view. */
const splitStyle = (flat: Record<string, any>) => {
  const wrapper: Record<string, any> = {};
  const inner: Record<string, any> = {};
  for (const key of Object.keys(flat)) {
    if (
      key.startsWith('border') ||
      key.startsWith('margin') ||
      key === 'alignSelf' ||
      key === 'position' ||
      key === 'top' || key === 'right' || key === 'bottom' || key === 'left' ||
      key === 'zIndex'
    ) {
      wrapper[key] = flat[key];
    } else {
      inner[key] = flat[key];
    }
  }
  return { wrapper, inner };
};

const AvatarImage: React.FC<AvatarImageProps> = ({ photoURL, displayName, size, style, emojiSize, onPress }) => {
  const [retryCount, setRetryCount] = useState(0);
  const [failed, setFailed] = useState(false);
  const retryTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    setFailed(false);
    setRetryCount(0);
    return () => { if (retryTimer.current) clearTimeout(retryTimer.current); };
  }, [photoURL]);

  const handleError = () => {
    if (retryCount < MAX_RETRIES) {
      const delay = (retryCount + 1) * 1000;
      retryTimer.current = setTimeout(() => {
        setRetryCount(prev => prev + 1);
      }, delay);
    } else {
      setFailed(true);
    }
  };

  const cleanURL = photoURL?.trim() ?? '';
  const hasURL = cleanURL.length > 0 && !failed && !cleanURL.startsWith('file://');
  const bgColor = BG_COLORS[(displayName?.length ?? 0) % BG_COLORS.length];
  const emoji = emojiSize ?? Math.round(size * 0.55);

  const uri = hasURL
    ? (retryCount > 0 ? cleanURL + (cleanURL.includes('?') ? '&' : '?') + '_r=' + retryCount : cleanURL)
    : '';

  const flatStyle = StyleSheet.flatten(style) ?? {};
  const { wrapper: wrapperStyle, inner: innerStyle } = splitStyle(flatStyle as Record<string, any>);
  const hasBorder = wrapperStyle.borderWidth != null || wrapperStyle.borderColor != null;
  const hasMarginOrLayout = wrapperStyle.marginRight != null || wrapperStyle.marginLeft != null ||
    wrapperStyle.marginTop != null || wrapperStyle.marginBottom != null ||
    wrapperStyle.alignSelf != null;

  const imageContent = hasURL ? (
    <Image
      key={'avatar-' + retryCount}
      source={{ uri }}
      style={[{ width: size, height: size, borderRadius: size / 2 }, innerStyle]}
      onError={handleError}
      accessibilityLabel={displayName ? displayName + "'s photo" : 'Profile photo'}
    />
  ) : (
    <View
      style={[
        { width: size, height: size, borderRadius: size / 2, backgroundColor: bgColor, alignItems: 'center', justifyContent: 'center' },
        innerStyle,
      ]}
      accessibilityLabel={displayName ? displayName + "'s avatar" : 'Avatar'}
    >
      <Text style={{ fontSize: emoji }}>🐶</Text>
    </View>
  );

  // Wrapper accounts for border width so image isn't clipped
  const bw = (wrapperStyle.borderWidth as number) ?? 0;
  const outerSize = size + bw * 2;

  const el = hasBorder ? (
    <View style={[{ width: outerSize, height: outerSize, borderRadius: outerSize / 2, alignItems: 'center', justifyContent: 'center' }, wrapperStyle]}>
      {imageContent}
    </View>
  ) : hasMarginOrLayout ? (
    <View style={wrapperStyle}>
      {imageContent}
    </View>
  ) : imageContent;

  if (onPress) {
    return (
      <TouchableOpacity onPress={onPress} activeOpacity={0.7} accessibilityRole="button" accessibilityLabel="Change photo">
        {el}
      </TouchableOpacity>
    );
  }
  return el;
};

export default AvatarImage;
