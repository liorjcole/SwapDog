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
import { useSafeAreaInsets } from 'react-native-safe-area-context';
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
// Rightmost fraction of the slide width that triggers hold-for-2x instead of
// pause. Matches the narrow strip in the design screenshots.
const RIGHT_STRIP_FRACTION = 0.15;
// Right-edge darken gradient spans this fraction of the slide width.
const DARKEN_WIDTH_FRACTION = 0.4;
// Darkest alpha at the far-right edge of the darken gradient.
const DARKEN_MAX_ALPHA = 0.55;
// Fade timings for the press-state affordances.
const NOTE_FADE_MS = 1000; // "Press for 2x" note soft-fades out over ~1s.
const DARKEN_IN_MS = 220;
const DARKEN_OUT_MS = 180;
// "Press for 2x speed" note (Group 85 export) intrinsic size, for aspect ratio.
const NOTE_ASPECT = 957 / 638;
const NOTE_WIDTH = 138;

const pressFor2xNote = require('../../../assets/signin-animations/press-for-2x.png');

// ---------------------------------------------------------------------------
// Injected JavaScript.
// ---------------------------------------------------------------------------
// Runs before the document loads. Two jobs:
//  1. Force the page background to app-red and fit the 540px design frame to
//     the viewport width edge-to-edge (layout only — keyframes untouched).
//  2. Install a single speed/pause-aware controller (window.__rnHold) plus a
//     virtual timer clock. setInterval/setTimeout are wrapped so slide-driven
//     delays (slide 1's 29.5s restart loop, slide 3's video re-play poll)
//     advance on the controller's virtual clock: at 2x they fire twice as
//     fast, while paused they freeze — no frozen/janky end-state. The same
//     virtual clock drives the progress ring so it stays consistent across all
//     three slides regardless of their internal timing mechanism.
const BEFORE_CONTENT_JS = `
(function () {
  try {
    var style = document.createElement('style');
    style.innerHTML =
      'html,body{margin:0;padding:0;background:#F23A53 !important;' +
      'overflow:hidden;width:100%;height:100%;}';
    document.documentElement.appendChild(style);
  } catch (e) {}

  // Idempotent: never re-install the controller on the same document.
  if (window.__rnHold) { return; }
  var hold = {
    speed: 1,      // 1 = normal, 2 = hold-for-2x
    paused: false, // true while a pause-hold is active
    now: 0,        // virtual clock (ms): advances by speed * realDelta
    last: null,
    timers: [],
    seq: 1,
    ring: null,    // set by the onLoadEnd ring injection
  };
  window.__rnHold = hold;

  var realSetTimeout = window.setTimeout.bind(window);
  var nativeSetInterval = window.setInterval.bind(window);
  var realRAF = window.requestAnimationFrame
    ? window.requestAnimationFrame.bind(window)
    : function (cb) { return realSetTimeout(function () { cb(Date.now()); }, 16); };
  hold.realSetTimeout = realSetTimeout;

  function schedule(cb, delay, repeat, args) {
    var id = hold.seq++;
    var d = Math.max(0, Number(delay) || 0);
    hold.timers.push({ id: id, cb: cb, delay: d, next: hold.now + d, repeat: repeat, args: args });
    return id;
  }
  function unschedule(id) {
    for (var i = 0; i < hold.timers.length; i++) {
      if (hold.timers[i].id === id) { hold.timers.splice(i, 1); return; }
    }
  }
  // Only setInterval is virtualized: the slide loops that must respect speed /
  // pause (slide 1's restart, slide 3's video re-play poll) are setInterval.
  // setTimeout is left native so the bundler's async scene-unpack (which may
  // chain one-shot timeouts) is never throttled by the rAF virtual clock.
  // Non-function callbacks (string eval form) fall back to the native timer.
  window.setInterval = function (cb, delay) {
    if (typeof cb !== 'function') { return nativeSetInterval.apply(window, arguments); }
    return schedule(cb, delay, true, Array.prototype.slice.call(arguments, 2));
  };
  window.clearInterval = function (id) { unschedule(id); };

  function frame(ts) {
    if (hold.last === null) { hold.last = ts; }
    var dt = ts - hold.last;
    hold.last = ts;
    if (dt < 0) { dt = 0; }
    if (dt > 250) { dt = 250; } // clamp background/tab-switch jumps
    var eff = hold.paused ? 0 : hold.speed;
    hold.now += dt * eff;

    if (eff > 0 && hold.timers.length) {
      var due = [];
      for (var i = 0; i < hold.timers.length; i++) {
        if (hold.timers[i].next <= hold.now) { due.push(hold.timers[i]); }
      }
      for (var j = 0; j < due.length; j++) {
        var t = due[j];
        if (t.repeat) {
          t.next += t.delay;
          if (t.next <= hold.now) { t.next = hold.now + t.delay; }
        } else {
          unschedule(t.id);
        }
        try { t.cb.apply(window, t.args || []); } catch (e) {}
      }
    }

    if (hold.ring) { try { hold.ring(hold.now); } catch (e) {} }
    realRAF(frame);
  }
  realRAF(frame);
})();
true;
`;

// Freeze all CSS animations at their current frame and pause the controller so
// the ring + virtual timers (incl. slide 3's video re-play poll) freeze too.
// Singleton <style> keeps repeated calls idempotent. Slide 3's video is paused
// directly; the frozen poll means it stays paused.
const PAUSE_ANIMATIONS_JS = `
(function () {
  if (window.__rnHold) { window.__rnHold.paused = true; }
  var el = document.getElementById('rn-pause-style');
  if (!el) {
    el = document.createElement('style');
    el.id = 'rn-pause-style';
    document.head.appendChild(el);
  }
  el.innerHTML = '*,*::before,*::after{animation-play-state:paused!important;}';
  el.disabled = false;
  var v = document.getElementById('bowls');
  if (v) { try { v.pause(); } catch (e) {} }
})();
true;
`;

// Re-enable animations from exactly where they paused and resume the
// controller. Slide 3's video is restarted (its poll resumes with the clock).
const RESUME_ANIMATIONS_JS = `
(function () {
  if (window.__rnHold) { window.__rnHold.paused = false; }
  var el = document.getElementById('rn-pause-style');
  if (el) { el.disabled = true; }
  var v = document.getElementById('bowls');
  if (v) { try { v.muted = true; var p = v.play(); if (p && p.catch) { p.catch(function () {}); } } catch (e) {} }
})();
true;
`;

// Enter 2x: speed up the controller (ring + virtual timers), all CSS
// animations via the Web Animations API, and slide 3's video.
const HOLD_2X_JS = `
(function () {
  if (window.__rnHold) { window.__rnHold.speed = 2; window.__rnHold.paused = false; }
  try { document.getAnimations().forEach(function (a) { a.playbackRate = 2; }); } catch (e) {}
  var v = document.getElementById('bowls');
  if (v) { try { v.playbackRate = 2; } catch (e) {} }
})();
true;
`;

// Release 2x: revert everything to normal speed.
const RELEASE_2X_JS = `
(function () {
  if (window.__rnHold) { window.__rnHold.speed = 1; window.__rnHold.paused = false; }
  try { document.getAnimations().forEach(function (a) { a.playbackRate = 1; }); } catch (e) {}
  var v = document.getElementById('bowls');
  if (v) { try { v.playbackRate = 1; } catch (e) {} }
})();
true;
`;

// Builds the progress-ring injection for a slide. The ring is an SVG arc
// appended into the slide's 540×1173 scene root, so it lives in canvas coords
// and scales with the scene automatically. The controller's virtual clock
// drives the fill (0→360° over loopMs, then resets) — speed- and pause-aware
// for free. Idempotent via the rn-ring-arc id; retried until the
// bundler-unpacked scene root exists.
function buildRingInjectionJS(loopMs: number): string {
  return `
(function () {
  var LOOP_MS = ${loopMs};
  var CX = 270, CY = 118, R = 48, STROKE = 6; // canvas units
  var SVG_NS = 'http://www.w3.org/2000/svg';

  // The scene root is the outermost 540×1173 positioned container. Slide 1
  // tags it with data-screen-label; slides 2/3 are matched dimensionally.
  function findScene() {
    var tagged = document.querySelector('[data-screen-label]');
    if (tagged) { return tagged; }
    var divs = document.querySelectorAll('div');
    for (var i = 0; i < divs.length; i++) {
      var s = divs[i].style;
      if (s && s.width === '540px' && s.position === 'relative') { return divs[i]; }
    }
    return null;
  }

  function install() {
    var scene = findScene();
    if (!scene) { return false; }
    var circle = document.getElementById('rn-ring-arc');
    if (!circle) {
      var svg = document.createElementNS(SVG_NS, 'svg');
      svg.setAttribute('id', 'rn-ring-overlay');
      svg.setAttribute('viewBox', '0 0 540 1173');
      svg.setAttribute('width', '540');
      svg.setAttribute('height', '1173');
      svg.style.cssText =
        'position:absolute;left:0;top:0;width:540px;height:1173px;' +
        'pointer-events:none;z-index:2147483646;overflow:visible;';
      circle = document.createElementNS(SVG_NS, 'circle');
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

    var hold = window.__rnHold;
    if (hold) {
      hold.ring = function (now) {
        var p = LOOP_MS > 0 ? (now % LOOP_MS) / LOOP_MS : 0;
        if (p < 0) { p = 0; }
        if (p > 1) { p = 1; }
        circle.setAttribute('stroke-dashoffset', CIRC * (1 - p));
      };
    }
    return true;
  }

  if (install()) { return; }
  // The scene is unpacked asynchronously; poll on real time until it exists.
  var hold = window.__rnHold;
  var rST = (hold && hold.realSetTimeout) ? hold.realSetTimeout : window.setTimeout;
  var tries = 0;
  function retry() {
    tries++;
    if (install() || tries > 40) { return; }
    rST(retry, 100);
  }
  rST(retry, 100);
})();
true;
`;
}

type HoldMode = 'idle' | 'pause' | 'hold2x';

type Props = {
  /** A bundled .html asset module, e.g. require('../../../assets/signin-animations/slide1.html'). */
  source: number;
  /** Loop duration (ms) used to drive the progress ring for this slide. */
  loopMs: number;
  style?: ViewStyle;
};

/**
 * Renders a single self-contained HTML animation full-bleed inside a WebView,
 * with three interactions layered on top via the RN touch layer:
 *
 *  - Progress ring (SVG, injected on onLoadEnd) around the numbered badge that
 *    fills over the slide's loop and resets.
 *  - Hold-for-2x on the rightmost strip: the whole scene (incl. slide 3's
 *    video and the ring) plays at 2x while held.
 *  - Press anywhere else pauses; releasing resumes.
 *
 * The asset is resolved through expo-asset so it works in both the dev client
 * and release builds. A missing localUri falls back to a plain red View.
 *
 * The WebView is wrapped in a <View pointerEvents="none"> so the parent
 * FlatList keeps horizontal swipe control: on iOS, pointerEvents="none" as a
 * prop on react-native-webview does NOT reliably disable WKWebView's pan
 * gesture recognizers, so they steal the swipe and the pager never reaches
 * slide 2. A plain RN View with pointerEvents="none" returns nil from hitTest,
 * excluding the whole WebView subtree from touch delivery. All interaction is
 * therefore decided in the RN layer from the outer View's onTouchStart/End
 * (direct touch handlers that never claim the responder) and driven into the
 * WebView via injectJavaScript() — never via DOM touch targets.
 */
const AnimatedSlide: React.FC<Props> = ({ source, loopMs, style }) => {
  const [uri, setUri] = useState<string | null>(null);
  const webViewRef = useRef<WebView>(null);
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();

  // Which hold (if any) is active, so release knows what to revert.
  const holdMode = useRef<HoldMode>('idle');
  // Note fades out (1 → 0) while a 2x-hold is active; darken fades in (0 → 1).
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

  // Fade the press-state affordances. active=true → note out, darken in.
  const animateAffordances = useCallback(
    (active: boolean) => {
      Animated.timing(noteOpacity, {
        toValue: active ? 0 : 1,
        duration: NOTE_FADE_MS,
        useNativeDriver: true,
      }).start();
      Animated.timing(darkenOpacity, {
        toValue: active ? 1 : 0,
        duration: active ? DARKEN_IN_MS : DARKEN_OUT_MS,
        useNativeDriver: true,
      }).start();
    },
    [noteOpacity, darkenOpacity],
  );

  // Decide pause vs. 2x by touch x-position. Direct handler — must not claim
  // the responder, so the FlatList keeps owning horizontal swipes.
  const onTouchStart = useCallback(
    (event: GestureResponderEvent) => {
      const x = event?.nativeEvent?.locationX;
      const inRightStrip =
        typeof x === 'number' && width > 0 && x >= width * (1 - RIGHT_STRIP_FRACTION);
      if (inRightStrip) {
        holdMode.current = 'hold2x';
        inject(HOLD_2X_JS);
        animateAffordances(true);
      } else {
        holdMode.current = 'pause';
        inject(PAUSE_ANIMATIONS_JS);
      }
    },
    [width, inject, animateAffordances],
  );

  const onTouchEnd = useCallback(() => {
    const mode = holdMode.current;
    holdMode.current = 'idle';
    if (mode === 'hold2x') {
      inject(RELEASE_2X_JS);
      animateAffordances(false);
    } else if (mode === 'pause') {
      inject(RESUME_ANIMATIONS_JS);
    }
  }, [inject, animateAffordances]);

  const onLoadEnd = useCallback(() => {
    inject(buildRingInjectionJS(loopMs));
  }, [inject, loopMs]);

  if (!uri) {
    return <View style={[styles.fill, styles.fallback, style]} />;
  }

  const darkenWidth = Math.max(0, width * DARKEN_WIDTH_FRACTION);
  const noteTop = (insets?.top ?? 0) + 12;

  return (
    // onTouchStart/End fire here because the WebView and overlay children all
    // have pointerEvents="none" — touches fall through to this container.
    <View
      style={[styles.fill, styles.fallback, style]}
      onTouchStart={onTouchStart}
      onTouchEnd={onTouchEnd}
      onTouchCancel={onTouchEnd}
    >
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
          onLoadEnd={onLoadEnd}
        />
      </View>

      {/* Right-edge darken gradient: hidden at rest, fades in while holding 2x.
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

      {/* "Press for 2x speed" note: visible at rest, soft-fades out on 2x-hold. */}
      <Animated.View
        pointerEvents="none"
        style={[styles.note, { top: noteTop, opacity: noteOpacity }]}
      >
        <Image source={pressFor2xNote} style={styles.noteImage} resizeMode="contain" />
      </Animated.View>
    </View>
  );
};

const styles = StyleSheet.create({
  fill: { flex: 1 },
  fallback: { backgroundColor: SLIDE_BACKGROUND },
  webview: { flex: 1, backgroundColor: SLIDE_BACKGROUND },
  darken: { position: 'absolute', top: 0, bottom: 0, right: 0 },
  note: { position: 'absolute', right: 16 },
  noteImage: { width: NOTE_WIDTH, height: NOTE_WIDTH / NOTE_ASPECT },
});

export default AnimatedSlide;
