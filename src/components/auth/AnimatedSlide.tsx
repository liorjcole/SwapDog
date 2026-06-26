import React, { useEffect, useRef, useState } from 'react';
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

// Playback is driven through the Web Animations API rather than reloading the
// WebView, so there is no red "reload flash" when a slide is (re)activated.
// Every slide keyframe is `infinite` and slide-1's one-shot `forwards` fades
// stay in document.getAnimations() via their fill, so all animations — plus the
// slide-3 <video> — are reachable here. Each snippet is fully guarded so a
// missing API on an old WebView degrades to a no-op instead of throwing.

// Restart from t=0 and play. Used when a slide becomes the active one so its
// content always plays from the beginning.
const RESTART_JS = `
(function(){
  try{
    if(document.getAnimations){
      document.getAnimations().forEach(function(a){try{a.currentTime=0;a.play();}catch(e){}});
    }
    document.querySelectorAll('video').forEach(function(v){try{v.currentTime=0;v.play();}catch(e){}});
  }catch(e){}
})();
true;
`;

// Seek to t=0 and freeze. Used when a slide leaves the viewport so it does not
// burn through its loop off-screen.
const FREEZE_JS = `
(function(){
  try{
    if(document.getAnimations){
      document.getAnimations().forEach(function(a){try{a.pause();a.currentTime=0;}catch(e){}});
    }
    document.querySelectorAll('video').forEach(function(v){try{v.pause();v.currentTime=0;}catch(e){}});
  }catch(e){}
})();
true;
`;

// Freeze in place at the current frame (press-and-hold).
const PAUSE_JS = `
(function(){
  try{
    if(document.getAnimations){
      document.getAnimations().forEach(function(a){try{a.pause();}catch(e){}});
    }
    document.querySelectorAll('video').forEach(function(v){try{v.pause();}catch(e){}});
  }catch(e){}
})();
true;
`;

// Resume from the frozen frame (release).
const RESUME_JS = `
(function(){
  try{
    if(document.getAnimations){
      document.getAnimations().forEach(function(a){try{a.play();}catch(e){}});
    }
    document.querySelectorAll('video').forEach(function(v){try{v.play();}catch(e){}});
  }catch(e){}
})();
true;
`;

type Props = {
  /** A bundled .html asset module, e.g. require('../../../assets/signin-animations/slide1.html'). */
  source: number;
  /** True when this is the slide currently on screen. */
  isActive: boolean;
  /** True while the active slide is held down (press-and-hold pause). */
  paused: boolean;
  /** Fired when a touch begins so the parent can pause animation + auto-advance. */
  onHoldStart: () => void;
  /** Fired when the touch ends/cancels so the parent can resume. */
  onHoldEnd: () => void;
  style?: ViewStyle;
};

/**
 * Renders a single self-contained HTML animation full-bleed inside a WebView.
 * The asset is resolved through expo-asset so it works in both the dev client
 * and release builds. Nullable asset state is guarded — a missing localUri
 * falls back to a plain red View rather than crashing.
 *
 * Because all three slides mount at once inside the FlatList pager, their CSS
 * animations would otherwise all run off-screen and land mid-loop. This
 * component keeps each slide in lock-step with the carousel:
 *   - becoming active  → restart every animation (and the video) from t=0,
 *   - leaving the view → seek to t=0 and freeze,
 *   - held down        → pause in place; released → resume from that frame.
 *
 * The WebView is wrapped in a <View pointerEvents="none"> so the parent FlatList
 * retains horizontal swipe control. On iOS, setting pointerEvents="none" as a
 * prop on react-native-webview does NOT reliably disable the underlying
 * WKWebView's pan gesture recognizers, so they steal the horizontal swipe and
 * the pager can never reach slide 2. A plain RN View with pointerEvents="none"
 * returns nil from hitTest, excluding the whole WebView subtree from touch
 * delivery — the pan then reaches the FlatList scroll view. The hold callbacks
 * fire from the container View's onTouchStart/End, which still fire as direct
 * touch handlers (they never claim the responder).
 */
const AnimatedSlide: React.FC<Props> = ({
  source,
  isActive,
  paused,
  onHoldStart,
  onHoldEnd,
  style,
}) => {
  const [uri, setUri] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);
  const webViewRef = useRef<WebView>(null);

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

  // Restart from the beginning when this slide becomes active; freeze at t=0
  // when it leaves the viewport. Waits for the document to be ready so the
  // injected script can actually reach the animations.
  useEffect(() => {
    if (!loaded) {
      return;
    }
    webViewRef.current?.injectJavaScript(isActive ? RESTART_JS : FREEZE_JS);
  }, [isActive, loaded]);

  // Press-and-hold pause only applies to the slide currently on screen.
  useEffect(() => {
    if (!loaded || !isActive) {
      return;
    }
    webViewRef.current?.injectJavaScript(paused ? PAUSE_JS : RESUME_JS);
  }, [paused, loaded, isActive]);

  if (!uri) {
    return <View style={[styles.fill, styles.fallback, style]} />;
  }

  return (
    // onTouchStart/End fire here because the WebView child has pointerEvents="none"
    // — touches fall through to this container, which drives pause/resume.
    <View
      style={[styles.fill, styles.fallback, style]}
      onTouchStart={onHoldStart}
      onTouchEnd={onHoldEnd}
      onTouchCancel={onHoldEnd}
    >
      {/* pointerEvents="none" on this wrapping View — not on the WebView prop —
          reliably excludes WKWebView's gesture recognizers from touch delivery
          so the parent horizontal FlatList owns the swipe. */}
      <View style={styles.fill} pointerEvents="none">
        <WebView
          ref={webViewRef}
          source={{ uri }}
          style={styles.webview}
          originWhitelist={['*']}
          scrollEnabled={false}
          bounces={false}
          showsVerticalScrollIndicator={false}
          showsHorizontalScrollIndicator={false}
          scalesPageToFit
          automaticallyAdjustContentInsets={false}
          allowsInlineMediaPlayback
          mediaPlaybackRequiresUserAction={false}
          onLoadEnd={() => setLoaded(true)}
          injectedJavaScriptBeforeContentLoaded={FIT_TO_WIDTH_CSS}
        />
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  fill: { flex: 1 },
  fallback: { backgroundColor: SLIDE_BACKGROUND },
  webview: { flex: 1, backgroundColor: SLIDE_BACKGROUND },
});

export default AnimatedSlide;
