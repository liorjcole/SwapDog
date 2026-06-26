import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  Animated,
  GestureResponderEvent,
  Image,
  StyleSheet,
  useWindowDimensions,
  View,
  ViewStyle,
} from 'react-native';
import { Asset } from 'expo-asset';
import { LinearGradient } from 'expo-linear-gradient';
import { WebView } from 'react-native-webview';

// The HTML animations are authored on a 540×1173 design frame whose internal
// background is this red. Keep the WebView/container the same color so any
// aspect-ratio gap reads as red, never the gray html/body letterbox.
export const SLIDE_BACKGROUND = '#F23A53';

// ---------------------------------------------------------------------------
// Tunable interaction constants.
// ---------------------------------------------------------------------------
// Applied playback rate while the user holds (press-and-hold = fast-forward).
// The on-screen label intentionally still reads "2x" (press-for-2x.png) — do
// NOT "fix" this mismatch. Exported so the parent's auto-advance countdown can
// run at the same multiplier and stay in lock-step with the accelerated scene.
export const HOLD_SPEED = 3;
// A press on the rightmost strip (this fraction of slide width) fast-forwards;
// a press anywhere to its left pauses the scene in place. Tunable.
const RIGHT_STRIP_PCT = 0.15;
// Right-edge darken gradient spans this fraction of the slide width.
const DARKEN_WIDTH_FRACTION = 0.4;
// Darkest alpha at the far-right edge of the darken gradient.
const DARKEN_MAX_ALPHA = 0.55;
// Fade timings for the press-state affordances.
const NOTE_FADE_MS = 1000; // "Press for 2x" note soft-fades out over ~1s.
const DARKEN_IN_MS = 220;
const DARKEN_OUT_MS = 180;
// Note placement — from interactive placement tool (screen fractions).
const NOTE_WIDTH_FRAC = 0.211; // × window width (~83pt at 393w)
const NOTE_TOP_FRAC = 0.325; // × window height
const NOTE_RIGHT_FRAC = -0.025; // × window width (negative: hangs ~10pt off right edge)
const NOTE_ASPECT = 957 / 638; // image natural aspect (w/h ≈ 1.5)

const pressFor2xNote = require('../../../assets/signin-animations/press-for-2x.png');

// Press interaction mode for the active slide, derived from where the user
// pressed: 'fast' = rightmost-strip fast-forward, 'pause' = pause-elsewhere,
// 'idle' = not pressed. Mapped to the slide contract in the host below.
export type HoldMode = 'idle' | 'fast' | 'pause';

// ---------------------------------------------------------------------------
// Slide contract (window.__slide)
// ---------------------------------------------------------------------------
// Every slideN.html implements exactly one global, driven by the Web Animations
// API as a single timing authority (see assets/signin-animations/README.md):
//
//   window.__slide = { durationMs, play(), pause(), seek(ms), setRate(mult), onFrame(cb) }
//
// The host below talks ONLY to this contract. There is no injected virtual
// clock, no animationName/reflow reset trick, and no per-slide querySelector
// special-casing — the failure modes those hacks caused (Slide 1 freezing on a
// forwards end frame, resets that erase inline animations) are gone by design.

// Runs before the document loads: force the page background to app-red so any
// aspect-ratio gap reads as red rather than the gray html/body letterbox.
// Layout only — it never touches the keyframes or the contract.
const BEFORE_CONTENT_JS = `
(function () {
  try {
    var style = document.createElement('style');
    style.innerHTML =
      'html,body{margin:0;padding:0;background:#F23A53 !important;' +
      'overflow:hidden;width:100%;height:100%;}';
    document.documentElement.appendChild(style);
  } catch (e) {}
})();
true;
`;

// Slide becomes the one on screen: rewind to t=0 and play. WAAPI currentTime=0
// is the correct, reliable rewind and works for inline animations.
const ACTIVATE_JS = `
(function () {
  if (window.__slide) { window.__slide.seek(0); window.__slide.play(); }
})();
true;
`;

// Slide leaves the viewport: freeze in place and rewind so it never burns its
// timeline off-screen and is ready to replay cleanly when swiped back to.
const DEACTIVATE_JS = `
(function () {
  if (window.__slide) { window.__slide.pause(); window.__slide.seek(0); }
})();
true;
`;

// Rightmost-strip press = fast-forward the whole timeline (animations + video +
// ring) at HOLD_SPEED via the contract's single clock.
const HOLD_JS = `
(function () {
  if (window.__slide) { window.__slide.setRate(${HOLD_SPEED}); }
})();
true;
`;

// Press-elsewhere = pause the scene in place (freezes animations, video, and the
// ring together): the contract's pause() halts its master clock, so onFrame stops.
const PAUSE_JS = `
(function () {
  if (window.__slide) { window.__slide.pause(); }
})();
true;
`;

// Release: resume normal-speed playback from the current position. Covers both
// release-from-fast (rate back to 1) and release-from-pause (clock resumes).
const RELEASE_JS = `
(function () {
  if (window.__slide) { window.__slide.setRate(1); window.__slide.play(); }
})();
true;
`;

// Builds the progress-ring injection for a slide. The ring is an SVG arc
// appended into the slide's 540×1173 scene root (every slide tags it with
// data-slide-root), so it lives in canvas coords and scales with the scene.
// It subscribes to window.__slide.onFrame(currentMs) and fills empty→full over
// durationMs — the same per-slide duration that governs auto-advance — reaching
// full exactly as the slide advances. Speed-aware for free: onFrame already
// reports the contract's clock, which runs at ${HOLD_SPEED}x while held.
function buildRingInjectionJS(durationMs: number): string {
  return `
(function () {
  var DURATION = ${durationMs};
  var CX = 270, CY = 118, R = 48, STROKE = 6; // canvas units
  var NS = 'http://www.w3.org/2000/svg';

  function install() {
    var scene = document.querySelector('[data-slide-root]');
    if (!scene || !window.__slide) { return false; }
    var circle = document.getElementById('rn-ring-arc');
    if (!circle) {
      var svg = document.createElementNS(NS, 'svg');
      svg.setAttribute('id', 'rn-ring-overlay');
      svg.setAttribute('viewBox', '0 0 540 1173');
      svg.setAttribute('width', '540');
      svg.setAttribute('height', '1173');
      svg.style.cssText =
        'position:absolute;left:0;top:0;width:540px;height:1173px;' +
        'pointer-events:none;z-index:2147483646;overflow:visible;';
      circle = document.createElementNS(NS, 'circle');
      circle.setAttribute('id', 'rn-ring-arc');
      circle.setAttribute('cx', CX);
      circle.setAttribute('cy', CY);
      circle.setAttribute('r', R);
      circle.setAttribute('fill', 'none');
      circle.setAttribute('stroke', '#FFFFFF');
      circle.setAttribute('stroke-width', STROKE);
      circle.setAttribute('stroke-linecap', 'round');
      circle.setAttribute('transform', 'rotate(-90 ' + CX + ' ' + CY + ')');
      svg.appendChild(circle);
      scene.appendChild(svg);
    }
    var CIRC = 2 * Math.PI * R;
    circle.setAttribute('stroke-dasharray', CIRC);
    circle.setAttribute('stroke-dashoffset', CIRC);
    window.__slide.onFrame(function (now) {
      // Fill empty→full: empty at now=0, full at now>=DURATION. dashoffset
      // shrinks from CIRC (nothing drawn) to 0 (whole circle drawn).
      var p = DURATION > 0 ? now / DURATION : 0;
      if (p < 0) { p = 0; }
      if (p > 1) { p = 1; }
      circle.setAttribute('stroke-dashoffset', CIRC * (1 - p));
    });
    return true;
  }

  if (install()) { return; }
  // The contract script runs at end-of-body; poll briefly until it exists.
  var tries = 0;
  (function retry() {
    tries++;
    if (install() || tries > 40) { return; }
    setTimeout(retry, 100);
  })();
})();
true;
`;
}

type Props = {
  /** A bundled .html asset module, e.g. require('../../../assets/signin-animations/slide1.html'). */
  source: number;
  /** True when this is the slide currently on screen. */
  isActive: boolean;
  /** Active press mode for this slide: 'fast' (rightmost strip), 'pause' (elsewhere), or 'idle'. */
  holdMode: HoldMode;
  /** Loop duration (ms) — the slide's auto-advance duration — drives the ring. */
  loopMs: number;
  /** Fired when a touch begins, with the region-derived mode, so the parent can speed/pause auto-advance. */
  onHoldStart: (mode: HoldMode) => void;
  /** Fired when the touch ends/cancels so the parent can return to 1x. */
  onHoldEnd: () => void;
  style?: ViewStyle;
};

/**
 * Renders a single self-contained HTML animation full-bleed inside a WebView,
 * with three interactions layered on top via the RN touch layer:
 *
 *  - Progress ring (SVG, injected on onLoadEnd) around the numbered badge that
 *    fills empty→full over the slide's duration and reaches full as it advances.
 *  - Region-aware press: the rightmost strip fast-forwards the whole scene
 *    (incl. slide 3's video and the ring) at HOLD_SPEED; a press elsewhere
 *    pauses it in place; release resumes at 1x.
 *  - The "Press for 2x" note + right-edge darken gradient cue the fast-forward
 *    affordance (shown only while fast-forwarding, not while paused).
 *
 * Playback is driven entirely through the slide's window.__slide contract (the
 * Web Animations API under the hood), so there is no red "reload flash" when a
 * slide is (re)activated: activate → seek(0)+play, deactivate → pause+seek(0),
 * fast → setRate, pause → pause(), release → setRate(1)+play(). Because the
 * parent FlatList only mounts the active slide and
 * its immediate neighbours, three heavy WebViews never co-exist.
 *
 * The WebView is wrapped in a <View pointerEvents="none"> so the parent
 * FlatList keeps horizontal swipe control: on iOS, pointerEvents="none" as a
 * prop on react-native-webview does NOT reliably disable WKWebView's pan
 * gesture recognizers, so they steal the swipe and the pager never reaches
 * slide 2. A plain RN View with pointerEvents="none" returns nil from hitTest,
 * excluding the whole WebView subtree from touch delivery. The hold callbacks
 * fire from the container View's onTouchStart/End (direct touch handlers that
 * never claim the responder) and are driven into the WebView via
 * injectJavaScript() — never via DOM touch targets.
 */
const AnimatedSlide: React.FC<Props> = ({
  source,
  isActive,
  holdMode,
  loopMs,
  onHoldStart,
  onHoldEnd,
  style,
}) => {
  const [uri, setUri] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);
  const webViewRef = useRef<WebView>(null);
  const { width, height } = useWindowDimensions();

  // Note fades out (1 → 0) while held; darken fades in (0 → 1).
  const noteOpacity = useRef(new Animated.Value(1)).current;
  const darkenOpacity = useRef(new Animated.Value(0)).current;

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

  const inject = useCallback((js: string) => {
    webViewRef.current?.injectJavaScript(js);
  }, []);

  // Region-aware press: the rightmost strip fast-forwards, anywhere else pauses.
  const handleTouchStart = useCallback(
    (e: GestureResponderEvent) => {
      const x = e?.nativeEvent?.locationX ?? 0;
      const mode: HoldMode = x >= width * (1 - RIGHT_STRIP_PCT) ? 'fast' : 'pause';
      onHoldStart(mode);
    },
    [onHoldStart, width],
  );

  // Restart from the beginning when this slide becomes active; freeze at t=0
  // when it leaves the viewport. Waits for the document to be ready so the
  // injected script can actually reach the contract.
  useEffect(() => {
    if (!loaded) {
      return;
    }
    inject(isActive ? ACTIVATE_JS : DEACTIVATE_JS);
  }, [isActive, loaded, inject]);

  // Region-aware press only applies to the slide currently on screen: the
  // rightmost strip fast-forwards, a press elsewhere pauses, release resumes.
  useEffect(() => {
    if (!loaded || !isActive) {
      return;
    }
    inject(holdMode === 'fast' ? HOLD_JS : holdMode === 'pause' ? PAUSE_JS : RELEASE_JS);
  }, [holdMode, loaded, isActive, inject]);

  // Fade the press-state affordances in step with the fast-forward only — a
  // pause-elsewhere press leaves the note/darken untouched (matches the cue).
  useEffect(() => {
    const fast = holdMode === 'fast' && isActive;
    Animated.timing(noteOpacity, {
      toValue: fast ? 0 : 1,
      duration: NOTE_FADE_MS,
      useNativeDriver: true,
    }).start();
    Animated.timing(darkenOpacity, {
      toValue: fast ? 1 : 0,
      duration: fast ? DARKEN_IN_MS : DARKEN_OUT_MS,
      useNativeDriver: true,
    }).start();
  }, [holdMode, isActive, noteOpacity, darkenOpacity]);

  if (!uri) {
    return <View style={[styles.fill, styles.fallback, style]} />;
  }

  const noteWidth = NOTE_WIDTH_FRAC * width;
  const noteHeight = noteWidth / NOTE_ASPECT;
  const noteTop = NOTE_TOP_FRAC * height;
  const noteRight = NOTE_RIGHT_FRAC * width;
  const darkenWidth = Math.max(0, width * DARKEN_WIDTH_FRACTION);

  return (
    // onTouchStart/End fire here because the WebView and overlay children all
    // have pointerEvents="none" — touches fall through to this container.
    <View
      style={[styles.fill, styles.fallback, style]}
      onTouchStart={handleTouchStart}
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
          injectedJavaScriptBeforeContentLoaded={BEFORE_CONTENT_JS}
          onLoadEnd={() => {
            setLoaded(true);
            inject(buildRingInjectionJS(loopMs));
          }}
        />
      </View>

      {/* Right-edge darken gradient: hidden at rest, fades in while fast-forwarding.
          Darkest at the far-right edge → transparent toward center. */}
      <Animated.View
        pointerEvents="none"
        style={[styles.darken, { width: darkenWidth, opacity: darkenOpacity }]}
      >
        <LinearGradient
          colors={['rgba(0,0,0,0)', `rgba(0,0,0,${DARKEN_MAX_ALPHA})`] as const}
          start={{ x: 0, y: 0.5 }}
          end={{ x: 1, y: 0.5 }}
          style={styles.fill}
        />
      </Animated.View>

      {/* "Press for 2x speed" note: visible at rest, soft-fades out while fast-forwarding. */}
      <Animated.View
        pointerEvents="none"
        style={[styles.note, { top: noteTop, right: noteRight, opacity: noteOpacity }]}
      >
        <Image source={pressFor2xNote} style={{ width: noteWidth, height: noteHeight }} resizeMode="contain" />
      </Animated.View>
    </View>
  );
};

const styles = StyleSheet.create({
  fill: { flex: 1 },
  fallback: { backgroundColor: SLIDE_BACKGROUND },
  webview: { flex: 1, backgroundColor: SLIDE_BACKGROUND },
  darken: { position: 'absolute', top: 0, bottom: 0, right: 0 },
  note: { position: 'absolute' },
});

export default AnimatedSlide;
