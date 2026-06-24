import React, { useEffect, useState } from 'react';
import { StyleSheet, View, ViewStyle } from 'react-native';
import { Asset } from 'expo-asset';
import { WebView } from 'react-native-webview';

// The HTML animations are authored on a 540×1173 design frame whose internal
// background is this red. Keep the WebView/container the same color so any
// aspect-ratio gap reads as red, never the gray html/body letterbox.
export const SLIDE_BACKGROUND = '#F23A53';

// Injected before the document loads: force the page background to the app red
// and make the 540px design frame fill the viewport width edge-to-edge. This
// only touches layout/background — the animation keyframes are untouched.
const FIT_TO_WIDTH_CSS = `
  (function () {
    var style = document.createElement('style');
    style.innerHTML =
      'html,body{margin:0;padding:0;background:#F23A53 !important;' +
      'overflow:hidden;width:100%;height:100%;}';
    document.documentElement.appendChild(style);
  })();
  true;
`;

type Props = {
  /** A bundled .html asset module, e.g. require('../../../assets/signin-animations/slide1.html'). */
  source: number;
  style?: ViewStyle;
};

/**
 * Renders a single self-contained HTML animation full-bleed inside a WebView.
 * The asset is resolved through expo-asset so it works in both the dev client
 * and release builds. Nullable asset state is guarded — a missing localUri
 * falls back to a plain red View rather than crashing.
 */
const AnimatedSlide: React.FC<Props> = ({ source, style }) => {
  const [uri, setUri] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    (async () => {
      try {
        const asset = Asset.fromModule(source);
        await asset?.downloadAsync();
        if (active && asset?.localUri) {
          setUri(asset.localUri);
        }
      } catch {
        // Leave uri null → red fallback below. Never crash the carousel.
      }
    })();
    return () => {
      active = false;
    };
  }, [source]);

  if (!uri) {
    return <View style={[styles.fill, styles.fallback, style]} />;
  }

  return (
    <View style={[styles.fill, styles.fallback, style]}>
      <WebView
        source={{ uri }}
        style={styles.webview}
        originWhitelist={['*']}
        scrollEnabled={false}
        bounces={false}
        showsVerticalScrollIndicator={false}
        showsHorizontalScrollIndicator={false}
        scalesPageToFit
        automaticallyAdjustContentInsets={false}
        injectedJavaScriptBeforeContentLoaded={FIT_TO_WIDTH_CSS}
        // Swipes must reach the parent pager, not the WebView.
        pointerEvents="none"
      />
    </View>
  );
};

const styles = StyleSheet.create({
  fill: { flex: 1 },
  fallback: { backgroundColor: SLIDE_BACKGROUND },
  webview: { flex: 1, backgroundColor: SLIDE_BACKGROUND },
});

export default AnimatedSlide;

