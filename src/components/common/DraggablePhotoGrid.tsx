import React, { useState, useRef, useCallback, useEffect } from 'react';
import {
  View, Image, Text, TouchableOpacity, Animated,
  LayoutAnimation, ActivityIndicator, StyleSheet,
  Platform, UIManager, GestureResponderEvent,
} from 'react-native';
import * as Haptics from 'expo-haptics';

if (Platform.OS === 'android' && UIManager.setLayoutAnimationEnabledExperimental) {
  UIManager.setLayoutAnimationEnabledExperimental(true);
}

const THUMB = 80;
const GAP = 4;
const COLS = 4;

interface DraggablePhotoGridProps {
  photos: string[];
  onReorder: (photos: string[]) => void;
  onDelete: (index: number) => void;
  onAdd: () => void;
  maxPhotos: number;
  uploading: boolean;
  /** Parent should set scrollEnabled={false} when dragging */
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
  onDragStart,
  onDragEnd,
  colors,
}: DraggablePhotoGridProps) {
  const [orderedPhotos, setOrderedPhotos] = useState(photos);
  const [draggingIdx, setDraggingIdx] = useState<number | null>(null);

  // Mutable refs — no re-renders during drag
  const isDragging = useRef(false);
  const currentIdx = useRef(-1);
  const photosRef = useRef(photos);
  const gridOrigin = useRef({ x: 0, y: 0 });
  const containerRef = useRef<View>(null);

  const dragX = useRef(new Animated.Value(0)).current;
  const dragY = useRef(new Animated.Value(0)).current;

  // Sync props → state when not dragging
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

  // ── Long-press starts drag ──
  const handleLongPress = useCallback((index: number) => {
    isDragging.current = true;
    currentIdx.current = index;
    photosRef.current = [...orderedPhotos];

    containerRef.current?.measureInWindow((x, y) => {
      gridOrigin.current = { x, y };
    });

    const pos = getGridPos(index);
    dragX.setValue(pos.x);
    dragY.setValue(pos.y);

    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    setDraggingIdx(index);
    onDragStart?.();
  }, [orderedPhotos, getGridPos, onDragStart, dragX, dragY]);

  // ── Finger move — reorder on overlap ──
  const handleMove = useCallback((e: GestureResponderEvent) => {
    if (!isDragging.current) return;

    const { pageX, pageY } = e.nativeEvent;
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
  }, [getIdxFromTouch, dragX, dragY]);

  // ── Release — commit order ──
  const handleRelease = useCallback(() => {
    if (!isDragging.current) return;
    isDragging.current = false;
    onReorder(photosRef.current);
    setDraggingIdx(null);
    onDragEnd?.();
  }, [onReorder, onDragEnd]);

  // Grid container height
  const totalSlots = orderedPhotos.length + (orderedPhotos.length < maxPhotos ? 1 : 0);
  const rowCount = Math.ceil(totalSlots / COLS);
  const gridHeight = rowCount * (THUMB + GAP) - GAP;

  return (
    <View
      ref={containerRef}
      style={{ height: gridHeight, position: 'relative' }}
      // Capture move events once drag mode is active
      onMoveShouldSetResponderCapture={() => isDragging.current}
      onResponderMove={handleMove}
      onResponderRelease={handleRelease}
      onResponderTerminate={handleRelease}
    >
      {orderedPhotos.map((uri, idx) => {
        const pos = getGridPos(idx);
        const isBeingDragged = draggingIdx === idx;

        if (isBeingDragged) {
          return (
            <Animated.View
              key={uri}
              style={[
                styles.item,
                {
                  left: dragX,
                  top: dragY,
                  zIndex: 999,
                  opacity: 0.9,
                  transform: [{ scale: 1.1 }],
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
          <View key={uri} style={[styles.item, { left: pos.x, top: pos.y }]}>
            <TouchableOpacity
              onLongPress={() => handleLongPress(idx)}
              delayLongPress={300}
              activeOpacity={0.8}
              style={styles.touchArea}
            >
              <Image source={{ uri }} style={styles.thumb} />
            </TouchableOpacity>
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

      {/* + Add photo tile */}
      {orderedPhotos.length < maxPhotos && (
        <View
          style={[
            styles.addTile,
            {
              left: getGridPos(orderedPhotos.length).x,
              top: getGridPos(orderedPhotos.length).y,
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
            {uploading ? (
              <ActivityIndicator color={colors.primary} size="small" />
            ) : (
              <>
                <Text style={[styles.addIcon, { color: colors.primary }]}>+</Text>
                <Text style={{ fontSize: 10, color: colors.textSecondary }}>
                  {orderedPhotos.length}/{maxPhotos}
                </Text>
              </>
            )}
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
  touchArea: {
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
