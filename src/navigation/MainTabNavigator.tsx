import React, { useEffect, useState, useCallback, useRef } from 'react';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { Text, View, Modal } from 'react-native';
import {
  MainTabParamList,
  DiscoverStackParamList,
  RequestsStackParamList,
  MessagesStackParamList,
  ProfileStackParamList,
} from './types';
import { useTheme } from '../contexts/ThemeContext';
import { useAuthContext } from '../contexts/AuthContext';
import { useMessaging } from '../hooks/useMessaging';
import { collection, query, where, onSnapshot, doc, getDoc, getDocs } from 'firebase/firestore';
import { db } from '../config/firebase';
import { shareReferral } from '../utils/shareReferral';
import { ensureReferralCode } from '../hooks/useReferrals';
import { clearPendingReferralRewardSecure } from '../services/secureOperations';
import InsufficientPointsModal from '../components/common/InsufficientPointsModal';
import ConfettiCelebration, { CelebrationItem } from '../components/common/ConfettiCelebration';
import MandatoryReviewGate from '../components/common/MandatoryReviewGate';
import { ReviewFlowParams } from '../hooks/useReviewFlow';
import { useLiveReviewTrigger } from '../hooks/useLiveReviewTrigger';
import AppHeader from '../components/common/AppHeader';

// Discover stack
import DiscoverScreen from '../screens/discover/DiscoverScreen';
import UserDetailScreen from '../screens/discover/UserDetailScreen';
import DogDetailScreen from '../screens/discover/DogDetailScreen';
import CreateSwapScreen from '../screens/booking/CreateSwapScreen';

// Requests stack
import RequestsScreen from '../screens/requests/RequestsScreen';
import PostDetailScreen from '../screens/requests/PostDetailScreen';
import CreatePostScreen from '../screens/booking/CreatePostScreen';
import WriteReviewScreen from '../screens/booking/WriteReviewScreen';

// Messages stack
import ConversationsListScreen from '../screens/messages/ConversationsListScreen';
import ChatScreen from '../screens/messages/ChatScreen';

// Profile stack
import ProfileScreen from '../screens/profile/ProfileScreen';
import EditProfileScreen from '../screens/profile/EditProfileScreen';
import EditDogScreen from '../screens/profile/EditDogScreen';
import PointsHistoryScreen from '../screens/profile/PointsHistoryScreen';
import ConductStandardsScreen from '../screens/onboarding/ConductStandardsScreen';
import MyAgreementScreen from '../screens/profile/MyAgreementScreen';
import ReferralScreen from '../screens/profile/ReferralScreen';
import ReviewScreen from '../screens/reviews/ReviewScreen';
import ReviewsListScreen from '../screens/reviews/ReviewsListScreen';

const Tab = createBottomTabNavigator<MainTabParamList>();
const DiscoverStack = createNativeStackNavigator<DiscoverStackParamList>();
const RequestsStack = createNativeStackNavigator<RequestsStackParamList>();
const MessagesStack = createNativeStackNavigator<MessagesStackParamList>();
const ProfileStack = createNativeStackNavigator<ProfileStackParamList>();

const sharedHeaderOptions = {
  header: (props: Parameters<typeof AppHeader>[0]) => <AppHeader {...props} />,
};

const DiscoverNavigator: React.FC = () => {
  const { colors } = useTheme();
  return (
    <DiscoverStack.Navigator
      screenOptions={{
        animation: 'slide_from_right',
        headerStyle: { backgroundColor: colors.surface },
        headerTintColor: colors.primary,
        headerShadowVisible: false,
        ...sharedHeaderOptions,
      }}
    >
      <DiscoverStack.Screen
        name="Discover"
        component={DiscoverScreen}
        options={{ title: 'Discover', headerShown: true }}
      />
      <DiscoverStack.Screen name="UserDetail" component={UserDetailScreen} options={{ title: 'Profile' }} />
      <DiscoverStack.Screen name="DogDetail" component={DogDetailScreen} options={{ title: 'Dog Profile' }} />
      <DiscoverStack.Screen name="CreateSwap" component={CreateSwapScreen} options={{ title: 'Request Swap', presentation: 'modal' }} />
      <DiscoverStack.Screen name="PostDetail" component={PostDetailScreen} options={{ title: 'Post Details' }} />
      <DiscoverStack.Screen name="CreatePost" component={CreatePostScreen} options={{ title: 'Create Post', presentation: 'modal' }} />
      <DiscoverStack.Screen name="Chat" component={ChatScreen} options={{ title: 'Chat', headerShown: false }} />
      <DiscoverStack.Screen
        name="ReviewsList"
        component={ReviewsListScreen}
        options={({ route }) => ({
          title: route.params?.dogName ? `${route.params.dogName} Reviews` : 'Reviews',
          presentation: 'modal',
        })}
      />
    </DiscoverStack.Navigator>
  );
};

const RequestsNavigator: React.FC = () => {
  const { colors } = useTheme();
  return (
    <RequestsStack.Navigator
      screenOptions={{
        animation: 'slide_from_right',
        headerStyle: { backgroundColor: colors.surface },
        headerTintColor: colors.primary,
        headerShadowVisible: false,
        ...sharedHeaderOptions,
      }}
    >
      <RequestsStack.Screen name="Requests" component={RequestsScreen} options={{ title: 'My Schedule' }} />
      <RequestsStack.Screen name="WriteReview" component={WriteReviewScreen} options={{ title: 'Write Review', presentation: 'modal' }} />
      {/* Voluntary review — opens within Requests stack so goBack() returns to Schedule */}
      <RequestsStack.Screen name="Review" component={ReviewScreen} options={{ title: 'Leave a Review', presentation: 'modal' }} />
      <RequestsStack.Screen name="PostDetail" component={PostDetailScreen} options={{ title: 'Post Details' }} />
      <RequestsStack.Screen name="UserDetail" component={UserDetailScreen} options={{ title: 'Profile' }} />
      <RequestsStack.Screen name="DogDetail" component={DogDetailScreen} options={{ title: 'Dog Profile' }} />
      <RequestsStack.Screen name="CreatePost" component={CreatePostScreen} options={{ title: 'Create Post', presentation: 'modal' }} />
      <RequestsStack.Screen name="Chat" component={ChatScreen} options={{ title: 'Chat', headerShown: false }} />
      <RequestsStack.Screen
        name="ReviewsList"
        component={ReviewsListScreen}
        options={({ route }) => ({
          title: route.params?.dogName ? `${route.params.dogName} Reviews` : 'Reviews',
          presentation: 'modal',
        })}
      />
    </RequestsStack.Navigator>
  );
};

const MessagesNavigator: React.FC = () => {
  const { colors } = useTheme();
  return (
    <MessagesStack.Navigator
      screenOptions={{
        animation: 'slide_from_right',
        headerStyle: { backgroundColor: colors.surface },
        headerTintColor: colors.primary,
        headerShadowVisible: false,
        ...sharedHeaderOptions,
      }}
    >
      <MessagesStack.Screen name="ConversationsList" component={ConversationsListScreen} options={{ title: 'Messages' }} />
      <MessagesStack.Screen name="Chat" component={ChatScreen} options={{ title: 'Chat' }} />
      <MessagesStack.Screen name="UserDetail" component={UserDetailScreen} options={{ title: 'Profile' }} />
      <MessagesStack.Screen name="DogDetail" component={DogDetailScreen} options={{ title: 'Dog Profile' }} />
      <MessagesStack.Screen
        name="ReviewsList"
        component={ReviewsListScreen}
        options={({ route }) => ({
          title: route.params?.dogName ? `${route.params.dogName} Reviews` : 'Reviews',
          presentation: 'modal',
        })}
      />
    </MessagesStack.Navigator>
  );
};

const ProfileNavigator: React.FC = () => {
  const { colors } = useTheme();
  return (
    <ProfileStack.Navigator
      screenOptions={{
        animation: 'slide_from_right',
        headerStyle: { backgroundColor: colors.surface },
        headerTintColor: colors.primary,
        headerShadowVisible: false,
        ...sharedHeaderOptions,
      }}
    >
      <ProfileStack.Screen name="Profile" component={ProfileScreen} options={{ title: 'Profile', headerShown: true }} />
      <ProfileStack.Screen name="UserDetail" component={UserDetailScreen} options={{ title: 'My Public Profile', headerBackTitle: 'Back' }} />
      <ProfileStack.Screen name="DogDetail" component={DogDetailScreen} options={{ title: 'Dog Profile' }} />
      <ProfileStack.Screen name="Review" component={ReviewScreen} options={{ title: 'Leave a Review', presentation: 'modal' }} />
      <ProfileStack.Screen name="EditProfile" component={EditProfileScreen} options={{ title: 'Edit Profile' }} />
      <ProfileStack.Screen
        name="EditDog"
        component={EditDogScreen}
        options={({ route }) => ({
          title: route.params?.dogId ? 'Edit Dog' : 'Add Dog',
        })}
      />
      <ProfileStack.Screen
        name="PointsHistory"
        component={PointsHistoryScreen}
        options={{ title: 'Points History', headerBackTitle: 'Back' }}
      />
      <ProfileStack.Screen
        name="CommunityStandards"
        options={{ title: 'Community Standards', headerBackTitle: 'Back' }}
      >
        {() => <ConductStandardsScreen readOnly />}
      </ProfileStack.Screen>
      <ProfileStack.Screen
        name="MyAgreement"
        component={MyAgreementScreen}
        options={{ title: 'My Agreement', headerBackTitle: 'Back' }}
      />
      <ProfileStack.Screen
        name="Referral"
        component={ReferralScreen}
        options={{ title: 'Invite a Friend', headerBackTitle: 'Back' }}
      />
      <ProfileStack.Screen
        name="ReviewsList"
        component={ReviewsListScreen}
        options={({ route }) => ({
          title: route.params?.dogName ? `${route.params.dogName} Reviews` : 'Reviews',
          presentation: 'modal',
        })}
      />
    </ProfileStack.Navigator>
  );
};

const MainTabNavigator: React.FC = () => {
  const { colors } = useTheme();
  const { user } = useAuthContext();
  const { subscribeToConversations } = useMessaging();
  const [unreadCount, setUnreadCount] = useState(0);

  useEffect(() => {
    if (!user) return;
    const unsub = subscribeToConversations(user.uid, (convs) => {
      const total = convs.reduce((sum, c) => sum + (c.unreadCounts[user.uid] ?? 0), 0);
      setUnreadCount(total);
    });
    return unsub;
  }, [user, subscribeToConversations]);

  const MessagesIcon = useCallback(
    ({ color }: { color: string }) => (
      <View style={{ position: 'relative' }}>
        <Text style={{ fontSize: 22, color }}>💬</Text>
        {unreadCount > 0 && (
          <View
            style={{
              position: 'absolute',
              top: -4,
              right: -6,
              minWidth: 18,
              height: 18,
              borderRadius: 9,
              backgroundColor: '#FF2D55',
              borderWidth: 1.5,
              borderColor: colors.surface,
              justifyContent: 'center',
              alignItems: 'center',
              paddingHorizontal: 3,
            }}
          >
            <Text style={{ color: '#fff', fontSize: 12, fontWeight: '700', lineHeight: 13 }}>
              {unreadCount > 99 ? '99+' : String(unreadCount)}
            </Text>
          </View>
        )}
      </View>
    ),
    [unreadCount, colors.surface],
  );


  const [celebrationQueue, setCelebrationQueue] = useState<CelebrationItem[]>([]);
  const checkedReferralReward = useRef(false);
  const checkedPendingReview = useRef(false);

  // Drives the inescapable review gate. Sourced from the on-open getDoc below;
  // nulled only after a successful submit clears pendingReview.
  const [mandatoryReviewData, setMandatoryReviewData] = useState<ReviewFlowParams | null>(null);

  // ── Check for pending referral reward on app open ──────────────────────────
  useEffect(() => {
    if (!user || checkedReferralReward.current) return;
    checkedReferralReward.current = true;

    (async () => {
      try {
        const userDocSnap = await getDoc(doc(db, 'users', user.uid));
        if (!userDocSnap.exists()) return;
        const data = userDocSnap.data();
        const reward = data?.pendingReferralReward;
        if (!reward) return;

        const fromName = (reward.fromUserName as string) || 'Someone';
        const pts = (reward.points as number) || 3;

        // Show confetti celebration with "Invite more?" button
        setCelebrationQueue((prev) => [
          ...prev,
          {
            title: 'You earned ' + pts + ' points! 🎉',
            subtitle: fromName + ' joined WatchDog using your referral code!',
            emoji: '🐾',
            actionLabel: 'Invite more friends?',
            onAction: async () => {
              try {
                const existing = typeof data?.referralCode === 'string' ? data.referralCode : '';
                const code = existing || (user ? await ensureReferralCode(user.uid) : '');
                if (!code) return;
                await shareReferral(code);
              } catch (err) {
                console.error('[ReferralReward] Invite share failed:', err);
              }
            },
          },
        ]);

        // Clear the pending reward flag so it doesn't show again
        await clearPendingReferralRewardSecure();
      } catch (err) {
        console.error('[ReferralReward] Check failed:', err);
      }
    })();
  }, [user]);

  // ── Check for pending review on app open ─────────────────────────────────
  useEffect(() => {
    if (!user || checkedPendingReview.current) return;
    checkedPendingReview.current = true;

    (async () => {
      try {
        const userDocSnap = await getDoc(doc(db, 'users', user.uid));
        if (!userDocSnap.exists()) return;
        const data = userDocSnap.data();
        const pending = data?.pendingReview;
        if (!pending) return;

        // Best-effort photo fetches for the gate steps. The pendingReview doc
        // carries no photos, so we fetch them here in parallel. Failures are
        // non-fatal: the gate opens with no avatar rather than crashing.
        const pendingDogIds = (pending.dogIds as string[]) ?? [];
        const pendingOtherUserId = pending.otherUserId as string;

        const [dogPhotoURLs, otherUserPhotoURL, otherUserDogOptions] = await Promise.all([
          Promise.all(
            pendingDogIds.map(async (dogId: string): Promise<string> => {
              try {
                const dogSnap = await getDoc(doc(db, 'dogs', dogId));
                const dogData = dogSnap.data();
                const urls = dogData?.photoURLs as string[] | undefined;
                return urls?.[0] ?? '';
              } catch {
                return '';
              }
            }),
          ),
          (async (): Promise<string | undefined> => {
            if (!pendingOtherUserId) return undefined;
            try {
              const otherSnap = await getDoc(doc(db, 'publicProfiles', pendingOtherUserId));
              const otherData = otherSnap.data();
              return (otherData?.photoURL as string | undefined) ?? undefined;
            } catch {
              return undefined;
            }
          })(),
          (async (): Promise<ReviewFlowParams['otherUserDogOptions']> => {
            if (!pendingOtherUserId) return [];
            try {
              const dogsSnap = await getDocs(query(collection(db, 'dogs'), where('ownerId', '==', pendingOtherUserId)));
              const postDogIdSet = new Set(pendingDogIds);
              return dogsSnap.docs
                .filter((dogDoc) => !postDogIdSet.has(dogDoc.id))
                .map((dogDoc) => {
                  const dogData = dogDoc.data();
                  const photoURLs = dogData?.photoURLs as string[] | undefined;
                  return {
                    dogId: dogDoc.id,
                    dogName: (dogData?.name as string) ?? 'the dog',
                    photoURL: photoURLs?.[0],
                  };
                });
            } catch {
              return [];
            }
          })(),
        ]);

        // Open the inescapable review gate. The gate (a root-level blocking
        // Modal) covers the tab bar and all navigation until every step is
        // submitted, at which point clearPendingReview fires and we null this.
        setMandatoryReviewData({
          postId: pending.postId as string,
          role: pending.role as 'owner' | 'caregiver',
          otherUserId: pendingOtherUserId,
          otherUserName: (pending.otherUserName as string) ?? 'the other person',
          dogIds: pendingDogIds,
          dogNames: (pending.dogNames as string[]) ?? [],
          dogPhotoURLs,
          otherUserDogOptions,
          otherUserPhotoURL,
        });
      } catch (err) {
        console.error('[PendingReview] Check failed:', err);
      }
    })();
  }, [user]);

  // ── Live review trigger: open the SAME gate the moment a commitment ends ──
  // while the user is in-app, on any tab (additive to the on-open getDoc above,
  // which still covers the not-in-app / cold-start case). Both feed the single
  // mandatoryReviewData state and the one root Modal below.
  const openMandatoryReview = useCallback((params: ReviewFlowParams) => {
    setMandatoryReviewData((prev) => prev ?? params);
  }, []);
  useLiveReviewTrigger({
    user,
    isGateOpen: !!mandatoryReviewData,
    openGate: openMandatoryReview,
  });

  // ── Sitter acceptance celebration (when owner approves this user as sitter) ──
  const shownAcceptanceIds = useRef<Set<string>>(new Set());
  useEffect(() => {
    if (!user) return;
    const q = query(
      collection(db, 'swapPosts'),
      where('claimedBy', '==', user.uid),
      where('status', '==', 'claimed')
    );
    const unsub = onSnapshot(q, (snap) => {
      for (const change of snap.docChanges()) {
        if (change.type === 'added' && !shownAcceptanceIds.current.has(change.doc.id)) {
          const data = change.doc.data();
          // Only show if the post was recently updated (within last 60s) to avoid showing on app cold start
          const updatedAt = data.updatedAt?.toDate?.() ?? new Date(0);
          const isRecent = (Date.now() - updatedAt.getTime()) < 60000;
          if (isRecent && data.posterId !== user.uid) {
            shownAcceptanceIds.current.add(change.doc.id);
            const dogDisplay = data.dogNames && data.dogNames.length > 1
              ? (data.dogNames as string[]).join(' & ') : (data.dogName as string ?? 'the dog');
            setCelebrationQueue((prev) => [...prev, { title: "You're Booked!", subtitle: "You've been chosen to watch " + dogDisplay + '!', emoji: '\U0001F436' }]);
            break;
          }
        }
      }
    });
    return unsub;
  }, [user]);


  return (
    <>
      {/* Inescapable post-commitment review gate — renders above the tab bar
          and all navigation. onRequestClose is a no-op so Android hardware
          back cannot dismiss it; there is no swipe-to-dismiss on an RN Modal. */}
      <Modal
        visible={!!mandatoryReviewData}
        animationType="slide"
        transparent={false}
        onRequestClose={() => {
          /* no-op: the gate cannot be dismissed without submitting */
        }}
      >
        {mandatoryReviewData && (
          <MandatoryReviewGate
            data={mandatoryReviewData}
            onComplete={() => setMandatoryReviewData(null)}
          />
        )}
      </Modal>
    <ConfettiCelebration
        queue={celebrationQueue}
        onDismissAll={() => setCelebrationQueue([])}
      />
    <Tab.Navigator
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: colors.primary,
        tabBarInactiveTintColor: colors.textSecondary,
        tabBarStyle: {
          backgroundColor: colors.surface,
          borderTopColor: colors.border,
          borderTopWidth: 1,
        },
      }}
    >
      <Tab.Screen
        name="DiscoverTab"
        component={DiscoverNavigator}
        options={{ tabBarLabel: 'Discover', tabBarIcon: ({ color }) => <Text style={{ fontSize: 22, color }}>🐾</Text> }}
      />
      <Tab.Screen
        name="RequestsTab"
        component={RequestsNavigator}
        options={{ tabBarLabel: 'Schedule', tabBarIcon: ({ color }) => <Text style={{ fontSize: 22, color }}>📅</Text> }}
      />
      <Tab.Screen
        name="MessagesTab"
        component={MessagesNavigator}
        options={{ tabBarLabel: 'Messages', tabBarIcon: MessagesIcon }}
      />
      <Tab.Screen
        name="ProfileTab"
        component={ProfileNavigator}
        options={{ tabBarLabel: 'Profile', tabBarIcon: ({ color }) => <Text style={{ fontSize: 22, color }}>👤</Text> }}
      />
    </Tab.Navigator>
    </>
  );
};

export default MainTabNavigator;
