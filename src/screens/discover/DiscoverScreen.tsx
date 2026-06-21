import React, {
  useEffect,
  useState,
  useRef,
  useCallback,
  useMemo,
  memo } from 'react';
import {
  View,
  Text,
  FlatList,
  TouchableOpacity,
  StyleSheet,
  Image,
  Alert,
  Modal,
  Platform,
  ActivityIndicator,
  Dimensions,
  Animated,
  PanResponder,
  KeyboardAvoidingView,
  TextInput,
  ListRenderItem,
  RefreshControl } from 'react-native';
import MapView, { Marker, Region } from 'react-native-maps';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import * as Haptics from 'expo-haptics';
import { DiscoverStackParamList } from '../../navigation/types';
import { useAuthContext } from '../../contexts/AuthContext';
import { useTheme } from '../../contexts/ThemeContext';
import { useFocusEffect } from '@react-navigation/native';
import { consumePendingHighlightPost } from '../../utils/highlightStore';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import AvatarImage from '../../components/common/AvatarImage';
import { smartDate, isSameDay } from '../../utils/dateHelpers';
import { useUsers } from '../../hooks/useUsers';
import { useDiscoverLocation } from '../../hooks/useDiscoverLocation';
import { useSwaps } from '../../hooks/useSwaps';
import { useFavorites } from '../../hooks/useFavorites';
import { useBlocking } from '../../hooks/useBlocking';
import { useMessaging } from '../../hooks/useMessaging';
import { User, GeoPoint, SwapPost } from '../../models/types';
import { calculateDistance, formatDistance } from '../../utils/calculateDistance';
import { spacing, borderRadius, shadow, typography } from '../../config/theme';
import EmptyStateView from '../../components/common/EmptyStateView';
import ShimmerLoading from '../../components/common/ShimmerLoading';

// ─── Constants ───────────────────────────────────────────────────────────────

const { width: SCREEN_WIDTH, height: SCREEN_HEIGHT } = Dimensions.get('window');

// Map height — compact: ~27% of screen so the feed gets more space
const MAP_HEIGHT_DEFAULT = Math.round(SCREEN_HEIGHT * 0.27);
const MAP_HEIGHT_MIN = Math.round(SCREEN_HEIGHT * 0.15);
const MAP_HEIGHT_MAX = Math.round(SCREEN_HEIGHT * 0.50);

const HANDLE_HEIGHT = 28;

const CIRCLE_SIZE = Math.min(Math.round(SCREEN_WIDTH * 0.60), 280);
const REGION_DEBOUNCE_MS = 600;

// 3 preset radius options. Pinch-zoom updates radius dynamically beyond 10mi (capped at 30mi).
const RADIUS_OPTIONS = [1, 5, 10] as const;
const MAX_RADIUS_MILES = 30;
type RadiusMiles = (typeof RADIUS_OPTIONS)[number];

const RED = '#FF2D55';

const getCareTypeLabel = (t: string): string => {
  switch (t) {
    case 'overnight': return 'Overnight sitting';
    case 'daySitting': return 'Daytime sitting';
    case 'feeding': return 'Feeding';
    case 'dogWalking': return 'Walk';
    case 'medication': return 'Medication';
    default: return t;
  }
};



/** Map dogIds to display names using post.dogIds/dogNames arrays */
function resolveDogNames(dogIds: string[], post: SwapPost): string {
  if (!dogIds.length || !post.dogIds || !post.dogNames) return '';
  const names = dogIds.map(id => {
    const idx = post.dogIds!.indexOf(id);
    return idx >= 0 ? post.dogNames![idx] : '';
  }).filter(Boolean);
  return names.join(', ');
}
type Props = {
  navigation: NativeStackNavigationProp<DiscoverStackParamList, 'Discover'>;
  route: { params?: { highlightPostId?: string } };
};

// ─── Nearby user type ─────────────────────────────────────────────────────────

interface NearbyUser {
  user: User;
  distanceMiles: number;
  dogCount: number;
}

// ─── Flat feed item types (discriminated union) ───────────────────────────────

type FeedItemSectionHeader = {
  kind: 'section_header';
  id: string;
  title: string;
  count: number;
  isPosts: boolean;
};
type FeedItemPost = { kind: 'post'; id: string; post: SwapPost };
type FeedItemUser = { kind: 'user'; id: string; nu: NearbyUser };
type FeedItemEmpty = { kind: 'empty'; id: string; text: string };
type FeedItemDivider = { kind: 'divider'; id: string };

type FeedItem =
  | FeedItemSectionHeader
  | FeedItemPost
  | FeedItemUser
  | FeedItemEmpty
  | FeedItemDivider;

// ─── Radius Selector ─────────────────────────────────────────────────────────

interface RadiusSelectorProps {
  radiusMiles: number;
  onSelectPreset: (r: RadiusMiles) => void;
}

const RadiusSelector: React.FC<RadiusSelectorProps> = memo(({ radiusMiles, onSelectPreset }) => {
  const { colors } = useTheme();
  const activePreset = (RADIUS_OPTIONS as readonly number[]).includes(radiusMiles)
    ? (radiusMiles as RadiusMiles)
    : null;

  return (
    <View style={styles.radiusRow}>
      <Text style={[styles.radiusLabel, { color: colors.textSecondary }]}>Radius:</Text>
      {RADIUS_OPTIONS.map((r) => {
        const active = r === activePreset;
        return (
          <TouchableOpacity
            key={r}
            onPress={() => {
              void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
              onSelectPreset(r);
            }}
            style={[
              styles.radiusChip,
              {
                backgroundColor: 'transparent',
                borderColor: active ? '#FFFFFF' : colors.border,
                borderWidth: active ? 2 : 1.5 },
            ]}
            accessibilityLabel={`Set radius to ${r} mile${r > 1 ? 's' : ''}`}
            accessibilityState={{ selected: active }}
          >
            <Text style={[styles.radiusChipText, { color: active ? '#FFFFFF' : colors.textSecondary, fontWeight: active ? '700' : '600' }]}>
              {r} mi
            </Text>
          </TouchableOpacity>
        );
      })}
      {/* Live radius display when not on a preset */}
      {activePreset === null && (
        <View style={[styles.radiusChip, { backgroundColor: 'transparent', borderColor: '#FFFFFF', borderWidth: 2 }]}>
          <Text style={[styles.radiusChipText, { color: '#FFFFFF' }]}>
            {radiusMiles < 10 ? radiusMiles.toFixed(1) : Math.round(radiusMiles).toString()} mi
          </Text>
        </View>
      )}
    </View>
  );
});

// ─── Post Card ────────────────────────────────────────────────────────────────

interface PostCardProps {
  post: SwapPost;
  onPress: (postId: string) => void;
  currentUserId?: string;
  isFavorited?: boolean;
  isHighlighted?: boolean;
  pulseScale?: Animated.Value;
  glowOpacity?: Animated.Value;
}

const PostCard: React.FC<PostCardProps> = memo(({ post, onPress, currentUserId, isFavorited, isHighlighted, pulseScale, glowOpacity }) => {
  const handlePostPress = useCallback(() => {
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    onPress(post.id);
  }, [onPress, post.id]);
  const { colors } = useTheme();
  const isOwnPost = !!(currentUserId && post.posterId === currentUserId);
  const startStr = smartDate(post.startDate);
  const endStr = smartDate(post.endDate, { includeYear: true });

  const careLabel = post.careType ? getCareTypeLabel(post.careType) : 'Pet Care';

  return (
    <Animated.View style={isHighlighted && pulseScale && glowOpacity ? { transform: [{ scale: pulseScale }], shadowColor: '#FFFFFF', shadowOpacity: glowOpacity as unknown as number, shadowRadius: 20, shadowOffset: { width: 0, height: 0 }, elevation: 10 } : undefined}>
    <TouchableOpacity
      style={[styles.postCard, { backgroundColor: post.status !== 'open' ? '#E8F5E9' : isOwnPost ? '#1A0A10' : colors.surface, ...shadow.sm, ...(isFavorited && !isOwnPost ? { borderWidth: 2, borderColor: '#FFD700' } : {}), ...(isOwnPost ? { borderWidth: 1.5, borderColor: RED + '80' } : {}), ...(post.status !== 'open' && !isOwnPost ? { borderLeftWidth: 4, borderLeftColor: '#4CAF50' } : {}) }]}
      onPress={handlePostPress}
      accessibilityRole="button"
      accessibilityLabel={`Post for ${post.dogName}`}
    >
      <View style={styles.postCardInner}>
        {/* Own post badge — top right */}
        {isOwnPost && (
          <View style={{ position: 'absolute', top: -1, right: -1, backgroundColor: RED, paddingHorizontal: 10, paddingVertical: 4, borderBottomLeftRadius: 8, borderTopRightRadius: 10, zIndex: 10 }}>
            <Text style={{ fontSize: 12, fontWeight: '800', color: '#FFFFFF', letterSpacing: 0.5 }}>YOUR POST</Text>
          </View>
        )}
        {/* Favorited badge — top right */}
        {isFavorited && !isOwnPost && (
          <Text style={{ position: 'absolute', top: 10, right: 12, fontSize: 14, fontStyle: 'italic', color: '#FFD700', zIndex: 5 }}>
            Favorited pup parent!
          </Text>
        )}
        {/* Dog photos + names row */}
        <View style={styles.cardHeader}>
          {/* Dog avatar(s) */}
          {post.dogPhotoURLs && post.dogPhotoURLs.length > 1 ? (
            <View style={{ flexDirection: 'row', marginRight: 10 }}>
              {post.dogPhotoURLs.map((url, i) => (
                url ? (
                  <Image key={i} source={{ uri: url }} style={[styles.dogThumbLead, { borderColor: colors.border, marginRight: i < post.dogPhotoURLs!.length - 1 ? -8 : 0, zIndex: post.dogPhotoURLs!.length - i }]} />
                ) : (
                  <View key={i} style={[styles.dogThumbLeadPlaceholder, { backgroundColor: RED + '12', marginRight: i < post.dogPhotoURLs!.length - 1 ? -8 : 0, zIndex: post.dogPhotoURLs!.length - i }]}>
                    <Text style={{ fontSize: 24 }}>🐶</Text>
                  </View>
                )
              ))}
            </View>
          ) : post.dogPhotoURL ? (
            <Image source={{ uri: post.dogPhotoURL }} style={[styles.dogThumbLead, { borderColor: colors.border }]} />
          ) : (
            <View style={[styles.dogThumbLeadPlaceholder, { backgroundColor: RED + '12' }]}>
              <Text style={{ fontSize: 24 }}>🐶</Text>
            </View>
          )}
          <View style={styles.headerInfo}>
            <Text style={[styles.dogLine, { color: colors.text, marginBottom: 0 }]} numberOfLines={1}>
              {isFavorited && <Text style={{ color: '#FFD700' }}>★ </Text>}
              {post.dogNames && post.dogNames.length > 1
                ? post.dogNames.join(' & ')
                : post.dogName}
            </Text>
            <Text style={[styles.dateRange, { color: colors.textSecondary }]}>{isSameDay(post.startDate, post.endDate) ? startStr : `${startStr} – ${endStr}`}</Text>
          </View>
          {post.compensationType && (
            <Text style={{ fontSize: 15, fontWeight: '700', color: colors.text }} numberOfLines={1}>
              💰 {post.compensationType === 'points'
                ? `${post.pointsOffered ?? post.pointsCost ?? 0} points`
                : post.compensationType === 'payment'
                  ? `$${post.totalPayment ?? post.paymentAmount ?? 0}${post.paymentRate ? (post.paymentRate === 'per_hour' ? '/hr' : '/day') : ''}`
                  : post.compensationType === 'either'
                    ? `${post.pointsOffered ?? post.pointsCost ?? 0} pts or $${post.totalPayment ?? post.paymentAmount ?? 0}`
                    : 'TBD'}
            </Text>
          )}
        </View>

        {/* ── Full Care Details ── */}
        <View style={{ marginTop: 8, borderTopWidth: 0.5, borderTopColor: colors.border, paddingTop: 8 }}>
          {/* Primary care type */}
          <Text style={{ fontSize: 16, fontWeight: '700', color: colors.text, marginBottom: 4 }}>
            {careLabel}
          </Text>

          {/* Day sitting / overnight times */}
          {(post.careType === 'daySitting' || post.careType === 'overnight') && post.startTime && post.endTime && (
            <Text style={{ fontSize: 14, color: colors.textSecondary, marginBottom: 2 }}>
              🕐  {post.startTime} – {post.endTime}
            </Text>
          )}

          {/* Feeding slots */}
          {post.feedingSlots && post.feedingSlots.length > 0 && (
            <View style={{ marginTop: 6 }}>
              <Text style={{ fontSize: 15, fontWeight: '600', color: colors.text }}>🍽️ Feeding</Text>
              {post.feedingSlots.map((slot, i) => (
                <Text key={i} style={{ fontSize: 14, color: colors.textSecondary, marginLeft: 8, marginTop: 1 }}>
                  {slot.time}{slot.daily ? '  ·  repeat daily' : ''}
                  {slot.dogIds.length > 0 && post.dogNames && post.dogNames.length > 1
                    ? `  ·  ${resolveDogNames(slot.dogIds, post)}`
                    : ''}
                </Text>
              ))}
            </View>
          )}

          {/* Medication slots */}
          {post.medicationSlots && post.medicationSlots.length > 0 && (
            <View style={{ marginTop: 6 }}>
              <Text style={{ fontSize: 15, fontWeight: '600', color: colors.text }}>💊 Medication</Text>
              {post.medicationSlots.map((slot, i) => (
                <Text key={i} style={{ fontSize: 14, color: colors.textSecondary, marginLeft: 8, marginTop: 1 }} numberOfLines={1}>
                  {slot.time}{slot.daily ? '  ·  repeat daily' : ''}{slot.details ? ` — ${slot.details}` : ''}
                  {slot.dogIds.length > 0 && post.dogNames && post.dogNames.length > 1
                    ? `  ·  ${resolveDogNames(slot.dogIds, post)}`
                    : ''}
                </Text>
              ))}
            </View>
          )}

          {/* Walk sessions */}
          {post.walkSessions && post.walkSessions.length > 0 && (
            <View style={{ marginTop: 6 }}>
              <Text style={{ fontSize: 15, fontWeight: '600', color: colors.text }}>🐕 Walks</Text>
              {post.walkSessions.map((ws, i) => {
                const durLabel = ws.durationMins >= 60
                  ? `${Math.floor(ws.durationMins / 60)}h${ws.durationMins % 60 > 0 ? ` ${ws.durationMins % 60}m` : ''}`
                  : `${ws.durationMins}m`;
                return (
                  <Text key={i} style={{ fontSize: 14, color: colors.textSecondary, marginLeft: 8, marginTop: 1 }}>
                    {ws.startTime} – {ws.endTime}  ({durLabel}){ws.repeatDaily ? '  ·  repeat daily' : ''}
                    {ws.dogIds.length > 0 && post.dogNames && post.dogNames.length > 1
                      ? `  ·  ${resolveDogNames(ws.dogIds, post)}`
                      : ''}
                  </Text>
                );
              })}
            </View>
          )}

          {/* Play sessions */}
          {post.playSessions && post.playSessions.length > 0 && (
            <View style={{ marginTop: 6 }}>
              <Text style={{ fontSize: 15, fontWeight: '600', color: colors.text }}>🎾 Playtime</Text>
              {post.playSessions.map((ps, i) => {
                const durLabel = ps.durationMins >= 60
                  ? `${Math.floor(ps.durationMins / 60)}h${ps.durationMins % 60 > 0 ? ` ${ps.durationMins % 60}m` : ''}`
                  : `${ps.durationMins}m`;
                return (
                  <Text key={i} style={{ fontSize: 14, color: colors.textSecondary, marginLeft: 8, marginTop: 1 }}>
                    {ps.flexible
                      ? `Flexible · ${durLabel}`
                      : `${ps.startTime} – ${ps.endTime}  (${durLabel})`}
                    {ps.repeatDaily ? '  ·  repeat daily' : ''}
                    {ps.dogIds.length > 0 && post.dogNames && post.dogNames.length > 1
                      ? `  ·  ${resolveDogNames(ps.dogIds, post)}`
                      : ''}
                  </Text>
                );
              })}
            </View>
          )}

          {/* Free-text care details */}
          {post.careDetails ? (
            <View style={{ backgroundColor: 'rgba(0,0,0,0.25)', borderRadius: 10, paddingVertical: 10, paddingHorizontal: 14, marginTop: 8 }}>
              <Text style={{ fontSize: 16, color: colors.textSecondary, fontStyle: 'italic' }} numberOfLines={3}>
                "{post.careDetails}"
              </Text>
            </View>
          ) : null}


        </View>

        {post.status !== 'open' && (
          <View style={styles.takenBadge}>
            <Text style={styles.takenBadgeText}>Sitter Found</Text>
          </View>
        )}

        {post.status === 'open' && currentUserId && (post.respondedBy ?? []).some(r => r.userId === currentUserId) && (
          <View style={styles.respondedBadge}>
            <Text style={styles.respondedBadgeText}>Messaged ✓</Text>
          </View>
        )}

        <View style={[styles.detailsBtn, isFavorited && !isOwnPost && { borderColor: '#FFD700' }]}>
          <Text style={[styles.detailsBtnText, isFavorited && !isOwnPost && { color: '#FFD700' }]}>See Full Details</Text>
        </View>
      </View>
    </TouchableOpacity>
    </Animated.View>
  );
});

// ─── User Row ────────────────────────────────────────────────────────────────

interface UserRowProps {
  user: User;
  distanceMiles: number;
  dogCount: number;
  onPress: (userId: string) => void;
}

const UserRow: React.FC<UserRowProps> = memo(({ user, distanceMiles, dogCount, onPress }) => {
  const handleUserPress = useCallback(() => {
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    onPress(user.id);
  }, [onPress, user.id]);
  const { colors } = useTheme();
  return (
    <TouchableOpacity
      style={[styles.userRow, { backgroundColor: colors.surface, ...shadow.sm }]}
      onPress={handleUserPress}
      accessibilityLabel={`${user.displayName}, ${formatDistance(distanceMiles)}`}
      accessibilityRole="button"
      accessibilityHint="Opens this user's full profile"
    >
      <AvatarImage
        photoURL={user.photoURL}
        displayName={user.displayName}
        size={52}
        style={styles.avatar}
      />
      <View style={styles.userInfo}>
        <Text style={[styles.userName, { color: colors.text }]}>{user.displayName}</Text>
        <Text style={[styles.userDistance, { color: colors.primary }]}>
          {formatDistance(distanceMiles)}
        </Text>
        {dogCount > 0 && (
          <Text style={[styles.userDogs, { color: colors.textSecondary }]}>
            {dogCount} dog{dogCount !== 1 ? 's' : ''}
          </Text>
        )}
      </View>
      <Text style={[styles.chevron, { color: colors.textSecondary }]}>›</Text>
    </TouchableOpacity>
  );
});

// ─── Location Override Modal ──────────────────────────────────────────────────

interface LocationModalProps {
  visible: boolean;
  onClose: () => void;
  onConfirm: (coords: GeoPoint, label: string) => void;
  onUseCurrentLocation: () => void;
  isOverride: boolean;
}

interface NominatimResult {
  place_id: number;
  display_name: string;
  lat: string;
  lon: string;
}

const LocationModal: React.FC<LocationModalProps> = ({
  visible, onClose, onConfirm, onUseCurrentLocation, isOverride }) => {
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const [query, setQuery] = useState('');
  const [suggestions, setSuggestions] = useState<NominatimResult[]>([]);
  const [fetching, setFetching] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (!visible) { setQuery(''); setSuggestions([]); }
  }, [visible]);

  const fetchSuggestions = useCallback((q: string) => {
    if (q.trim().length < 2) { setSuggestions([]); return; }
    setFetching(true);
    void fetch(
      `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(q)}&format=json&addressdetails=1&limit=5&countrycodes=us`,
      { headers: { 'Accept-Language': 'en', 'User-Agent': 'SwapDogApp/1.0' } },
    )
      .then((r) => {
        if (!r || !r.ok) throw new Error(`Geocode request failed: ${r?.status ?? 'no response'}`);
        return r.json() as Promise<NominatimResult[]>;
      })
      .then((results) => setSuggestions(results))
      .catch(() => setSuggestions([]))
      .finally(() => setFetching(false));
  }, []);

  const handleChangeText = useCallback((text: string) => {
    setQuery(text);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => fetchSuggestions(text), 300);
  }, [fetchSuggestions]);

  const handleSelectSuggestion = useCallback((item: NominatimResult) => {
    const lat = parseFloat(item.lat);
    const lng = parseFloat(item.lon);
    const parts = item.display_name.split(',');
    const label = parts.slice(0, 3).join(',').trim();
    setSuggestions([]);
    setQuery('');
    onConfirm({ latitude: lat, longitude: lng }, label);
  }, [onConfirm]);

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet">
      <KeyboardAvoidingView
        style={{ flex: 1, backgroundColor: colors.background }}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <View style={[styles.modalSheet, { paddingTop: Math.max(insets.top, 16) + 8 }]}>
          {/* Header row with title + Cancel */}
          <View style={styles.modalHeader}>
            <Text style={[styles.modalTitle, { color: colors.text }]}>Change Location</Text>
            <TouchableOpacity onPress={onClose} hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}>
              <Text style={[styles.modalCancelText, { color: colors.primary }]}>Cancel</Text>
            </TouchableOpacity>
          </View>

          <Text style={[styles.modalSubtitle, { color: colors.textSecondary }]}>
            Search for a city, neighborhood, or address to find dogs nearby.
          </Text>

          <View style={styles.autocompleteWrapper}>
            <TextInput
              style={[styles.searchInput, { backgroundColor: colors.surface, borderColor: colors.border, color: colors.text }]}
              placeholder="e.g. Brooklyn, NY or 27 Ridge Dr"
              placeholderTextColor={colors.textSecondary}
              value={query}
              onChangeText={handleChangeText}
              autoFocus
              clearButtonMode="while-editing"
              returnKeyType="search"
              accessibilityLabel="Search for a location"
            />
            {fetching && (
              <View style={styles.resolvingRow}>
                <ActivityIndicator color={colors.primary} size="small" />
                <Text style={[styles.resolvingText, { color: colors.textSecondary }]}>Searching…</Text>
              </View>
            )}
            {suggestions.length > 0 && (
              <View style={[styles.dropdown, { backgroundColor: colors.surface, borderColor: colors.border }]}>
                {suggestions.map((item) => (
                  <TouchableOpacity
                    key={item.place_id}
                    style={[styles.dropdownItem, { borderBottomColor: colors.border }]}
                    onPress={() => handleSelectSuggestion(item)}
                    accessibilityLabel={item.display_name}
                    accessibilityRole="button"
                  >
                    <Text style={[styles.dropdownItemText, { color: colors.text }]} numberOfLines={2}>
                      {item.display_name}
                    </Text>
                  </TouchableOpacity>
                ))}
              </View>
            )}
          </View>

          {isOverride && (
            <TouchableOpacity
              style={[styles.modalBtnOutline, { borderColor: colors.secondary }]}
              onPress={() => { onUseCurrentLocation(); onClose(); }}
            >
              <Text style={[styles.modalBtnOutlineText, { color: colors.secondary }]}>
                📡 Use My Current Location
              </Text>
            </TouchableOpacity>
          )}
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
};

// ─── Section Header Row ───────────────────────────────────────────────────────

interface SectionHeaderRowProps {
  item: FeedItemSectionHeader;
  onCreatePost?: () => void;
}
const SectionHeaderRow: React.FC<SectionHeaderRowProps> = memo(({ item, onCreatePost }) => {
  const { colors } = useTheme();
  return (
    <View style={{ backgroundColor: 'transparent', paddingVertical: spacing.md, marginBottom: spacing.sm }}>
      <View style={{ flexDirection: 'row', alignItems: 'center' }}>
        <Text style={[styles.sectionHeaderText, { color: '#FFFFFF', fontSize: item.isPosts ? 20 : 16, fontWeight: '800' as const, flex: 1 }]}>
          {item.title}
        </Text>
        {item.isPosts && onCreatePost && (
          <TouchableOpacity
            onPress={onCreatePost}
            style={styles.createPostBtn}
            accessibilityLabel="Create a new post"
            accessibilityRole="button"
          >
            <Text style={styles.createPostBtnText}>Create Post</Text>
          </TouchableOpacity>
        )}
      </View>
      {item.isPosts && item.count > 0 && (
        <Text style={{ color: colors.textSecondary, fontSize: 15, fontWeight: '600', marginTop: 4 }}>
          {item.count} active {item.count === 1 ? 'post' : 'posts'}
        </Text>
      )}
      {!item.isPosts && item.count > 0 && (
        <View style={[styles.sectionBadge, { backgroundColor: colors.textSecondary, alignSelf: 'flex-start', marginTop: 4 }]}>
          <Text style={styles.sectionBadgeText}>{item.count}</Text>
        </View>
      )}
    </View>
  );
});

// ─── Feed sub-rows (memoized, own their own colors) ──────────────────────────

const FeedEmptyRow: React.FC<{ text: string }> = memo(({ text }) => {
  const { colors } = useTheme();
  return (
    <View style={[styles.sectionEmpty, { backgroundColor: colors.background }]}>
      <Text style={[styles.sectionEmptyText, { color: colors.textSecondary }]}>{text}</Text>
    </View>
  );
});

const FeedDividerRow: React.FC = memo(() => {
  const { colors } = useTheme();
  return <View style={[styles.sectionDivider, { backgroundColor: colors.border }]} />;
});

// ─── Main Screen ─────────────────────────────────────────────────────────────

const DiscoverScreen: React.FC<Props> = ({ navigation, route }) => {
  const { colors } = useTheme();
  const { userProfile } = useAuthContext();
  const { getUsersByLocation } = useUsers();
  const { getAreaPosts } = useSwaps();
  const { favoriteIds } = useFavorites();
  const { hiddenUserIds } = useBlocking();
  const { getOrCreateConversation, sendMessage } = useMessaging();

  const { location, loading: locationLoading, setLocationOverride, clearLocationOverride } = useDiscoverLocation();

  const [radiusMiles, setRadiusMiles] = useState<number>(5);
  const [nearbyUsers, setNearbyUsers] = useState<NearbyUser[]>([]);
  const [areaPosts, setAreaPosts] = useState<SwapPost[]>([]);
  const [usersLoading, setUsersLoading] = useState(false);
  const [postsLoading, setPostsLoading] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [locationModalVisible, setLocationModalVisible] = useState(false);
  const [mapViewHeight, setMapViewHeight] = useState(MAP_HEIGHT_DEFAULT);
  // Track whether first location+data fetch has completed (eliminates feed flash)
  const [initialLoadDone, setInitialLoadDone] = useState(false);

  // "Last known good" refs — once loaded, feed never goes blank during re-fetches
  const lastPostsRef = useRef<SwapPost[]>([]);
  const lastUsersRef = useRef<NearbyUser[]>([]);
  const initialPostsDoneRef = useRef(false);
  const initialUsersDoneRef = useRef(false);

  const mapRef = useRef<MapView>(null);
  const flatListRef = useRef<FlatList<FeedItem>>(null);
  const [highlightPostId, setHighlightPostId] = useState<string | null>(null);
  const pulseAnim = useRef(new Animated.Value(1)).current;
  const glowAnim = useRef(new Animated.Value(0)).current;
  const isProgrammaticMoveRef = useRef(false);
  const regionDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const fetchDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // ── Animated map height ────────────────────────────────────────────────────
  const mapHeightAnim = useRef(new Animated.Value(MAP_HEIGHT_DEFAULT)).current;
  const committedMapHeight = useRef(MAP_HEIGHT_DEFAULT);

  const panResponder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: () => true,
      onPanResponderGrant: () => {
        mapHeightAnim.stopAnimation((val) => { committedMapHeight.current = val; });
      },
      onPanResponderMove: (_evt, gestureState) => {
        const clamped = Math.max(MAP_HEIGHT_MIN, Math.min(MAP_HEIGHT_MAX, committedMapHeight.current + gestureState.dy));
        mapHeightAnim.setValue(clamped);
      },
      onPanResponderRelease: (_evt, gestureState) => {
        const clamped = Math.max(MAP_HEIGHT_MIN, Math.min(MAP_HEIGHT_MAX, committedMapHeight.current + gestureState.dy));
        const midDown = (MAP_HEIGHT_MIN + MAP_HEIGHT_DEFAULT) / 2;
        const midUp = (MAP_HEIGHT_DEFAULT + MAP_HEIGHT_MAX) / 2;
        const snapTarget = clamped < midDown ? MAP_HEIGHT_MIN : clamped > midUp ? MAP_HEIGHT_MAX : MAP_HEIGHT_DEFAULT;
        committedMapHeight.current = snapTarget;
        Animated.spring(mapHeightAnim, { toValue: snapTarget, useNativeDriver: false, bounciness: 4 }).start();
      } }),
  ).current;

  // ── Fetch nearby users ─────────────────────────────────────────────────────
  const fetchNearby = useCallback(async () => {
    if (!location) return;
    setUsersLoading(true);
    try {
      const radiusKm = radiusMiles * 1.60934;
      const all = await getUsersByLocation(location.coords, radiusKm);
      const filtered = all.filter((u) => u.id !== userProfile?.id && u.location != null);
      const withDistance: NearbyUser[] = filtered
        .map((u) => ({
          user: u,
          distanceMiles: calculateDistance(
            location.coords.latitude, location.coords.longitude,
            u.location!.latitude, u.location!.longitude,
          ),
          dogCount: 0 }))
        .sort((a, b) => a.distanceMiles - b.distanceMiles);
      setNearbyUsers(withDistance);
      lastUsersRef.current = withDistance;
    } catch { /* silent */ }
    finally {
      setUsersLoading(false);
      if (!initialUsersDoneRef.current) {
        initialUsersDoneRef.current = true;
        if (initialPostsDoneRef.current) setInitialLoadDone(true);
      }
    }
  }, [location, radiusMiles, userProfile?.id, getUsersByLocation]);

  // ── Fetch area posts ──────────────────────────────────────────────────────
  const fetchAreaPosts = useCallback(async () => {
    if (!location) return;
    setPostsLoading(true);
    try {
      const posts = await getAreaPosts(
        { latitude: location.coords.latitude, longitude: location.coords.longitude },
        radiusMiles,
      );
      const filtered = posts; // Include own posts in feed
      setAreaPosts(filtered);
      lastPostsRef.current = filtered;
    } catch { /* silent */ }
    finally {
      setPostsLoading(false);
      if (!initialPostsDoneRef.current) {
        initialPostsDoneRef.current = true;
        if (initialUsersDoneRef.current) setInitialLoadDone(true);
      }
    }
  }, [location, radiusMiles, userProfile?.id, getAreaPosts]);

  // ── Combined debounced fetch — prevents rapid re-fetches on radius changes ─────
  useEffect(() => {
    if (fetchDebounceRef.current) clearTimeout(fetchDebounceRef.current);
    fetchDebounceRef.current = setTimeout(() => {
      void fetchNearby();
      void fetchAreaPosts();
    }, 300);
    return () => {
      if (fetchDebounceRef.current) clearTimeout(fetchDebounceRef.current);
    };
  }, [fetchNearby, fetchAreaPosts]);

  // ── Map zoom helpers ──────────────────────────────────────────────────────
  const animateMapToRadius = useCallback(
    (lat: number, lng: number, miles: number, currentMapHeight: number) => {
      if (!mapRef.current) return;
      const heightToUse = currentMapHeight > 0 ? currentMapHeight : MAP_HEIGHT_DEFAULT;
      const ratio = heightToUse / CIRCLE_SIZE;
      const delta = Math.max(0.005, (miles / 69) * 2 * ratio);
      isProgrammaticMoveRef.current = true;
      mapRef.current.animateToRegion({ latitude: lat, longitude: lng, latitudeDelta: delta, longitudeDelta: delta }, 600);
    },
    [],
  );

  useEffect(() => {
    if (!location) return;
    animateMapToRadius(location.coords.latitude, location.coords.longitude, radiusMiles, mapViewHeight);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [location]);

  const handleRegionChangeComplete = useCallback(
    (region: Region) => {
      if (isProgrammaticMoveRef.current) { isProgrammaticMoveRef.current = false; return; }
      if (regionDebounceRef.current) clearTimeout(regionDebounceRef.current);
      regionDebounceRef.current = setTimeout(() => {
        const heightToUse = mapViewHeight > 0 ? mapViewHeight : MAP_HEIGHT_DEFAULT;
        const ratio = CIRCLE_SIZE / heightToUse;
        const visibleRadiusMiles = (region.latitudeDelta / 2) * 69 * ratio;
        const rounded = Math.round(visibleRadiusMiles * 10) / 10;
        setRadiusMiles((prev) => {
          const capped = Math.min(rounded, MAX_RADIUS_MILES);
          return Math.abs(capped - prev) >= 0.2 ? capped : prev;
        });
        // Recenter the map on the pin with the new zoom level so the radius
        // circle stays centered after a user pinch-zoom.
        if (location && mapRef.current) {
          isProgrammaticMoveRef.current = true;
          mapRef.current.animateToRegion(
            {
              latitude: location.coords.latitude,
              longitude: location.coords.longitude,
              latitudeDelta: region.latitudeDelta,
              longitudeDelta: region.longitudeDelta },
            300,
          );
        }
      }, REGION_DEBOUNCE_MS);
    },
    [mapViewHeight, location],
  );

  const handlePresetSelect = useCallback(
    (r: RadiusMiles) => {
      setRadiusMiles(r);
      if (location) animateMapToRadius(location.coords.latitude, location.coords.longitude, r, mapViewHeight);
    },
    [location, animateMapToRadius, mapViewHeight],
  );

  // ── Location confirm ──────────────────────────────────────────────────────
  const handleLocationConfirm = useCallback(async (coords: GeoPoint, label: string) => {
    await setLocationOverride(coords, label);
    setLocationModalVisible(false);
  }, [setLocationOverride]);

  // ── Build flat feed data (discriminated union) ─────────────────────────────
  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    try {
      await Promise.all([fetchNearby(), fetchAreaPosts()]);
    } catch { /* silent */ }
    finally { setRefreshing(false); }
  }, [fetchNearby, fetchAreaPosts]);

  const feedData: FeedItem[] = useMemo(() => {
    const milesLabel = radiusMiles < 10 ? radiusMiles.toFixed(1) : Math.round(radiusMiles).toString();
    // Use last-known-good refs as fallback so the feed never goes blank
    // during subsequent location/radius changes after the initial load
    const rawPosts = areaPosts.length > 0 ? areaPosts : lastPostsRef.current;
    const displayPosts = rawPosts.filter(p => !hiddenUserIds.has(p.posterId));
    const displayUsers = nearbyUsers.length > 0 ? nearbyUsers : lastUsersRef.current;
    const items: FeedItem[] = [];

    // Split posts into available vs taken
    const availablePosts = displayPosts.filter(p => p.status === 'open');
    const takenPosts = displayPosts.filter(p => p.status !== 'open');

    const sortPosts = (posts: typeof displayPosts) => [...posts].sort((a, b) => {
      const aFav = favoriteIds.has(a.posterId) ? 1 : 0;
      const bFav = favoriteIds.has(b.posterId) ? 1 : 0;
      if (aFav !== bFav) return bFav - aFav;
      const aTime = a.startDate instanceof Date ? a.startDate.getTime() : new Date(a.startDate).getTime();
      const bTime = b.startDate instanceof Date ? b.startDate.getTime() : new Date(b.startDate).getTime();
      return aTime - bTime;
    });

    // Section 1: Available posts
    items.push({ kind: 'section_header', id: 'header_posts', title: 'Active Posts Nearby', count: availablePosts.length, isPosts: true });
    if (availablePosts.length === 0) {
      items.push({ kind: 'empty', id: 'empty_posts', text: 'No active posts in your area right now' });
    } else {
      sortPosts(availablePosts).forEach((p) => items.push({ kind: 'post', id: p.id, post: p }));
    }

    // Section 2: Taken posts (sitter found)
    if (takenPosts.length > 0) {
      items.push({ kind: 'section_header', id: 'header_taken', title: 'Sitter Found', count: takenPosts.length, isPosts: false });
      sortPosts(takenPosts).forEach((p) => items.push({ kind: 'post', id: p.id, post: p }));
    }

    return items;
  }, [areaPosts, nearbyUsers, radiusMiles, favoriteIds, hiddenUserIds]);

  // ── Auto-collapse map when scrolling posts ──────────────────────────────────
  const lastScrollY = useRef(0);
  const mapCollapsed = useRef(false);
  const handleListScroll = (event: { nativeEvent: { contentOffset: { y: number } } }) => {
    const y = event.nativeEvent.contentOffset.y;
    lastScrollY.current = y;

    if (y > 10 && !mapCollapsed.current) {
      // User scrolled down — collapse map once, smoothly
      mapCollapsed.current = true;
      committedMapHeight.current = MAP_HEIGHT_MIN;
      Animated.timing(mapHeightAnim, { toValue: MAP_HEIGHT_MIN, duration: 250, useNativeDriver: false }).start();
    } else if (y <= 2 && mapCollapsed.current) {
      // User scrolled back to top — restore once, smoothly
      mapCollapsed.current = false;
      committedMapHeight.current = MAP_HEIGHT_DEFAULT;
      Animated.timing(mapHeightAnim, { toValue: MAP_HEIGHT_DEFAULT, duration: 250, useNativeDriver: false }).start();
    }
  };

    // ── FlatList render ────────────────────────────────────────────────────────
  const handleNavigateToPost = useCallback(
    (postId: string) => navigation.navigate('PostDetail', { postId }),
    [navigation],
  );

  const handleNavigateToUser = useCallback(
    (userId: string) => navigation.navigate('UserDetail', { userId }),
    [navigation],
  );

  const handleNavigateToCreatePost = useCallback(
    () => navigation.navigate('CreatePost'),
    [navigation],
  );

  // ── Highlight newly created post ──
  // Uses a module-level store instead of route params because params
  // don't reliably propagate through nested tab→stack navigators
  // when the Discover screen is already mounted.
  const pendingHighlightRef = useRef<string | null>(null);
  const feedDataRef = useRef(feedData);
  feedDataRef.current = feedData;

  // Poll for the new post after focus (Firestore takes a moment)
  const startHighlightPolling = useCallback((hpId: string) => {
    let attempts = 0;
    const maxAttempts = 15; // 15 × 500ms = 7.5s max wait

    const tryFind = () => {
      attempts++;
      const currentFeed = feedDataRef.current;
      const idx = currentFeed.findIndex(item => item.kind === 'post' && item.id === hpId);

      if (idx !== -1) {
        // Found it — scroll + pulse
        setHighlightPostId(hpId);

        setTimeout(() => {
          flatListRef.current?.scrollToIndex({ index: idx, animated: true, viewPosition: 0.4 });
        }, 300);

        setTimeout(() => {
          Animated.sequence([
            Animated.parallel([
              Animated.timing(pulseAnim, { toValue: 1.04, duration: 300, useNativeDriver: false }),
              Animated.timing(glowAnim, { toValue: 1, duration: 300, useNativeDriver: false }),
            ]),
            Animated.parallel([
              Animated.timing(pulseAnim, { toValue: 1, duration: 300, useNativeDriver: false }),
              Animated.timing(glowAnim, { toValue: 0, duration: 300, useNativeDriver: false }),
            ]),
            Animated.parallel([
              Animated.timing(pulseAnim, { toValue: 1.04, duration: 300, useNativeDriver: false }),
              Animated.timing(glowAnim, { toValue: 1, duration: 300, useNativeDriver: false }),
            ]),
            Animated.parallel([
              Animated.timing(pulseAnim, { toValue: 1, duration: 300, useNativeDriver: false }),
              Animated.timing(glowAnim, { toValue: 0, duration: 300, useNativeDriver: false }),
            ]),
          ]).start(() => {
            setHighlightPostId(null);
          });
        }, 1000);
        return;
      }

      if (attempts < maxAttempts) {
        // Re-fetch and try again
        void fetchAreaPosts();
        setTimeout(tryFind, 500);
      }
    };

    // First fetch, then start looking
    void fetchAreaPosts();
    setTimeout(tryFind, 800);
  }, [fetchAreaPosts, pulseAnim, glowAnim]);

  // Check for pending highlight every time this screen gets focus
  useFocusEffect(
    useCallback(() => {
      const hpId = consumePendingHighlightPost();
      if (!hpId) return;
      startHighlightPolling(hpId);
    }, [startHighlightPolling])
  );

  const renderFeedItem: ListRenderItem<FeedItem> = useCallback(
    ({ item }) => {
      switch (item.kind) {
        case 'section_header':
          return <SectionHeaderRow item={item} onCreatePost={item.isPosts ? handleNavigateToCreatePost : undefined} />;
        case 'post':
          return <PostCard post={item.post} onPress={handleNavigateToPost} currentUserId={userProfile?.id} isFavorited={favoriteIds.has(item.post.posterId)} isHighlighted={highlightPostId === item.post.id} pulseScale={pulseAnim} glowOpacity={glowAnim} />;
        case 'user':
          return (
            <UserRow
              user={item.nu.user}
              distanceMiles={item.nu.distanceMiles}
              dogCount={item.nu.dogCount}
              onPress={handleNavigateToUser}
            />
          );
        case 'empty':
          return <FeedEmptyRow text={item.text} />;
        case 'divider':
          return <FeedDividerRow />;
        default:
          return null;
      }
    },
    [handleNavigateToPost, handleNavigateToUser, handleNavigateToCreatePost, highlightPostId, pulseAnim, glowAnim, userProfile?.id, favoriteIds],
  );

  const keyExtractor = useCallback((item: FeedItem) => item.id, []);

  // ── Loading state ────────────────────────────────────────────────────────────
  if (locationLoading || !location) {
    return (
      <View style={[styles.container, { backgroundColor: colors.background }]}>
        <View style={{ height: MAP_HEIGHT_DEFAULT, margin: spacing.md }}>
          <ShimmerLoading height={MAP_HEIGHT_DEFAULT} borderRadius={borderRadius.lg} />
        </View>
        {[1, 2, 3].map((i) => (
          <View key={i} style={{ marginHorizontal: spacing.md, marginBottom: spacing.sm }}>
            <ShimmerLoading height={72} borderRadius={borderRadius.md} />
          </View>
        ))}
      </View>
    );
  }

  const initialRegion: Region = {
    latitude: location.coords.latitude,
    longitude: location.coords.longitude,
    latitudeDelta: Math.max(0.01, (radiusMiles / 69) * 2 * (MAP_HEIGHT_DEFAULT / CIRCLE_SIZE)),
    longitudeDelta: Math.max(0.01, (radiusMiles / 69) * 2 * (MAP_HEIGHT_DEFAULT / CIRCLE_SIZE)) };

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>

      {/* ── MAP ── */}
      <Animated.View
        style={[styles.mapContainer, {
          height: mapHeightAnim,
          borderBottomLeftRadius: borderRadius.lg,
          borderBottomRightRadius: borderRadius.lg,
          overflow: 'hidden' }]}
        onLayout={(e) => { const h = e.nativeEvent.layout.height; if (h > 0) setMapViewHeight(h); }}
      >
        <MapView
          ref={mapRef}
          style={StyleSheet.absoluteFillObject}
          initialRegion={initialRegion}
          showsUserLocation={false}
          showsMyLocationButton={false}
          onRegionChangeComplete={handleRegionChangeComplete}
        >
          <Marker
            coordinate={location.coords}
            title={location.isOverride ? (location.label ?? 'Custom Location') : 'Your Location'}
            anchor={{ x: 0.5, y: 0.5 }}
          >
            <View style={styles.currentUserDot} />
          </Marker>
          {/* Other user dots — no info, just location markers */}
          {nearbyUsers.map((nu) => (
            nu.user.location ? (
              <Marker
                key={nu.user.id}
                coordinate={{
                  latitude: nu.user.location.latitude,
                  longitude: nu.user.location.longitude }}
                anchor={{ x: 0.5, y: 0.5 }}
              >
                <View style={styles.userDot} />
              </Marker>
            ) : null
          ))}
        </MapView>

        <View style={styles.circleOverlayContainer} pointerEvents="none">
          <View style={[styles.circleOverlay, {
            width: CIRCLE_SIZE, height: CIRCLE_SIZE,
            borderRadius: CIRCLE_SIZE / 2,
            borderColor: RED, backgroundColor: RED + '1A' }]} />
          <Text style={[styles.circleRadiusLabel, { color: RED }]}>
            {radiusMiles < 10 ? radiusMiles.toFixed(1) : Math.round(radiusMiles).toString()} mi
          </Text>
        </View>

        <TouchableOpacity
          style={[styles.locationBtn, { backgroundColor: colors.surface, ...shadow.md }]}
          onPress={() => { void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); setLocationModalVisible(true); }}
          accessibilityLabel="Change search location"
        >
          <Text style={[styles.locationBtnText, { color: colors.text }]}>
            {location.isOverride ? `${location.label ?? 'Custom'}` : 'Change Location'}
          </Text>
        </TouchableOpacity>
      </Animated.View>

      {/* ── DRAG HANDLE ── */}
      <View
        style={[styles.dragHandle, { backgroundColor: colors.surface, borderColor: colors.border }]}
        {...panResponder.panHandlers}
        accessibilityLabel="Drag to resize map"
        accessibilityRole="adjustable"
      >
        <View style={[styles.dragPill, { backgroundColor: colors.border }]} />
      </View>

      {/* ── RADIUS SELECTOR (3 presets, single line) ── */}
      <View style={[styles.radiusContainer, { backgroundColor: colors.surface, borderColor: colors.border }]}>
        <RadiusSelector radiusMiles={radiusMiles} onSelectPreset={handlePresetSelect} />
      </View>

      {/* ── COMBINED FEED ── */}
      {/* Show a clean loading indicator until the FIRST location+data fetch
          completes. This eliminates the flash: empty feed → shimmer → data.
          After initialLoadDone, ref fallbacks ensure we never go blank again. */}
      {!initialLoadDone ? (
        <View style={[styles.listLoadingContainer, { justifyContent: 'center', alignItems: 'center' }]}>
          <ActivityIndicator color={colors.primary} size="large" />
        </View>
      ) : (
        <FlatList<FeedItem>
          ref={flatListRef}
          data={feedData}
          keyExtractor={keyExtractor}
          renderItem={renderFeedItem}
          contentContainerStyle={styles.list}
          onScroll={handleListScroll}
          scrollEventThrottle={16}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={onRefresh}
              tintColor="#FF2D55"
              colors={['#FF2D55']}
            />
          }
          removeClippedSubviews
          initialNumToRender={12}
          maxToRenderPerBatch={12}
          windowSize={5}
          onScrollToIndexFailed={(info) => {
            setTimeout(() => {
              flatListRef.current?.scrollToIndex({ index: info.index, animated: true, viewPosition: 0.4 });
            }, 500);
          }}
        />
      )}

      {/* ── LOCATION MODAL ── */}
      <LocationModal
        visible={locationModalVisible}
        onClose={() => setLocationModalVisible(false)}
        onConfirm={(coords, label) => { void handleLocationConfirm(coords, label); }}
        onUseCurrentLocation={() => { void clearLocationOverride(); }}
        isOverride={location.isOverride}
      />
    </View>
  );
};

// ─── Styles ──────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  container: { flex: 1 },

  mapContainer: { position: 'relative' },
  locationBtn: { position: 'absolute', top: spacing.sm, left: spacing.md, paddingHorizontal: spacing.md, paddingVertical: spacing.sm, borderRadius: borderRadius.full },
  locationBtnText: { fontSize: 15, fontWeight: '600' },

  circleOverlayContainer: { ...StyleSheet.absoluteFillObject, alignItems: 'center', justifyContent: 'center' },
  circleOverlay: { borderWidth: 2 },
  circleRadiusLabel: { marginTop: 6, fontSize: 14, fontWeight: '700', letterSpacing: 0.3, textShadowColor: 'rgba(255,255,255,0.8)', textShadowOffset: { width: 0, height: 0 }, textShadowRadius: 3 },

  dragHandle: { height: HANDLE_HEIGHT, alignItems: 'center', justifyContent: 'center', borderBottomWidth: 1 },
  dragPill: { width: 40, height: 4, borderRadius: 2 },

  // Radius — single line, 3 chips only, no flexWrap
  radiusContainer: { borderBottomWidth: 1, paddingVertical: spacing.sm, paddingHorizontal: spacing.md },
  radiusRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  radiusLabel: { fontSize: 15, fontWeight: '600', marginRight: spacing.xs },
  radiusChip: { paddingHorizontal: 14, paddingVertical: 6, borderRadius: borderRadius.full, borderWidth: 1.5 },
  radiusChipText: { fontSize: 15, fontWeight: '600' },

  listLoadingContainer: { flex: 1, paddingTop: spacing.md },
  list: { padding: spacing.md, paddingTop: spacing.sm, paddingBottom: spacing.xl * 2 },

  // Section headers
  sectionHeader: { flexDirection: 'row', alignItems: 'center', paddingVertical: spacing.md, paddingHorizontal: 0, marginBottom: spacing.sm, gap: spacing.sm },
  sectionHeaderText: { fontSize: 22, fontWeight: '800', flex: 1, letterSpacing: 0.3 },
  sectionBadge: { minWidth: 22, height: 22, borderRadius: 11, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 6 },
  sectionBadgeText: { color: '#fff', fontSize: 13, fontWeight: '700' },
  createPostBtn: { backgroundColor: '#FF2D55', borderRadius: borderRadius.full, paddingHorizontal: 16, paddingVertical: 8 },
  createPostBtnText: { color: '#FFFFFF', fontSize: 16, fontWeight: '700' },

  sectionEmpty: { paddingVertical: spacing.md, paddingHorizontal: spacing.sm, marginBottom: spacing.sm, borderRadius: borderRadius.md, alignItems: 'center' },
  sectionEmptyText: { fontSize: 15, fontStyle: 'italic' },

  sectionDivider: { height: 1, marginVertical: spacing.sm },
  userDot: { width: 10, height: 10, borderRadius: 5, backgroundColor: '#FF2D55', opacity: 0.7 },
  currentUserDot: { width: 16, height: 16, borderRadius: 8, backgroundColor: '#FF2D55', borderWidth: 2, borderColor: '#000000' },

  // Post card — red left accent border
  postCard: { flexDirection: 'row', borderRadius: borderRadius.lg, marginBottom: spacing.sm, overflow: 'hidden' },
  postCardInner: { flex: 1, padding: spacing.md },

  cardHeader: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, marginBottom: spacing.sm },
  avatarSmall: { width: 40, height: 40, borderRadius: 20, borderWidth: 1 },
  avatarPlaceholder: { width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center' },
  avatarEmoji: { fontSize: 20 },
  headerInfo: { flex: 1 },
  posterName: { fontSize: 17, fontWeight: '700' },
  dateRange: { fontSize: 16, fontWeight: '600', marginTop: 1 },
  dogThumbSmall: { width: 44, height: 44, borderRadius: borderRadius.sm, borderWidth: 1 },
  dogThumbPlaceholder: { width: 44, height: 44, borderRadius: borderRadius.sm, alignItems: 'center', justifyContent: 'center' },
  dogThumbEmoji: { fontSize: 22 },
  dogThumbLead: { width: 48, height: 48, borderRadius: 24, borderWidth: 1.5 },
  dogThumbLeadPlaceholder: { width: 48, height: 48, borderRadius: 24, alignItems: 'center', justifyContent: 'center' },
  dogLine: { fontSize: 16, fontWeight: '600', marginBottom: spacing.xs },
  compInline: { fontSize: 15, fontWeight: '600', marginBottom: spacing.xs },
  offAppInline: { fontSize: 13, marginBottom: spacing.xs },
  carePreview: { fontSize: 15, lineHeight: 18, marginBottom: spacing.xs },
  interestBadge: { backgroundColor: RED, borderRadius: borderRadius.full, paddingHorizontal: spacing.sm, paddingVertical: 4, alignSelf: 'flex-start', marginBottom: spacing.xs, shadowColor: RED, shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.30, shadowRadius: 4, elevation: 2 },
  interestBadgeText: { color: '#fff', fontSize: 14, fontWeight: '700' },
  respondedBadge: { backgroundColor: '#0984E320', paddingHorizontal: 10, paddingVertical: 4, borderRadius: 6, alignSelf: 'flex-start', marginTop: 6 },
  respondedBadgeText: { color: '#0984E3', fontSize: 13, fontWeight: '700' },
  takenBadge: { backgroundColor: '#4CAF5025', borderRadius: 99, paddingHorizontal: 10, paddingVertical: 3, alignSelf: 'flex-start' as const, marginBottom: 6 },
  takenBadgeText: { color: '#2E7D32', fontSize: 14, fontWeight: '600' },
  detailsBtn: { marginTop: spacing.sm, borderWidth: 1.5, borderColor: '#FF2D55', borderRadius: 8, paddingVertical: 8, paddingHorizontal: 16, alignSelf: 'flex-start' },
  detailsBtnText: { fontSize: 15, fontWeight: '700', color: '#FF2D55' },

  // User row
  userRow: { flexDirection: 'row', alignItems: 'center', padding: spacing.md, borderRadius: borderRadius.md, marginBottom: spacing.sm },
  avatar: { width: 52, height: 52, borderRadius: 26, marginRight: spacing.md },
  userInfo: { flex: 1 },
  userName: { fontSize: 18, fontWeight: '700', marginBottom: 2 },
  userDistance: { fontSize: 15, fontWeight: '500', marginBottom: 2 },
  userDogs: { fontSize: 14 },
  chevron: { fontSize: 24, fontWeight: '300', marginLeft: spacing.xs },

  // Modal
  modalOverlay: { flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(0,0,0,0.45)' },
  modalSheet: { flex: 1, paddingHorizontal: spacing.lg, paddingBottom: spacing.xl },
  modalHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: spacing.sm },
  modalTitle: { ...typography.h3 },
  modalSubtitle: { ...typography.bodySmall, marginBottom: spacing.md },
  autocompleteWrapper: { marginBottom: spacing.md, zIndex: 10 },
  searchInput: { borderWidth: 1.5, borderRadius: borderRadius.md, paddingHorizontal: spacing.md, height: 48, fontSize: 18, marginBottom: 4 },
  dropdown: { borderWidth: 1, borderRadius: borderRadius.md, overflow: 'hidden', maxHeight: 220, marginTop: 2 },
  dropdownItem: { paddingHorizontal: spacing.md, paddingVertical: spacing.sm, borderBottomWidth: StyleSheet.hairlineWidth },
  dropdownItemText: { fontSize: 16, lineHeight: 19 },
  resolvingRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, marginBottom: spacing.md },
  resolvingText: { fontSize: 16 },
  modalBtnOutline: { padding: spacing.md, borderRadius: borderRadius.md, alignItems: 'center', borderWidth: 1.5, marginBottom: spacing.sm },
  modalBtnOutlineText: { fontSize: 17, fontWeight: '600' },
  modalCancelText: { fontSize: 18, fontWeight: '600' } });

export default DiscoverScreen;
