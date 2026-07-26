import React, { useState, useRef, useCallback, useEffect, useMemo } from 'react';
import {
  View, Image, Text, TouchableOpacity, ActivityIndicator, StyleSheet,
  useWindowDimensions,
} from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, {
  useSharedValue, useAnimatedStyle, withSpring, withTiming,
  runOnJS,
} from 'react-native-reanimated';
import * as Haptics from 'expo-haptics';

const GAP = 4;
const COLS = 4;
const LONG_PRESS_MS = 300;
const SWAP_COOLDOWN_MS = 200; // prevent rapid back-and-forth oscillation

interface DraggablePhotoGridProps {
  photos: string[];
  onReorder: (photos: string[]) => void;
  onDelete: (index: number) => void;
  onAdd: () => void;
  maxPhotos: number;
  uploading: boolean;
  loadingCount?: number;
  /** Total horizontal padding eaten by parent containers (outer + card) */
  containerPadding?: number;
  onDragStart?: () => void;
  onDragEnd?: () => void;
  colors: {
    primary: string;
    surface: string;
    border: string;
    textSecondary: string;
    background: string;
  };
}

export function DraggablePhotoGrid({
  photos,
  onReorder,
  onDelete,
  onAdd,
  maxPhotos,
  uploading,
  loadingCount = 0,
  containerPadding = 80,
  onDragStart,
  onDragEnd,
  colors,
}: DraggablePhotoGridProps) {
  const { width: screenWidth } = useWindowDimensions();
  const THUMB = Math.floor((screenWidth - containerPadding - (COLS - 1) * GAP) / COLS);

  const [orderedPhotos, setOrderedPhotos] = useState(photos);
  const [draggingIdx, setDraggingIdx] = useState<number | null>(null);

  // ── Shared values: smooth 60fps drag on UI thread ──
  const dragTranslateX = useSharedValue(0);
  const dragTranslateY = useSharedValue(0);
  const dragScale = useSharedValue(1);

  // ── JS-side refs for drag state ──
  const isDragging = useRef(false);
  const currentIdx = useRef(-1);
  const photosRef = useRef(photos);
  const gridOriginRef = useRef({ x: 0, y: 0 });
  const startGridPosRef = useRef({ x: 0, y: 0 });
  const lastSwapTime = useRef(0);
  const containerRef = useRef<View>(null);

  // ── Stable callback refs (so gesture object never needs recreation) ──
  const onDragStartRef = useRef(onDragStart);
  onDragStartRef.current = onDragStart;
  const onDragEndRef = useRef(onDragEnd);
  onDragEndRef.current = onDragEnd;
  const onReorderRef = useRef(onReorder);
  onReorderRef.current = onReorder;

  // Sync photos from parent (but freeze during drag)
  useEffect(() => {
    if (!isDragging.current) {
      setOrderedPhotos(photos);
      photosRef.current = photos;
    }
  }, [photos]);

  const getGridPos = useCallback(
    (idx: number) => ({
      x: (idx % COLS) * (THUMB + GAP),
      y: Math.floor(idx / COLS) * (THUMB + GAP),
    }),
    [THUMB],
  );

  const getIdxFromTouch = useCallback(
    (pageX: number, pageY: number) => {
      const localX = pageX - gridOriginRef.current.x;
      const localY = pageY - gridOriginRef.current.y;
      const col = Math.max(0, Math.min(Math.floor(localX / (THUMB + GAP)), COLS - 1));
      const row = Math.max(0, Math.floor(localY / (THUMB + GAP)));
      const idx = row * COLS + col;
      return Math.max(0, Math.min(idx, photosRef.current.length - 1));
    },
    [THUMB],
  );

  // Measure grid origin on every layout (handles scroll changes)
  const handleLayout = useCallback(() => {
    containerRef.current?.measureInWindow((x, y) => {
      gridOriginRef.current = { x, y };
    });
  }, []);

  // ── Drag lifecycle (called from UI thread via runOnJS) ──

  const activateDrag = useCallback(
    (absoluteX: number, absoluteY: number) => {
      // Re-measure in case user scrolled since last layout
      containerRef.current?.measureInWindow((x, y) => {
        gridOriginRef.current = { x, y };
      });

      const idx = getIdxFromTouch(absoluteX, absoluteY);
      if (idx < 0 || idx >= photosRef.current.length) return;

      isDragging.current = true;
      currentIdx.current = idx;
      photosRef.current = [...photosRef.current]; // snapshot
      lastSwapTime.current = 0;
      startGridPosRef.current = getGridPos(idx);

      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
      setDraggingIdx(idx);
      onDragStartRef.current?.();
    },
    [getIdxFromTouch, getGridPos],
  );

  const moveDrag = useCallback(
    (absoluteX: number, absoluteY: number) => {
      if (!isDragging.current) return;

      const now = Date.now();
      if (now - lastSwapTime.current < SWAP_COOLDOWN_MS) return;

      const targetIdx = getIdxFromTouch(absoluteX, absoluteY);
      if (targetIdx !== currentIdx.current) {
        lastSwapTime.current = now;

        const arr = [...photosRef.current];
        const [moved] = arr.splice(currentIdx.current, 1);
        arr.splice(targetIdx, 0, moved);
        photosRef.current = arr;
        currentIdx.current = targetIdx;
        setOrderedPhotos(arr);
        setDraggingIdx(targetIdx);
        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
      }
    },
    [getIdxFromTouch],
  );

  const releaseDrag = useCallback(() => {
    if (!isDragging.current) return; // idempotent
    isDragging.current = false;
    onReorderRef.current(photosRef.current);
    setDraggingIdx(null);
    onDragEndRef.current?.();
  }, []);

  // ── Stable wrappers (ensure gesture never goes stale) ──
  const activateRef = useRef(activateDrag);
  activateRef.current = activateDrag;
  const moveRef = useRef(moveDrag);
  moveRef.current = moveDrag;
  const releaseRef = useRef(releaseDrag);
  releaseRef.current = releaseDrag;

  const stableActivate = useCallback((x: number, y: number) => activateRef.current(x, y), []);
  const stableMove = useCallback((x: number, y: number) => moveRef.current(x, y), []);
  const stableRelease = useCallback(() => releaseRef.current(), []);

  // ── Single gesture handler on the container (never recreated) ──
  const gesture = useMemo(
    () =>
      Gesture.Pan()
        .activateAfterLongPress(LONG_PRESS_MS)
        .minDistance(0)
        .onStart((e) => {
          'worklet';
          dragTranslateX.value = 0;
          dragTranslateY.value = 0;
          dragScale.value = withSpring(1.15, { damping: 12, stiffness: 150 });
          runOnJS(stableActivate)(e.absoluteX, e.absoluteY);
        })
        .onUpdate((e) => {
          'worklet';
          dragTranslateX.value = e.translationX;
          dragTranslateY.value = e.translationY;
          runOnJS(stableMove)(e.absoluteX, e.absoluteY);
        })
        .onFinalize(() => {
          'worklet';
          dragScale.value = withSpring(1, { damping: 15 });
          dragTranslateX.value = withTiming(0, { duration: 200 });
          dragTranslateY.value = withTiming(0, { duration: 200 });
          runOnJS(stableRelease)();
        }),
    [], // stable forever — callbacks use refs
  );

  // ── Animated style for the floating ghost (runs on UI thread) ──
  const ghostStyle = useAnimatedStyle(() => ({
    transform: [
      { translateX: dragTranslateX.value },
      { translateY: dragTranslateY.value },
      { scale: dragScale.value },
    ],
  }));

  // ── Grid dimensions ──
  const effectiveCount = orderedPhotos.length + loadingCount;
  const showAdd = effectiveCount < maxPhotos && !uploading;
  const totalSlots = effectiveCount + (showAdd ? 1 : 0);
  const rowCount = Math.ceil(totalSlots / COLS);
  const gridHeight = rowCount * (THUMB + GAP) - GAP;

  return (
    <GestureDetector gesture={gesture}>
      <View
        ref={containerRef}
        collapsable={false}
        onLayout={handleLayout}
        style={{ height: gridHeight, position: 'relative' }}
      >
        {/* ── Grid items ── */}
        {orderedPhotos.map((uri, idx) => {
          const pos = getGridPos(idx);
          const isBeingDragged = draggingIdx === idx;

          return (
            <View
              key={uri}
              style={[
                styles.item,
                { left: pos.x, top: pos.y, width: THUMB, height: THUMB },
                isBeingDragged && { opacity: 0.3 },
              ]}
            >
              <Image source={{ uri }} style={[styles.thumb, { width: THUMB, height: THUMB }]} />
              {idx === 0 && (
                <View style={[styles.primaryBadge, { backgroundColor: colors.primary }]}>
                  <Text style={styles.primaryText}>Primary</Text>
                </View>
              )}
              {!isBeingDragged && (
                <TouchableOpacity
                  style={styles.deleteBtn}
                  onPress={() => onDelete(idx)}
                  hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}
                >
                  <Text style={styles.deleteBtnText}>✕</Text>
                </TouchableOpacity>
              )}
            </View>
          );
        })}

        {/* ── Floating ghost: follows finger at 60fps on UI thread ── */}
        {draggingIdx !== null && (
          <Animated.View
            style={[
              styles.item,
              styles.ghost,
              {
                left: startGridPosRef.current.x,
                top: startGridPosRef.current.y,
                width: THUMB,
                height: THUMB,
              },
              ghostStyle,
            ]}
            pointerEvents="none"
          >
            <Image
              source={{ uri: orderedPhotos[draggingIdx] }}
              style={[styles.thumb, { width: THUMB, height: THUMB }]}
            />
            {draggingIdx === 0 && (
              <View style={[styles.primaryBadge, { backgroundColor: colors.primary }]}>
                <Text style={styles.primaryText}>Primary</Text>
              </View>
            )}
          </Animated.View>
        )}

        {/* ── Loading placeholders ── */}
        {Array.from({ length: loadingCount }).map((_, i) => {
          const placeholderIdx = orderedPhotos.length + i;
          const pos = getGridPos(placeholderIdx);
          return (
            <View
              key={`loading-${i}`}
              style={[
                styles.item,
                styles.loadingPlaceholder,
                {
                  left: pos.x,
                  top: pos.y,
                  width: THUMB,
                  height: THUMB,
                  backgroundColor: colors.surface,
                  borderColor: colors.border,
                },
              ]}
            >
              <ActivityIndicator color={colors.primary} size="small" />
            </View>
          );
        })}

        {/* ── + Add photo tile ── */}
        {showAdd && (
          <View
            style={[
              styles.addTile,
              {
                left: getGridPos(effectiveCount).x,
                top: getGridPos(effectiveCount).y,
                width: THUMB,
                height: THUMB,
                borderColor: colors.border,
                backgroundColor: colors.surface,
              },
            ]}
          >
            <TouchableOpacity
              style={[styles.addTileInner, { width: THUMB, height: THUMB }]}
              onPress={onAdd}
              disabled={uploading}
            >
              <Text style={[styles.addIcon, { color: colors.primary }]}>+</Text>
              <Text style={{ fontSize: 12, color: colors.textSecondary }}>
                {effectiveCount}/{maxPhotos}
              </Text>
            </TouchableOpacity>
          </View>
        )}
      </View>
    </GestureDetector>
  );
}

const styles = StyleSheet.create({
  item: {
    position: 'absolute',
  },
  thumb: {
    borderRadius: 8,
  },
  ghost: {
    zIndex: 999,
    opacity: 0.9,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 8,
    elevation: 8,
  },
  primaryBadge: {
    position: 'absolute',
    bottom: 2,
    left: 2,
    paddingHorizontal: 4,
    paddingVertical: 1,
    borderRadius: 4,
  },
  primaryText: {
    color: '#fff',
    fontSize: 11,
    fontWeight: '700',
  },
  deleteBtn: {
    position: 'absolute',
    top: -6,
    right: -6,
    width: 20,
    height: 20,
    borderRadius: 10,
    backgroundColor: '#FF3B30',
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 10,
  },
  deleteBtnText: {
    color: '#fff',
    fontSize: 12,
    fontWeight: '700',
  },
  loadingPlaceholder: {
    borderRadius: 8,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  addTile: {
    position: 'absolute',
    borderRadius: 8,
    borderWidth: 1.5,
    borderStyle: 'dashed',
  },
  addTileInner: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  addIcon: {
    fontSize: 26,
    fontWeight: '300',
    lineHeight: 28,
  },
});
