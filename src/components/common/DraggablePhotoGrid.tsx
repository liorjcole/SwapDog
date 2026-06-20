import React, { useState, useRef, useCallback, useEffect } from 'react';
import {
  View, Image, Text, TouchableOpacity, Animated,
  LayoutAnimation, ActivityIndicator, StyleSheet,
  Platform, UIManager, PanResponder, PanResponderInstance,
} from 'react-native';
import * as Haptics from 'expo-haptics';

if (Platform.OS === 'android' && UIManager.setLayoutAnimationEnabledExperimental) {
  UIManager.setLayoutAnimationEnabledExperimental(true);
}

const THUMB = 80;
const GAP = 4;
const COLS = 4;
const LONG_PRESS_MS = 300;
const MOVE_THRESHOLD = 8; // px — cancel long-press if finger wanders before timer

interface DraggablePhotoGridProps {
  photos: string[];
  onReorder: (photos: string[]) => void;
  onDelete: (index: number) => void;
  onAdd: () => void;
  maxPhotos: number;
  uploading: boolean;
  loadingCount?: number;
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
  onDragStart,
  onDragEnd,
  colors,
}: DraggablePhotoGridProps) {
  const [orderedPhotos, setOrderedPhotos] = useState(photos);
  const [draggingIdx, setDraggingIdx] = useState<number | null>(null);

  const isDragging = useRef(false);
  const currentIdx = useRef(-1);
  const photosRef = useRef(photos);
  const gridOrigin = useRef({ x: 0, y: 0 });
  const containerRef = useRef<View>(null);
  const longPressTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const dragX = useRef(new Animated.Value(0)).current;
  const dragY = useRef(new Animated.Value(0)).current;
  const dragScale = useRef(new Animated.Value(1)).current;

  useEffect(() => {
    if (!isDragging.current) {
      setOrderedPhotos(photos);
      photosRef.current = photos;
    }
  }, [photos]);

  const getGridPos = useCallback((idx: number) => ({
    x: (idx % COLS) * (THUMB + GAP),
    y: Math.floor(idx / COLS) * (THUMB + GAP),
  }), []);

  const getIdxFromTouch = useCallback((pageX: number, pageY: number) => {
    const localX = pageX - gridOrigin.current.x;
    const localY = pageY - gridOrigin.current.y;
    const col = Math.max(0, Math.min(Math.floor(localX / (THUMB + GAP)), COLS - 1));
    const row = Math.max(0, Math.floor(localY / (THUMB + GAP)));
    const idx = row * COLS + col;
    return Math.max(0, Math.min(idx, photosRef.current.length - 1));
  }, []);

  const activateDrag = useCallback((index: number) => {
    isDragging.current = true;
    currentIdx.current = index;
    photosRef.current = [...orderedPhotos];

    containerRef.current?.measureInWindow((x, y) => {
      gridOrigin.current = { x, y };
    });

    const pos = getGridPos(index);
    dragX.setValue(pos.x);
    dragY.setValue(pos.y);

    // Scale up animation
    Animated.spring(dragScale, {
      toValue: 1.15,
      useNativeDriver: true,
      speed: 20,
      bounciness: 8,
    }).start();

    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    setDraggingIdx(index);
    onDragStart?.();
  }, [orderedPhotos, getGridPos, onDragStart, dragX, dragY, dragScale]);

  const clearTimer = useCallback(() => {
    if (longPressTimer.current) {
      clearTimeout(longPressTimer.current);
      longPressTimer.current = null;
    }
  }, []);

  // Create a PanResponder for a given photo index
  const makePanResponder = useCallback((index: number): PanResponderInstance => {
    let startX = 0;
    let startY = 0;

    return PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: () => isDragging.current,
      onPanResponderTerminationRequest: () => !isDragging.current,

      onPanResponderGrant: (e) => {
        startX = e.nativeEvent.pageX;
        startY = e.nativeEvent.pageY;

        // Start long-press timer
        clearTimer();
        longPressTimer.current = setTimeout(() => {
          activateDrag(index);
        }, LONG_PRESS_MS);
      },

      onPanResponderMove: (e) => {
        const { pageX, pageY } = e.nativeEvent;

        if (!isDragging.current) {
          // If finger moved too far before long-press fired, cancel
          const dx = Math.abs(pageX - startX);
          const dy = Math.abs(pageY - startY);
          if (dx > MOVE_THRESHOLD || dy > MOVE_THRESHOLD) {
            clearTimer();
          }
          return;
        }

        // Drag mode active — move the floating thumb
        dragX.setValue(pageX - gridOrigin.current.x - THUMB / 2);
        dragY.setValue(pageY - gridOrigin.current.y - THUMB / 2);

        const targetIdx = getIdxFromTouch(pageX, pageY);
        if (targetIdx !== currentIdx.current) {
          LayoutAnimation.configureNext({
            duration: 200,
            update: { type: LayoutAnimation.Types.easeInEaseOut },
          });
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

      onPanResponderRelease: () => {
        clearTimer();
        if (isDragging.current) {
          isDragging.current = false;
          Animated.spring(dragScale, {
            toValue: 1,
            useNativeDriver: true,
            speed: 20,
          }).start();
          onReorder(photosRef.current);
          setDraggingIdx(null);
          onDragEnd?.();
        }
      },

      onPanResponderTerminate: () => {
        clearTimer();
        if (isDragging.current) {
          isDragging.current = false;
          dragScale.setValue(1);
          onReorder(photosRef.current);
          setDraggingIdx(null);
          onDragEnd?.();
        }
      },
    });
  }, [activateDrag, clearTimer, dragX, dragY, dragScale, getIdxFromTouch, onReorder, onDragEnd]);

  // Keep stable PanResponder instances — rebuild when orderedPhotos change
  const panResponders = useRef<PanResponderInstance[]>([]);
  useEffect(() => {
    panResponders.current = orderedPhotos.map((_, idx) => makePanResponder(idx));
  }, [orderedPhotos.length, makePanResponder]);

  const effectiveCount = orderedPhotos.length + loadingCount;
  const showAdd = effectiveCount < maxPhotos && !uploading;
  const totalSlots = effectiveCount + (showAdd ? 1 : 0);
  const rowCount = Math.ceil(totalSlots / COLS);
  const gridHeight = rowCount * (THUMB + GAP) - GAP;

  return (
    <View ref={containerRef} style={{ height: gridHeight, position: 'relative' }}>
      {orderedPhotos.map((uri, idx) => {
        const pos = getGridPos(idx);
        const isBeingDragged = draggingIdx === idx;
        const responder = panResponders.current[idx];

        if (isBeingDragged) {
          return (
            <Animated.View
              key={uri}
              {...(responder?.panHandlers ?? {})}
              style={[
                styles.item,
                {
                  left: dragX,
                  top: dragY,
                  zIndex: 999,
                  opacity: 0.9,
                  transform: [{ scale: dragScale }],
                  shadowColor: '#000',
                  shadowOffset: { width: 0, height: 4 },
                  shadowOpacity: 0.3,
                  shadowRadius: 8,
                  elevation: 8,
                },
              ]}
            >
              <Image source={{ uri }} style={styles.thumb} />
              {idx === 0 && (
                <View style={[styles.primaryBadge, { backgroundColor: colors.primary }]}>
                  <Text style={styles.primaryText}>Primary</Text>
                </View>
              )}
            </Animated.View>
          );
        }

        return (
          <View
            key={uri}
            style={[styles.item, { left: pos.x, top: pos.y }]}
            {...(responder?.panHandlers ?? {})}
          >
            <Image source={{ uri }} style={styles.thumb} />
            {idx === 0 && (
              <View style={[styles.primaryBadge, { backgroundColor: colors.primary }]}>
                <Text style={styles.primaryText}>Primary</Text>
              </View>
            )}
            {/* ✕ delete badge */}
            <TouchableOpacity
              style={styles.deleteBtn}
              onPress={() => onDelete(idx)}
              hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}
            >
              <Text style={styles.deleteBtnText}>✕</Text>
            </TouchableOpacity>
          </View>
        );
      })}

      {/* Loading placeholders */}
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
                backgroundColor: colors.surface,
                borderColor: colors.border,
              },
            ]}
          >
            <ActivityIndicator color={colors.primary} size="small" />
          </View>
        );
      })}

      {/* + Add photo tile */}
      {showAdd && (
        <View
          style={[
            styles.addTile,
            {
              left: getGridPos(effectiveCount).x,
              top: getGridPos(effectiveCount).y,
              borderColor: colors.border,
              backgroundColor: colors.surface,
            },
          ]}
        >
          <TouchableOpacity
            style={styles.addTileInner}
            onPress={onAdd}
            disabled={uploading}
          >
            <Text style={[styles.addIcon, { color: colors.primary }]}>+</Text>
            <Text style={{ fontSize: 10, color: colors.textSecondary }}>
              {effectiveCount}/{maxPhotos}
            </Text>
          </TouchableOpacity>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  item: {
    position: 'absolute',
    width: THUMB,
    height: THUMB,
  },
  thumb: {
    width: THUMB,
    height: THUMB,
    borderRadius: 8,
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
    fontSize: 9,
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
    fontSize: 10,
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
    width: THUMB,
    height: THUMB,
    borderRadius: 8,
    borderWidth: 1.5,
    borderStyle: 'dashed',
  },
  addTileInner: {
    width: THUMB,
    height: THUMB,
    alignItems: 'center',
    justifyContent: 'center',
  },
  addIcon: {
    fontSize: 24,
    fontWeight: '300',
    lineHeight: 28,
  },
});
