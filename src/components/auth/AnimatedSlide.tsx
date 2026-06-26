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
// Applied playback rate while the user holds the right strip. The on-screen
// label intentionally still reads "2x" — do NOT "fix" this mismatch.
const HOLD_SPEED = 3;
// Note placement — from interactive placement tool (screen fractions).
const NOTE_WIDTH_FRAC  = 0.211;       // × window width (~83pt at 393w)
const NOTE_TOP_FRAC    = 0.325;       // × window height
const NOTE_RIGHT_FRAC  = -0.025;      // × window width (negative: hangs ~10pt off right edge)
const NOTE_ASPECT      = 957 / 638;   // image natural aspect (w/h ≈ 1.5)

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
    speed: 1,      // 1 = normal, HOLD_SPEED = hold-for-fast-forward
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

    // Persistently re-assert playbackRate on every rAF frame while the user
    // is holding at speed. CSSAnimation objects re-instantiated on a loop
    // restart default to playbackRate 1; catching them within the same frame
    // eliminates any visible 1x blip and keeps the ring (virtual-clock driven)
    // locked to the scene across loop boundaries. Guard: only when speed is
    // active; skip animations already at the target rate; null-check video.
    if (!hold.paused && hold.speed !== 1) {
      try {
        var anims = document.getAnimations();
        for (var ak = 0; ak < anims.length; ak++) {
          if (anims[ak].playbackRate !== hold.speed) { anims[ak].playbackRate = hold.speed; }
        }
      } catch (e) {}
      try {
        var bvid = document.getElementById('bowls');
        if (bvid && bvid.playbackRate !== hold.speed) { bvid.playbackRate = hold.speed; }
      } catch (e) {}
    }

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
  if (window.__rnHold) { window.__rnHold.speed = ${HOLD_SPEED}; window.__rnHold.paused = false; }
  try { document.getAnimations().forEach(function (a) { a.playbackRate = ${HOLD_SPEED}; }); } catch (e) {}
  var v = document.getElementById('bowls');
  if (v) { try { v.playbackRate = ${HOLD_SPEED}; } catch (e) {} }
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

// Play-through engine — restart from t=0 and play. Used when a slide becomes
// the active one so its content always plays from the beginning. Also resets
// the controller's virtual clock (now=0, speed=1, unpaused) and clears any
// leftover 2x playbackRate so the progress ring restarts in lock-step with the
// scene. Fully guarded so a missing API degrades to a no-op.
const RESTART_JS = `
(function(){
  try{
    if(window.__rnHold){ window.__rnHold.now=0; window.__rnHold.paused=false; window.__rnHold.speed=1; }
    if(document.getAnimations){
      document.getAnimations().forEach(function(a){try{a.playbackRate=1;a.currentTime=0;a.play();}catch(e){}});
    }
    document.querySelectorAll('video').forEach(function(v){try{v.playbackRate=1;v.currentTime=0;v.play();}catch(e){}});
  }catch(e){}
})();
true;
`;

// Play-through engine — seek to t=0 and freeze. Used when a slide leaves the
// viewport so it does not burn through its loop off-screen. Freezes the
// controller (paused=true, now=0) so the ring is parked at the start too.
const FREEZE_JS = `
(function(){
  try{
    if(window.__rnHold){ window.__rnHold.now=0; window.__rnHold.paused=true; window.__rnHold.speed=1; }
    if(document.getAnimations){
      document.getAnimations().forEach(function(a){try{a.pause();a.currentTime=0;}catch(e){}});
    }
    document.querySelectorAll('video').forEach(function(v){try{v.pause();v.currentTime=0;}catch(e){}});
  }catch(e){}
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
  /** True when this is the slide currently on screen (play-through engine). */
  isActive: boolean;
  /** Fired when a touch begins so the parent can freeze its auto-advance countdown. */
  onHoldStart: () => void;
  /** Fired when the touch ends/cancels so the parent can resume the countdown. */
  onHoldEnd: () => void;
  style?: ViewStyle;
};

/**
 * Renders a single self-contained HTML animation full-bleed inside a WebView,
 * combining the carousel play-through engine with three layered interactions.
 *
 * Play-through engine (owned with the parent SplashScreen):
 *  - becoming active  → restart every animation (and the video) from t=0,
 *  - leaving the view → seek to t=0 and freeze (no off-screen loop burn),
 *  - the parent auto-advances once each slide has played its loop once.
 *
 * Layered interactions (driven from the RN touch layer into the WebView):
 *  - Progress ring (SVG, injected on onLoadEnd) around the numbered badge that
 *    fills over the slide's loop and resets, on a speed/pause-aware clock.
 *  - Hold-for-2x on the rightmost strip: the whole scene (incl. slide 3's
 *    video and the ring) plays faster while held; release reverts to 1x.
 *  - Press anywhere else pauses; releasing resumes. Either hold also calls
 *    onHoldStart/onHoldEnd so the parent freezes/resumes its auto-advance.
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
const AnimatedSlide: React.FC<Props> = ({
  source,
  loopMs,
  isActive,
  onHoldStart,
  onHoldEnd,
  style,
}) => {
  const [uri, setUri] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);
  const webViewRef = useRef<WebView>(null);
  const { width, height } = useWindowDimensions();

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

  // Play-through engine: restart from t=0 when this slide becomes active,
  // freeze at t=0 when it leaves the viewport. Both reset the controller's
  // virtual clock so the ring stays in lock-step. Waits for the document to be
  // ready (loaded) so the injected script can actually reach the animations.
  useEffect(() => {
    if (!loaded) {
      return;
    }
    inject(isActive ? RESTART_JS : FREEZE_JS);
  }, [isActive, loaded, inject]);

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
  // the responder, so the FlatList keeps owning horizontal swipes. Any touch
  // also freezes the parent's auto-advance countdown via onHoldStart.
  const onTouchStart = useCallback(
    (event: GestureResponderEvent) => {
      onHoldStart();
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
    [width, inject, animateAffordances, onHoldStart],
  );

  const onTouchEnd = useCallback(() => {
    onHoldEnd();
    const mode = holdMode.current;
    holdMode.current = 'idle';
    if (mode === 'hold2x') {
      inject(RELEASE_2X_JS);
      animateAffordances(false);
    } else if (mode === 'pause') {
      inject(RESUME_ANIMATIONS_JS);
    }
  }, [inject, animateAffordances, onHoldEnd]);

  const onLoadEnd = useCallback(() => {
    inject(buildRingInjectionJS(loopMs));
    setLoaded(true);
  }, [inject, loopMs]);

  if (!uri) {
    return <View style={[styles.fill, styles.fallback, style]} />;
  }
  const noteWidth  = NOTE_WIDTH_FRAC * width;
  const noteHeight = noteWidth / NOTE_ASPECT;
  const noteTop    = NOTE_TOP_FRAC * height;
  const noteRight  = NOTE_RIGHT_FRAC * width;
  const darkenWidth = Math.max(0, width * DARKEN_WIDTH_FRACTION);

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
