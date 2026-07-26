import React, { ReactNode } from 'react';
import { Animated, StyleSheet, View } from 'react-native';
import { VideoView, useVideoPlayer } from 'expo-video';
import { BlurView } from 'expo-blur';

type Props = {
  children: ReactNode;
  blurPercent?: number;
  scrimOpacity?: number | Animated.Value;
};

const AUTH_VIDEO = require('../../../assets/auth-video/woman-hands-leash.mp4');
const DEFAULT_BLUR_PERCENT = 20;
const DEFAULT_SCRIM_OPACITY = 0.1;

const AuthVideoBackground: React.FC<Props> = ({
  children,
  blurPercent = DEFAULT_BLUR_PERCENT,
  scrimOpacity = DEFAULT_SCRIM_OPACITY,
}) => {
  const player = useVideoPlayer(AUTH_VIDEO, (videoPlayer) => {
    videoPlayer.loop = true;
    videoPlayer.muted = true;
    videoPlayer.volume = 0;
    videoPlayer.play();
  });

  return (
    <View style={styles.container}>
      <VideoView
        player={player}
        style={StyleSheet.absoluteFill}
        nativeControls={false}
        contentFit="cover"
        allowsFullscreen={false}
        allowsPictureInPicture={false}
        playsInline
        useExoShutter={false}
      />
      {blurPercent > 0 && (
        <BlurView
          intensity={blurPercent}
          tint="dark"
          style={StyleSheet.absoluteFill}
          pointerEvents="none"
        />
      )}
      <Animated.View style={[styles.scrim, { opacity: scrimOpacity }]} pointerEvents="none" />
      <View style={styles.content}>{children}</View>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#050507',
  },
  scrim: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: '#000000',
  },
  content: {
    flex: 1,
  },
});

export default AuthVideoBackground;
