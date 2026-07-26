import React, { useState, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  TouchableOpacity,
  Image,
  Alert,
  ActivityIndicator,
  RefreshControl,
  ScrollView,
} from 'react-native';
import {
  collection,
  query,
  where,
  getDocs,
  getDoc,
  doc,
  updateDoc,
  collectionGroup,
  Timestamp,
} from 'firebase/firestore';
import { db } from '../../config/firebase';
import { useTheme } from '../../contexts/ThemeContext';
import { spacing, borderRadius, typography, shadow } from '../../config/theme';

interface DogInfo {
  id: string;
  name: string;
  breed: string;
  photoURLs: string[];
}

interface PendingUser {
  id: string;
  displayName: string;
  email: string;
  phoneNumber?: string;
  referralCount: number;
  bio?: string;
  photoURL?: string;
  createdAt?: Date;
  dogs: DogInfo[];
}

const APPROVE_COLOR = '#34C759';
const REJECT_COLOR = '#FF3B30';

const AdminPanelScreen: React.FC = () => {
  const { colors } = useTheme();
  const [users, setUsers] = useState<PendingUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const fetchPendingUsers = useCallback(async () => {
    try {
      const q = query(
        collection(db, 'users'),
        where('accountStatus', '==', 'pending_approval'),
      );
      const snap = await getDocs(q);

      const pendingUsers: PendingUser[] = await Promise.all(
        snap.docs.map(async (userDoc) => {
          const data = userDoc.data();
          let phoneNumber: string | undefined;
          try {
            const privateSnap = await getDoc(doc(db, 'privateUsers', userDoc.id));
            const privateData = privateSnap.data();
            phoneNumber = typeof privateData?.phoneNumber === 'string'
              ? privateData.phoneNumber
              : undefined;
          } catch {
            phoneNumber = undefined;
          }

          // Fetch dogs from top-level dogs collection filtered by ownerId
          let dogs: DogInfo[] = [];
          try {
            const dogsQ = query(
              collection(db, 'dogs'),
              where('ownerId', '==', userDoc.id),
            );
            const dogsSnap = await getDocs(dogsQ);
            dogs = dogsSnap.docs.map((d) => ({
              id: d.id,
              name: d.data().name ?? '',
              breed: d.data().breed ?? '',
              photoURLs: d.data().photoURLs ?? [],
            }));
          } catch {
            // non-fatal
          }

          const rawCreatedAt = data.createdAt;
          let createdAt: Date | undefined;
          if (rawCreatedAt instanceof Timestamp) {
            createdAt = rawCreatedAt.toDate();
          } else if (rawCreatedAt instanceof Date) {
            createdAt = rawCreatedAt;
          }

          return {
            id: userDoc.id,
            displayName: data.displayName ?? 'Unnamed User',
            email: data.email ?? '',
            phoneNumber,
            referralCount: 0,
            bio: data.bio ?? undefined,
            photoURL: data.photoURL ?? undefined,
            createdAt,
            dogs,
          };
        }),
      );

      setUsers(pendingUsers);
    } catch (e) {
      Alert.alert('Error', 'Failed to load pending accounts. Please try again.');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  // Initial load
  React.useEffect(() => {
    void fetchPendingUsers();
  }, [fetchPendingUsers]);

  const handleRefresh = useCallback(() => {
    setRefreshing(true);
    void fetchPendingUsers();
  }, [fetchPendingUsers]);

  const handleApprove = (userId: string, displayName: string) => {
    Alert.alert(
      'Approve Account',
      `Approve ${displayName || 'this user'}'s account? They will gain full access to WatchDog.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: '✅ Approve',
          onPress: async () => {
            try {
              await updateDoc(doc(db, 'users', userId), {
                accountStatus: 'active',
              });
              setUsers((prev) => prev.filter((u) => u.id !== userId));
            } catch {
              Alert.alert('Error', 'Failed to approve account. Please try again.');
            }
          },
        },
      ],
    );
  };

  const handleReject = (userId: string, displayName: string) => {
    Alert.alert(
      'Reject Account',
      `Reject ${displayName || 'this user'}'s account? This action cannot be undone.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: '❌ Reject',
          style: 'destructive',
          onPress: async () => {
            try {
              await updateDoc(doc(db, 'users', userId), {
                accountStatus: 'rejected',
              });
              setUsers((prev) => prev.filter((u) => u.id !== userId));
            } catch {
              Alert.alert('Error', 'Failed to reject account. Please try again.');
            }
          },
        },
      ],
    );
  };

  const formatJoinDate = (date?: Date): string => {
    if (!date) return 'Unknown';
    return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  };

  const renderDogs = (dogs: DogInfo[]) => {
    if (dogs.length === 0) return null;
    return (
      <View style={styles.dogsSection}>
        <Text style={[styles.dogsSectionTitle, { color: colors.textSecondary }]}>
          🐾 {dogs.length === 1 ? '1 Dog' : `${dogs.length} Dogs`}
        </Text>
        {dogs.map((dog) => (
          <View key={dog.id} style={[styles.dogRow, { borderColor: colors.border }]}>
            {dog.photoURLs.length > 0 && (
              <Image
                source={{ uri: dog.photoURLs[0] }}
                style={styles.dogPhoto}
                accessibilityLabel={`${dog.name} photo`}
              />
            )}
            <View style={styles.dogInfo}>
              <Text style={[styles.dogName, { color: colors.text }]}>{dog.name}</Text>
              {dog.breed ? (
                <Text style={[styles.dogBreed, { color: colors.textSecondary }]}>{dog.breed}</Text>
              ) : null}
            </View>
          </View>
        ))}
      </View>
    );
  };

  const renderItem = ({ item }: { item: PendingUser }) => (
    <View style={[styles.card, { backgroundColor: colors.surface, ...shadow.sm }]}>
      {/* Header: avatar + name + contact */}
      <View style={styles.cardHeader}>
        <Image
          source={
            item.photoURL
              ? { uri: item.photoURL }
              : require('../../../assets/icon.png')
          }
          style={styles.avatar}
          accessibilityLabel={`${item.displayName} profile photo`}
        />
        <View style={styles.cardHeaderText}>
          <Text style={[styles.userName, { color: colors.text }]}>{item.displayName}</Text>
          <Text style={[styles.userEmail, { color: colors.textSecondary }]}>{item.phoneNumber || item.email}</Text>
            <Text style={[styles.userEmail, { color: colors.primary }]}>{item.referralCount} referral{item.referralCount !== 1 ? 's' : ''}</Text>
          <Text style={[styles.joinDate, { color: colors.textSecondary }]}>
            Joined {formatJoinDate(item.createdAt)}
          </Text>
        </View>
      </View>

      {/* Bio */}
      {item.bio ? (
        <Text style={[styles.bio, { color: colors.textSecondary }]}>{item.bio}</Text>
      ) : null}

      {/* Dogs */}
      {renderDogs(item.dogs)}

      {/* Action buttons */}
      <View style={styles.actions}>
        <TouchableOpacity
          style={[styles.approveBtn, { backgroundColor: APPROVE_COLOR }]}
          onPress={() => handleApprove(item.id, item.displayName)}
          accessibilityLabel={`Approve ${item.displayName}`}
          accessibilityRole="button"
        >
          <Text style={styles.approveBtnText}>✅ Approve</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.rejectBtn, { borderColor: REJECT_COLOR }]}
          onPress={() => handleReject(item.id, item.displayName)}
          accessibilityLabel={`Reject ${item.displayName}`}
          accessibilityRole="button"
        >
          <Text style={[styles.rejectBtnText, { color: REJECT_COLOR }]}>❌ Reject</Text>
        </TouchableOpacity>
      </View>
    </View>
  );

  const renderEmpty = () => (
    <View style={styles.emptyState}>
      <Text style={styles.emptyEmoji}>🎉</Text>
      <Text style={[styles.emptyTitle, { color: colors.text }]}>No pending accounts</Text>
      <Text style={[styles.emptySub, { color: colors.textSecondary }]}>All caught up!</Text>
    </View>
  );

  if (loading) {
    return (
      <View style={[styles.loadingContainer, { backgroundColor: colors.background }]}>
        <ActivityIndicator size="large" color={colors.primary} />
        <Text style={[styles.loadingText, { color: colors.textSecondary }]}>
          Loading pending accounts…
        </Text>
      </View>
    );
  }

  return (
    <FlatList
      style={{ backgroundColor: colors.background }}
      contentContainerStyle={[
        styles.listContent,
        users.length === 0 && styles.listContentEmpty,
      ]}
      data={users}
      keyExtractor={(item) => item.id}
      renderItem={renderItem}
      ListEmptyComponent={renderEmpty}
      refreshControl={
        <RefreshControl
          refreshing={refreshing}
          onRefresh={handleRefresh}
          tintColor={colors.primary}
        />
      }
      ListHeaderComponent={
        users.length > 0 ? (
          <Text style={[styles.listHeader, { color: colors.textSecondary }]}>
            {users.length} pending {users.length === 1 ? 'account' : 'accounts'}
          </Text>
        ) : null
      }
    />
  );
};

const styles = StyleSheet.create({
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    gap: spacing.md,
  },
  loadingText: { fontSize: 17 },
  listContent: { padding: spacing.md, gap: spacing.md },
  listContentEmpty: { flexGrow: 1 },
  listHeader: {
    fontSize: 15,
    fontWeight: '600',
    marginBottom: spacing.sm,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  card: {
    borderRadius: borderRadius.lg,
    padding: spacing.md,
    gap: spacing.sm,
  },
  cardHeader: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.md,
  },
  avatar: {
    width: 60,
    height: 60,
    borderRadius: 30,
  },
  cardHeaderText: { flex: 1, gap: 2 },
  userName: { fontSize: 19, fontWeight: '700' },
  userEmail: { fontSize: 15 },
  joinDate: { fontSize: 14 },
  bio: { fontSize: 16, lineHeight: 20 },
  dogsSection: { gap: spacing.xs },
  dogsSectionTitle: { fontSize: 15, fontWeight: '600' },
  dogRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    borderWidth: 1,
    borderRadius: borderRadius.md,
    padding: spacing.sm,
  },
  dogPhoto: { width: 44, height: 44, borderRadius: 8 },
  dogInfo: { flex: 1 },
  dogName: { fontSize: 17, fontWeight: '600' },
  dogBreed: { fontSize: 15 },
  actions: {
    flexDirection: 'row',
    gap: spacing.sm,
    marginTop: spacing.xs,
  },
  approveBtn: {
    flex: 1,
    padding: spacing.sm,
    borderRadius: borderRadius.md,
    alignItems: 'center',
  },
  approveBtnText: { color: '#fff', fontWeight: '700', fontSize: 17 },
  rejectBtn: {
    flex: 1,
    padding: spacing.sm,
    borderRadius: borderRadius.md,
    alignItems: 'center',
    borderWidth: 2,
  },
  rejectBtnText: { fontWeight: '700', fontSize: 17 },
  emptyState: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    gap: spacing.sm,
    paddingVertical: 80,
  },
  emptyEmoji: { fontSize: 58 },
  emptyTitle: { ...typography.h2, textAlign: 'center' },
  emptySub: { fontSize: 18, textAlign: 'center' },
});

export default AdminPanelScreen;
