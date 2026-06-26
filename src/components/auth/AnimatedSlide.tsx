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
// Rightmost fraction of the slide width that triggers fast-forward on press.
// A press anywhere to the LEFT of this strip pauses instead. Tunable.
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

// ---------------------------------------------------------------------------
// Injected JavaScript.
// ---------------------------------------------------------------------------
// Runs before the document loads. Two jobs:
//  1. Force the page background to app-red and fit the 540px design frame to
//     the viewport width edge-to-edge (layout only — keyframes untouched).
//  2. Install a single speed-aware controller (window.__rnHold) plus a virtual
//     timer clock. setInterval is wrapped so slide-driven loops (slide 1's
//     25.6s restart, slide 3's video re-play poll) advance on the controller's
//     virtual clock: while a slide is held they fire 3x as fast, while the
//     slide is off-screen they freeze. setTimeout is left native so the
//     bundler's async scene-unpack chains are never throttled. The same virtual
//     clock drives the progress ring so it stays in lock-step with playback.
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
    active: false, // true only while this slide is the one on screen
    paused: false, // true while a press OUTSIDE the right strip holds it paused
    speed: 1,      // 1 = normal, ${HOLD_SPEED} = right-strip fast-forward
    now: 0,        // virtual clock (ms): advances by speed * realDelta when active
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
  // freeze (slide 1's restart, slide 3's video re-play poll) are setInterval.
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
    var eff = (hold.active && !hold.paused) ? hold.speed : 0; // frozen off-screen or paused
    hold.now += dt * eff;

    // Persistently re-assert playbackRate on every rAF frame while holding.
    // CSSAnimation objects re-instantiated on a loop restart default back to
    // playbackRate 1; catching them within the same frame eliminates any 1x
    // blip and keeps the ring (virtual-clock driven) locked to the scene.
    if (hold.active && !hold.paused && hold.speed !== 1) {
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

// Slide becomes the one on screen: hard-restart it from t=0 AND reset the
// virtual clock so the ring fills from empty again. The previous implementation
// only rewound the virtual clock + ring, but a returned-to slide could still
// show a frozen mid/end frame because WKWebView does not reliably rewind a
// finished/paused CSSAnimation through currentTime=0 alone. So we additionally
// force every keyframe back to frame 0 via the none -> reflow -> restore trick,
// clear any lingering pause-elsewhere play-state from a previous visit, re-arm
// the slide's in-file loop clock (so LOOP_MS counts from now), reset slide 3's
// <video>, and only then normalize the Web Animations timeline. Fully guarded
// so a missing API on an old WebView is a no-op.
const ACTIVATE_JS = `
(function () {
  var hold = window.__rnHold;
  // Reset the virtual clock first so any loop re-armed below counts from 0.
  if (hold) { hold.active = true; hold.speed = 1; hold.now = 0; }

  // 1. Hard-rewind every CSS animation to frame 0 and clear any paused
  //    play-state left over from an off-screen freeze, so the active slide can
  //    never resume stuck on a mid/end frame. Scoped to the 540x1173 scene
  //    root (slide 1 tags it; slides 2/3 fall back to <body>).
  try {
    var sceneRoot = document.querySelector('[data-screen-label]') || document.body;
    if (sceneRoot) {
      var els = sceneRoot.querySelectorAll('*');
      for (var i = 0; i < els.length; i++) {
        els[i].style.animationName = 'none';
        els[i].style.animationPlayState = 'running';
      }
      void sceneRoot.offsetHeight; // force reflow so the removal commits
      for (var k = 0; k < els.length; k++) { els[k].style.animationName = ''; }
    }
  } catch (e) {}

  // 2. Re-arm slide 1's in-file restart so its LOOP_MS baseline is now (= 0).
  try { if (typeof window.__slide1Reset === 'function') { window.__slide1Reset(); } } catch (e) {}

  // 3. Normalize the Web Animations timeline and slide 3's video to t=0.
  try {
    var ps = document.getElementById('rn-pause-style');
    if (ps) { ps.disabled = true; }
  } catch (e) {}
  try {
    if (document.getAnimations) {
      document.getAnimations().forEach(function (a) {
        try { a.playbackRate = 1; a.currentTime = 0; a.play(); } catch (e) {}
      });
    }
    document.querySelectorAll('video').forEach(function (v) {
      try { v.playbackRate = 1; v.currentTime = 0; v.muted = true; var p = v.play(); if (p && p.catch) { p.catch(function () {}); } } catch (e) {}
    });
  } catch (e) {}

  // Clear any pause-elsewhere state left from a previous visit (the clock's
  // active/speed/now were already reset above) and paint the ring at empty.
  if (hold) {
    hold.paused = false;
    if (hold.ring) { try { hold.ring(0); } catch (e) {} }
  }
})();
true;
`;

// Slide leaves the viewport: freeze every animation and the video at t=0 so it
// does not burn through its loop off-screen, and freeze the virtual clock.
const FREEZE_JS = `
(function () {
  try {
    if (document.getAnimations) {
      document.getAnimations().forEach(function (a) {
        try { a.pause(); a.currentTime = 0; a.playbackRate = 1; } catch (e) {}
      });
    }
    document.querySelectorAll('video').forEach(function (v) {
      try { v.pause(); v.currentTime = 0; v.playbackRate = 1; } catch (e) {}
    });
  } catch (e) {}
  var hold = window.__rnHold;
  if (hold) {
    hold.active = false;
    hold.paused = false;
    hold.speed = 1;
    hold.now = 0;
    if (hold.ring) { try { hold.ring(0); } catch (e) {} }
  }
})();
true;
`;

// Press-and-hold: speed the controller (ring + virtual timers), all CSS
// animations via the Web Animations API, and slide 3's video to ${HOLD_SPEED}x.
const HOLD_JS = `
(function () {
  if (window.__rnHold) { window.__rnHold.speed = ${HOLD_SPEED}; }
  try { document.getAnimations().forEach(function (a) { a.playbackRate = ${HOLD_SPEED}; }); } catch (e) {}
  var v = document.getElementById('bowls');
  if (v) { try { v.playbackRate = ${HOLD_SPEED}; } catch (e) {} }
})();
true;
`;

// Release / idle: revert to normal 1x playback from EITHER mode — clear the
// fast-forward speed and any pause (re-enable the paused CSS animations and
// resume slide 3's video).
const RELEASE_JS = `
(function () {
  var hold = window.__rnHold;
  if (hold) { hold.speed = 1; hold.paused = false; }
  try { document.getAnimations().forEach(function (a) { a.playbackRate = 1; }); } catch (e) {}
  var ps = document.getElementById('rn-pause-style');
  if (ps) { ps.disabled = true; }
  var v = document.getElementById('bowls');
  if (v) { try { v.playbackRate = 1; v.muted = true; var p = v.play(); if (p && p.catch) { p.catch(function () {}); } } catch (e) {} }
})();
true;
`;

// Press OUTSIDE the right strip: pause the scene in place. Freezes CSS via an
// idempotent id-guarded <style> (animation-play-state:paused), flags the
// controller so the virtual clock + ring freeze, and pauses slide 3's video.
const PAUSE_JS = `
(function () {
  if (window.__rnHold) { window.__rnHold.paused = true; }
  var el = document.getElementById('rn-pause-style');
  if (!el) {
    el = document.createElement('style');
    el.id = 'rn-pause-style';
    (document.head || document.documentElement).appendChild(el);
  }
  el.innerHTML = '*,*::before,*::after{animation-play-state:paused!important;}';
  el.disabled = false;
  var v = document.getElementById('bowls');
  if (v) { try { v.pause(); } catch (e) {} }
})();
true;
`;

// Builds the progress-ring injection for a slide. The ring is an SVG arc
// appended into the slide's 540×1173 scene root, so it lives in canvas coords
// and scales with the scene automatically. The controller's virtual clock
// drives the fill: it starts empty and grows 0°→360° over loopMs — the same
// per-slide duration that governs auto-advance — then resets and repeats.
// Speed-aware for free (the clock runs at ${HOLD_SPEED}x while held, frozen
// while paused). Idempotent via the rn-ring-arc id; retried until the
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
    circle.setAttribute('stroke-dashoffset', CIRC); // start empty (fill grows)

    var hold = window.__rnHold;
    if (hold) {
      hold.ring = function (now) {
        // Fill: empty at now=0, full at now=LOOP_MS, then resets and repeats.
        // dashoffset shrinks from CIRC (nothing drawn) to 0 (whole circle drawn).
        var p = LOOP_MS > 0 ? (now % LOOP_MS) / LOOP_MS : 0;
        if (p < 0) { p = 0; }
        if (p > 1) { p = 1; }
        circle.setAttribute('stroke-dashoffset', CIRC * (1 - p));
      };
      hold.ring(hold.now);
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

/**
 * Which hold the active slide is under:
 *  - 'idle'  — no touch; play normally at 1x.
 *  - 'fast'  — held on the right-edge strip; fast-forward at HOLD_SPEED.
 *  - 'pause' — held anywhere else; freeze the scene in place.
 */
export type HoldMode = 'idle' | 'fast' | 'pause';

type Props = {
  /** A bundled .html asset module, e.g. require('../../../assets/signin-animations/slide1.html'). */
  source: number;
  /** True when this is the slide currently on screen. */
  isActive: boolean;
  /** The hold the active slide is under — drives the injected speed/pause JS. */
  holdMode: HoldMode;
  /** Loop duration (ms) — the slide's auto-advance duration — drives the ring. */
  loopMs: number;
  /** Fired on touch-down with the region-derived mode so the parent matches its auto-advance rate. */
  onHoldStart: (mode: Exclude<HoldMode, 'idle'>) => void;
  /** Fired when the touch ends/cancels so the parent can return to idle/1x. */
  onHoldEnd: () => void;
  style?: ViewStyle;
};

/**
 * Renders a single self-contained HTML animation full-bleed inside a WebView,
 * with three interactions layered on top via the RN touch layer:
 *
 *  - Progress ring (SVG, injected on onLoadEnd) around the numbered badge that
 *    fills empty→full over the slide's duration, then resets and repeats.
 *  - Region-aware hold: pressing the right-edge strip fast-forwards the whole
 *    scene (incl. slide 3's video and the ring) at HOLD_SPEED; pressing
 *    anywhere else pauses it in place. Release returns to 1x.
 *  - The "Press for 2x" note + right-edge darken gradient cue the fast-forward
 *    affordance and fade only during a right-strip hold.
 *
 * Playback is driven through the Web Animations API and a virtual-clock
 * controller (window.__rnHold) rather than reloading the WebView, so there is
 * no red "reload flash" when a slide is (re)activated. Because all three slides
 * mount at once inside the FlatList pager, each is restarted from t=0 when it
 * becomes active and frozen at t=0 when it leaves the viewport so nothing lands
 * mid-loop.
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

  // Restart from the beginning when this slide becomes active; freeze at t=0
  // when it leaves the viewport. Waits for the document to be ready so the
  // injected script can actually reach the animations.
  useEffect(() => {
    if (!loaded) {
      return;
    }
    inject(isActive ? ACTIVATE_JS : FREEZE_JS);
  }, [isActive, loaded, inject]);

  // Drive the injected speed/pause JS from the region-derived hold mode. Only
  // the slide currently on screen reacts.
  useEffect(() => {
    if (!loaded || !isActive) {
      return;
    }
    if (holdMode === 'fast') {
      inject(HOLD_JS);
    } else if (holdMode === 'pause') {
      inject(PAUSE_JS);
    } else {
      inject(RELEASE_JS);
    }
  }, [holdMode, loaded, isActive, inject]);

  // Fade the press-state affordances ONLY during a right-strip fast-forward
  // hold — a pause press (anywhere else) leaves the note/darken untouched.
  useEffect(() => {
    const active = holdMode === 'fast' && isActive;
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
  }, [holdMode, isActive, noteOpacity, darkenOpacity]);

  // Decide fast-forward vs. pause from the touch x-position, then report the
  // mode up so the parent matches its auto-advance rate. Direct handler — never
  // claims the responder, so the FlatList keeps owning horizontal swipes.
  const handleTouchStart = useCallback(
    (event: GestureResponderEvent) => {
      const x = event?.nativeEvent?.locationX;
      const inRightStrip =
        typeof x === 'number' && width > 0 && x >= width * (1 - RIGHT_STRIP_PCT);
      onHoldStart(inRightStrip ? 'fast' : 'pause');
    },
    [width, onHoldStart],
  );

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

      {/* Right-edge darken gradient: hidden at rest, fades in while holding.
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

      {/* "Press for 2x speed" note: visible at rest, soft-fades out while held. */}
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
