import React, { useEffect, useState, useCallback } from 'react';
import {
  View,
  Text,
  FlatList,
  StyleSheet,
  ActivityIndicator,
  RefreshControl,
  TouchableOpacity,
  ListRenderItemInfo,
} from 'react-native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { ProfileStackParamList } from '../../navigation/types';
import { useAuthContext } from '../../contexts/AuthContext';
import { useTheme } from '../../contexts/ThemeContext';
import { usePointsHistory, PointsHistoryEntry, pointsEventIcon } from '../../hooks/usePointsHistory';
import { spacing, borderRadius, typography, shadow } from '../../config/theme';

type Props = {
  navigation: NativeStackNavigationProp<ProfileStackParamList, 'PointsHistory'>;
};

const formatDate = (date: Date): string => {
  return date.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
};

const PointsHistoryScreen: React.FC<Props> = ({ navigation }) => {
  const { colors } = useTheme();
  const { userProfile, user } = useAuthContext();
  const { getHistory } = usePointsHistory();

  const [entries, setEntries] = useState<PointsHistoryEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const loadHistory = useCallback(async () => {
    if (!user) return;
    try {
      const data = await getHistory(user.uid);
      setEntries(data);
    } catch {
      // Silently fail — empty state shown below
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [user]);

  useEffect(() => {
    void loadHistory();
  }, [loadHistory]);

  const onRefresh = () => {
    setRefreshing(true);
    void loadHistory();
  };

  const renderItem = ({ item }: ListRenderItemInfo<PointsHistoryEntry>) => {
    const isPositive = item.points >= 0;
    const pointsColor = isPositive ? colors.success : colors.error;
    const pointsLabel = isPositive ? `+${item.points.toFixed(1)}` : item.points.toFixed(1);

    return (
      <View style={[styles.row, { backgroundColor: colors.surface, ...shadow.sm }]}>
        {/* Left: emoji icon */}
        <View style={[styles.iconWrap, { backgroundColor: colors.primary + '18' }]}>
          <Text style={styles.iconText}>{pointsEventIcon[item.type]}</Text>
        </View>

        {/* Middle: description + date */}
        <View style={styles.rowMiddle}>
          <Text style={[styles.rowDescription, { color: colors.text }]} numberOfLines={2}>
            {item.description}
          </Text>
          <Text style={[styles.rowDate, { color: colors.textSecondary }]}>
            {formatDate(item.createdAt)}
          </Text>
        </View>

        {/* Right: points badge */}
        <Text style={[styles.rowPoints, { color: pointsColor }]}>{pointsLabel} pts</Text>
      </View>
    );
  };

  const ListHeader = () => (
    <View style={[styles.totalCard, { backgroundColor: colors.surface, ...shadow.sm }]}>
      <Text style={[styles.totalLabel, { color: colors.textSecondary }]}>Total Points</Text>
      <Text style={[styles.totalPoints, { color: '#FFFFFF' }]}>
        {(userProfile?.points ?? 0).toFixed(1)}
      </Text>
      <Text style={[styles.totalSub, { color: colors.textSecondary }]}>
        {entries.length > 0
          ? `${entries.length} transaction${entries.length !== 1 ? 's' : ''}`
          : 'No transactions yet'}
      </Text>
      <TouchableOpacity
        style={{ backgroundColor: '#FF2D55', borderRadius: 10, paddingVertical: 12, paddingHorizontal: 24, marginTop: 16 }}
        onPress={() => navigation.getParent()?.navigate('DiscoverTab')}
      >
        <Text style={{ color: '#FFFFFF', fontSize: 17, fontWeight: '600' }}>Earn More</Text>
      </TouchableOpacity>
    </View>
  );

  const ListEmpty = () => (
    <View style={styles.emptyWrap}>
      
      <Text style={[styles.emptyTitle, { color: colors.text }]}>No points history yet</Text>
      <Text style={[styles.emptySub, { color: colors.textSecondary }]}>
        Earn points by watching dogs for your neighbours!
      </Text>
    </View>
  );

  if (loading) {
    return (
      <View style={[styles.centeredFill, { backgroundColor: colors.background }]}>
        <ActivityIndicator color={colors.primary} size="large" />
      </View>
    );
  }

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <FlatList
        data={entries}
        keyExtractor={(item) => item.id}
        renderItem={renderItem}
        ListHeaderComponent={ListHeader}
        ListEmptyComponent={ListEmpty}
        contentContainerStyle={styles.listContent}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={onRefresh}
            tintColor={colors.primary}
          />
        }
        showsVerticalScrollIndicator={false}
      />
    </View>
  );
};

const styles = StyleSheet.create({
  container: { flex: 1 },
  centeredFill: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  listContent: { padding: spacing.lg, paddingBottom: spacing.xl * 2 },

  // Total card
  totalCard: {
    borderRadius: borderRadius.lg,
    padding: spacing.xl,
    alignItems: 'center',
    marginBottom: spacing.lg,
  },
  totalLabel: { fontSize: 16, fontWeight: '500', marginBottom: spacing.xs, textTransform: 'uppercase', letterSpacing: 1 },
  totalPoints: { fontSize: 50, fontWeight: '400', lineHeight: 56, marginBottom: spacing.xs, color: '#FFFFFF' },
  totalSub: { fontSize: 15 },

  // Row
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: borderRadius.md,
    padding: spacing.md,
    marginBottom: spacing.sm,
    gap: spacing.sm,
  },
  iconWrap: {
    width: 42,
    height: 42,
    borderRadius: 21,
    alignItems: 'center',
    justifyContent: 'center',
  },
  iconText: { fontSize: 22 },
  rowMiddle: { flex: 1 },
  rowDescription: { fontSize: 16, fontWeight: '600', lineHeight: 18 },
  rowDate: { fontSize: 14, marginTop: 2 },
  rowPoints: { fontSize: 17, fontWeight: '700', minWidth: 64, textAlign: 'right' },

  // Empty
  emptyWrap: { alignItems: 'center', paddingTop: spacing.xl * 2 },
  emptyIcon: { fontSize: 50, marginBottom: spacing.md },
  emptyTitle: { ...typography.h3, marginBottom: spacing.sm },
  emptySub: { fontSize: 16, textAlign: 'center', paddingHorizontal: spacing.xl },
});

export default PointsHistoryScreen;
