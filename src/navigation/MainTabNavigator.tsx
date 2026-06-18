import React, { useEffect, useState, useCallback, useRef } from 'react';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { useNavigation, CommonActions } from '@react-navigation/native';
import { Text, View } from 'react-native';
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
import { collection, query, where, onSnapshot, doc, updateDoc, serverTimestamp, addDoc, getDocs, getDoc, deleteField } from 'firebase/firestore';
import { db } from '../config/firebase';
import { smartDate } from '../utils/dateHelpers';
import RescheduleReviewModal from '../components/common/RescheduleReviewModal';
import ConfettiCelebration, { CelebrationItem } from '../components/common/ConfettiCelebration';
import { SwapPost } from '../models/types';
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
      <RequestsStack.Screen name="PostDetail" component={PostDetailScreen} options={{ title: 'Post Details' }} />
      <RequestsStack.Screen name="UserDetail" component={UserDetailScreen} options={{ title: 'Profile' }} />
      <RequestsStack.Screen name="DogDetail" component={DogDetailScreen} options={{ title: 'Dog Profile' }} />
      <RequestsStack.Screen name="CreatePost" component={CreatePostScreen} options={{ title: 'Create Post', presentation: 'modal' }} />
      <RequestsStack.Screen name="Chat" component={ChatScreen} options={{ title: 'Chat', headerShown: false }} />
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
        <Text style={{ fontSize: 20, color }}>💬</Text>
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
            <Text style={{ color: '#fff', fontSize: 10, fontWeight: '700', lineHeight: 13 }}>
              {unreadCount > 99 ? '99+' : String(unreadCount)}
            </Text>
          </View>
        )}
      </View>
    ),
    [unreadCount, colors.surface],
  );

  // ── Reschedule popup for sitter (on app open) ──────────────────────────────
  const [reschedulePost, setReschedulePost] = useState<SwapPost | null>(null);
  const [celebrationQueue, setCelebrationQueue] = useState<CelebrationItem[]>([]);
  const [showReschedulePopup, setShowReschedulePopup] = useState(false);
  const dismissedPostIds = useRef<Set<string>>(new Set());
  const checkedReferralReward = useRef(false);
  const tabNavigation = useNavigation();

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
            onAction: () => {
              tabNavigation.dispatch(
                CommonActions.navigate('ProfileTab', { screen: 'Referral' })
              );
            },
          },
        ]);

        // Clear the pending reward flag so it doesn't show again
        await updateDoc(doc(db, 'users', user.uid), {
          pendingReferralReward: deleteField(),
          updatedAt: serverTimestamp(),
        });
      } catch (err) {
        console.error('[ReferralReward] Check failed:', err);
      }
    })();
  }, [user]);

  useEffect(() => {
    if (!user) return;
    // Listen for posts where THIS user is the sitter and status is reschedulePending
    const q = query(
      collection(db, 'swapPosts'),
      where('claimedBy', '==', user.uid),
      where('status', '==', 'reschedulePending')
    );
    const unsub = onSnapshot(q, (snap) => {
      const posts = snap.docs.map((d) => {
        const data = d.data();
        const toDate = (v: any): Date => {
          if (!v) return new Date();
          if (v.toDate) return v.toDate();
          if (typeof v === 'string') return new Date(v);
          return new Date();
        };
        return {
          id: d.id,
          posterId: data.posterId as string,
          posterName: data.posterName as string,
          dogId: data.dogId as string,
          dogName: data.dogName as string,
          startDate: toDate(data.startDate),
          endDate: toDate(data.endDate),
          careDetails: data.careDetails as string ?? '',
          compensationType: data.compensationType ?? 'points',
          pointsCost: data.pointsCost ?? 0,
          status: data.status,
          claimedBy: data.claimedBy,
          rescheduleProposedStart: toDate(data.rescheduleProposedStart),
          rescheduleProposedEnd: toDate(data.rescheduleProposedEnd),
          rescheduleNote: data.rescheduleNote as string | undefined,
          rescheduleProposedBy: data.rescheduleProposedBy as string | undefined,
          createdAt: toDate(data.createdAt),
        } as SwapPost;
      });
      // Show popup for the first undismissed pending reschedule
      const pending = posts.find((p) => !dismissedPostIds.current.has(p.id));
      if (pending) {
        setReschedulePost(pending);
        setShowReschedulePopup(true);
      }
    });
    return unsub;
  }, [user]);

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

  const handleRescheduleRespond = async (
    action: 'accept' | 'reject' | 'propose',
    note?: string,
    newStart?: Date,
    newEnd?: Date,
  ) => {
    if (!reschedulePost || !user) return;
    try {
      const postRef = doc(db, 'swapPosts', reschedulePost.id);
      if (action === 'accept') {
        // Accept: move proposed dates to actual dates, clear reschedule fields
        setCelebrationQueue((prev) => [...prev, { title: 'Dates Updated!', subtitle: smartDate(reschedulePost.rescheduleProposedStart!) + ' \u2013 ' + smartDate(reschedulePost.rescheduleProposedEnd!) + ' confirmed for ' + reschedulePost.dogName + "!", emoji: '\U0001F4C5' }]);
        await updateDoc(postRef, {
          startDate: reschedulePost.rescheduleProposedStart,
          endDate: reschedulePost.rescheduleProposedEnd,
          status: 'claimed',
          rescheduleProposedStart: null,
          rescheduleProposedEnd: null,
          rescheduleNote: null,
          rescheduleProposedBy: null,
          updatedAt: serverTimestamp(),
        });
        // Notify owner via chat
        // Use addDoc directly to send the chat message
        const convQ = query(
          collection(db, 'conversations'),
          where('swapRequestId', '==', reschedulePost.id),
          where('participantIds', 'array-contains', user.uid)
        );
        // Simplified: send via direct Firestore write
        const msgText = note
          ? `I accept the new dates (${smartDate(reschedulePost.rescheduleProposedStart!)}–${smartDate(reschedulePost.rescheduleProposedEnd!)}). ${note}`
          : `I accept the new dates (${smartDate(reschedulePost.rescheduleProposedStart!)}–${smartDate(reschedulePost.rescheduleProposedEnd!)}).`;
        // Find the conversation for this post
        const convSnap = await getDocs(convQ);
        if (!convSnap.empty) {
          const convId = convSnap.docs[0].id;
          await addDoc(collection(db, 'conversations', convId, 'messages'), {
            conversationId: convId, senderId: user.uid, text: msgText,
            read: false, createdAt: serverTimestamp(), type: 'text',
          });
          await updateDoc(doc(db, 'conversations', convId), {
            lastMessage: msgText, lastMessageAt: serverTimestamp(), updatedAt: serverTimestamp(),
          });
        }
      } else if (action === 'reject') {
        // Reject: revert status to claimed, clear reschedule fields
        await updateDoc(postRef, {
          status: 'claimed',
          rescheduleProposedStart: null,
          rescheduleProposedEnd: null,
          rescheduleNote: null,
          rescheduleProposedBy: null,
          updatedAt: serverTimestamp(),
        });
        const msgText = note
          ? `I can't do the new dates. ${note}`
          : `I can't do the proposed dates.`;
        const convQ2 = query(
          collection(db, 'conversations'),
          where('swapRequestId', '==', reschedulePost.id),
          where('participantIds', 'array-contains', user.uid)
        );
        const convSnap = await getDocs(convQ2);
        if (!convSnap.empty) {
          const convId = convSnap.docs[0].id;
          await addDoc(collection(db, 'conversations', convId, 'messages'), {
            conversationId: convId, senderId: user.uid, text: msgText,
            read: false, createdAt: serverTimestamp(), type: 'text',
          });
          await updateDoc(doc(db, 'conversations', convId), {
            lastMessage: msgText, lastMessageAt: serverTimestamp(), updatedAt: serverTimestamp(),
          });
        }
      } else if (action === 'propose') {
        // Counter-propose: update the proposed dates, keep reschedulePending
        await updateDoc(postRef, {
          rescheduleProposedStart: newStart,
          rescheduleProposedEnd: newEnd,
          rescheduleNote: note || null,
          rescheduleProposedBy: user.uid,
          updatedAt: serverTimestamp(),
        });
        const msgText = note
          ? `How about ${smartDate(newStart!)}–${smartDate(newEnd!)} instead? ${note}`
          : `How about ${smartDate(newStart!)}–${smartDate(newEnd!)} instead?`;
        const convQ3 = query(
          collection(db, 'conversations'),
          where('swapRequestId', '==', reschedulePost.id),
          where('participantIds', 'array-contains', user.uid)
        );
        const convSnap = await getDocs(convQ3);
        if (!convSnap.empty) {
          const convId = convSnap.docs[0].id;
          await addDoc(collection(db, 'conversations', convId, 'messages'), {
            conversationId: convId, senderId: user.uid, text: msgText,
            read: false, createdAt: serverTimestamp(), type: 'reschedule',
            metadata: { postId: reschedulePost.id, proposedStart: newStart!.toISOString(), proposedEnd: newEnd!.toISOString() },
          });
          await updateDoc(doc(db, 'conversations', convId), {
            lastMessage: msgText, lastMessageAt: serverTimestamp(), updatedAt: serverTimestamp(),
          });
        }
      }
      setShowReschedulePopup(false);
      setReschedulePost(null);
    } catch (err) {
      console.warn('[MainTabNavigator] reschedule respond error:', err);
    }
  };

  return (
    <>
      {/* Reschedule popup — shows on app open for sitter */}
      {reschedulePost && (
        <RescheduleReviewModal
          visible={showReschedulePopup}
          onClose={() => {
            dismissedPostIds.current.add(reschedulePost.id);
            setShowReschedulePopup(false);
          }}
          proposedStart={reschedulePost.rescheduleProposedStart!}
          proposedEnd={reschedulePost.rescheduleProposedEnd!}
          originalStart={reschedulePost.startDate}
          originalEnd={reschedulePost.endDate}
          proposerName={reschedulePost.posterName}
          proposerNote={reschedulePost.rescheduleNote}
          onRespond={handleRescheduleRespond}
        />
      )}
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
        options={{ tabBarLabel: 'Discover', tabBarIcon: ({ color }) => <Text style={{ fontSize: 20, color }}>🐾</Text> }}
      />
      <Tab.Screen
        name="RequestsTab"
        component={RequestsNavigator}
        options={{ tabBarLabel: 'Schedule', tabBarIcon: ({ color }) => <Text style={{ fontSize: 20, color }}>📅</Text> }}
      />
      <Tab.Screen
        name="MessagesTab"
        component={MessagesNavigator}
        options={{ tabBarLabel: 'Messages', tabBarIcon: MessagesIcon }}
      />
      <Tab.Screen
        name="ProfileTab"
        component={ProfileNavigator}
        options={{ tabBarLabel: 'Profile', tabBarIcon: ({ color }) => <Text style={{ fontSize: 20, color }}>👤</Text> }}
      />
    </Tab.Navigator>
    </>
  );
};

export default MainTabNavigator;
