/**
 * InsufficientPointsModal
 *
 * Shown once per session when the user's points balance is <= 0 and they have
 * active posts offering points compensation. Gives them two choices:
 *   1. Review disabled posts → delete or switch to cash
 *   2. Earn more points → bouncing invite-a-friend button
 *
 * Also fires a local push notification so the user notices even if
 * the app is backgrounded immediately after the deduction.
 */
import React, { useEffect, useRef, useState } from 'react';
import {
  Alert,
  Animated,
  Easing,
  Modal,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  Share,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import * as Haptics from 'expo-haptics';
import { useAuthContext } from '../../contexts/AuthContext';
import { useTheme } from '../../contexts/ThemeContext';
import { useSwaps } from '../../hooks/useSwaps';
import { SwapPost } from '../../models/types';
import { scheduleLocalNotification } from '../../services/NotificationService';
import { spacing, borderRadius, shadow } from '../../config/theme';
import { doc, updateDoc, serverTimestamp } from 'firebase/firestore';
import { db } from '../../config/firebase';

const InsufficientPointsModal: React.FC = () => {
  const { user, userProfile } = useAuthContext();
  const { colors } = useTheme();
  const { getMyPosts, cancelPost } = useSwaps();

  const [visible, setVisible] = useState(false);
  const [screen, setScreen] = useState<'warning' | 'posts' | 'earn'>('warning');
  const [disabledPosts, setDisabledPosts] = useState<SwapPost[]>([]);
  const [cashAmounts, setCashAmounts] = useState<Record<string, string>>({});
  const hasShownRef = useRef(false);

  // Bounce animation for "Invite a Friend" button
  const bounceAnim = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    if (screen === 'earn') {
      Animated.loop(
        Animated.sequence([
          Animated.timing(bounceAnim, { toValue: -8, duration: 400, easing: Easing.inOut(Easing.ease), useNativeDriver: true }),
          Animated.timing(bounceAnim, { toValue: 0, duration: 400, easing: Easing.inOut(Easing.ease), useNativeDriver: true }),
        ]),
      ).start();
    } else {
      bounceAnim.stopAnimation();
      bounceAnim.setValue(0);
    }
  }, [screen]);

  useEffect(() => {
    if (!user?.uid || !userProfile || hasShownRef.current) return;
    const balance = userProfile.points ?? 0;
    if (balance > 0) return;

    // Check for active posts offering points
    getMyPosts(user.uid).then((posts) => {
      const pointsPosts = posts.filter(
        (p) => p.status === 'open' && (p.compensationType === 'points' || p.compensationType === 'either'),
      );
      if (pointsPosts.length === 0) return;

      hasShownRef.current = true;
      setDisabledPosts(pointsPosts);
      setVisible(true);

      // Fire local push notification
      scheduleLocalNotification(
        'Your posts have been paused ⚠️',
        'Your points balance has run out. Posts offering points are now disabled until you earn more or switch to cash.',
        1,
      ).catch(() => { /* non-fatal */ });

      // Mark these posts as disabled in Firestore so they don't appear in the feed
      for (const p of pointsPosts) {
        updateDoc(doc(db, 'swapPosts', p.id), { pointsDisabled: true, updatedAt: serverTimestamp() })
          .catch(() => { /* non-fatal */ });
      }
    }).catch(() => { /* non-fatal */ });
  }, [user?.uid, userProfile?.points]);

  // Auto-reactivate posts when balance goes positive again
  useEffect(() => {
    if (!user?.uid || !userProfile) return;
    const balance = userProfile.points ?? 0;
    if (balance <= 0) return;

    // User has points again — re-enable any paused posts
    getMyPosts(user.uid).then((posts) => {
      for (const p of posts) {
        if (p.pointsDisabled) {
          updateDoc(doc(db, 'swapPosts', p.id), { pointsDisabled: false, updatedAt: serverTimestamp() })
            .catch(() => { /* non-fatal */ });
        }
      }
    }).catch(() => { /* non-fatal */ });
  }, [user?.uid, userProfile?.points]);

  const handleDeletePost = (postId: string) => {
    Alert.alert('Delete Post?', 'This will permanently remove this post.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: async () => {
          try {
            await cancelPost(postId);
            Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
            setDisabledPosts((prev) => prev.filter((p) => p.id !== postId));
          } catch {
            Alert.alert('Error', 'Failed to delete post.');
          }
        },
      },
    ]);
  };

  const handleSwitchToCash = async (post: SwapPost) => {
    const amount = cashAmounts[post.id];
    if (!amount || isNaN(Number(amount)) || Number(amount) <= 0) {
      Alert.alert('Enter Amount', 'Please enter a valid dollar amount.');
      return;
    }
    try {
      await updateDoc(doc(db, 'swapPosts', post.id), {
        compensationType: 'payment',
        paymentAmount: Number(amount),
        paymentRate: 'per_day',
        pointsDisabled: false,
        updatedAt: serverTimestamp(),
      });
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      setDisabledPosts((prev) => prev.filter((p) => p.id !== post.id));
      Alert.alert('Updated!', `Post switched to $${amount}/day. It's active again.`);
    } catch {
      Alert.alert('Error', 'Failed to update post.');
    }
  };

  const handleInviteShare = async () => {
    const referralCode = userProfile?.referralCode ?? '';
    if (!referralCode) return;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    try {
      await Share.share({
        message:
          '🐾 Join me on WatchDog — neighbors helping neighbors with pet sitting, walking & more!\n\n' +
          'Use my referral code: ' + referralCode + '\n\n' +
          'Sign up here: https://joinwatchdog.com',
        title: 'Join WatchDog',
      });
    } catch {
      // user dismissed share sheet
    }
  };

  const handleClose = () => {
    setVisible(false);
    setScreen('warning');
  };

  if (!visible) return null;

  return (
    <Modal visible transparent animationType="fade" onRequestClose={handleClose}>
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        style={{ flex: 1 }}
      >
        <View style={styles.overlay}>
          <View style={[styles.card, { backgroundColor: colors.surface }]}>
          {/* ── Warning screen ── */}
          {screen === 'warning' && (
            <>
              <Text style={[styles.title, { color: colors.text }]}>⚠️ Posts Paused</Text>
              <Text style={[styles.body, { color: colors.textSecondary }]}>
                Your points balance has run out. Any active posts offering points as compensation have
                been disabled and are no longer visible to other users.
              </Text>
              <Text style={[styles.body, { color: colors.textSecondary, marginTop: 8 }]}>
                You can either update your posts or earn more points to reactivate them.
              </Text>

              <TouchableOpacity
                style={[styles.primaryBtn, { backgroundColor: '#FF2D55' }]}
                onPress={() => setScreen('posts')}
              >
                <Text style={styles.primaryBtnText}>Review Disabled Posts ({disabledPosts.length})</Text>
              </TouchableOpacity>

              <TouchableOpacity
                style={[styles.secondaryBtn, { borderColor: colors.primary }]}
                onPress={() => setScreen('earn')}
              >
                <Text style={[styles.secondaryBtnText, { color: colors.primary }]}>Earn More Points!</Text>
              </TouchableOpacity>

              <TouchableOpacity onPress={handleClose}>
                <Text style={[styles.dismissText, { color: colors.textSecondary }]}>Dismiss</Text>
              </TouchableOpacity>
            </>
          )}

          {/* ── Posts review screen ── */}
          {screen === 'posts' && (
            <>
              <Text style={[styles.title, { color: colors.text }]}>Your Disabled Posts</Text>
              {disabledPosts.length === 0 ? (
                <Text style={[styles.body, { color: colors.textSecondary }]}>
                  All posts have been updated! 🎉
                </Text>
              ) : (
                <ScrollView style={styles.postsList} showsVerticalScrollIndicator={false}>
                  {disabledPosts.map((post) => (
                    <View key={post.id} style={[styles.postCard, { backgroundColor: colors.background, ...shadow.sm }]}>
                      <Text style={[styles.postTitle, { color: colors.text }]}>
                        🐾 {post.dogName ?? 'Dog care'}
                      </Text>
                      <Text style={[styles.postMeta, { color: colors.textSecondary }]}>
                        {post.pointsOffered ?? post.pointsCost ?? 0} points offered
                      </Text>

                      {/* Switch to cash */}
                      <View style={styles.cashRow}>
                        <Text style={[styles.cashLabel, { color: colors.text }]}>Switch to $:</Text>
                        <TextInput
                          style={[styles.cashInput, { backgroundColor: colors.surface, color: colors.text, borderColor: colors.border ?? '#555' }]}
                          placeholder="$/day"
                          placeholderTextColor={colors.textSecondary}
                          keyboardType="numeric"
                          value={cashAmounts[post.id] ?? ''}
                          onChangeText={(t) => setCashAmounts((prev) => ({ ...prev, [post.id]: t }))}
                        />
                        <TouchableOpacity
                          style={[styles.cashBtn, { backgroundColor: colors.primary }]}
                          onPress={() => handleSwitchToCash(post)}
                        >
                          <Text style={styles.cashBtnText}>Save</Text>
                        </TouchableOpacity>
                      </View>

                      <TouchableOpacity onPress={() => handleDeletePost(post.id)}>
                        <Text style={styles.deleteLink}>Delete Post</Text>
                      </TouchableOpacity>
                    </View>
                  ))}
                </ScrollView>
              )}

              <TouchableOpacity
                style={[styles.secondaryBtn, { borderColor: colors.primary, marginTop: 12 }]}
                onPress={() => setScreen('earn')}
              >
                <Text style={[styles.secondaryBtnText, { color: colors.primary }]}>Earn More Points!</Text>
              </TouchableOpacity>

              <TouchableOpacity onPress={handleClose}>
                <Text style={[styles.dismissText, { color: colors.textSecondary }]}>Done</Text>
              </TouchableOpacity>
            </>
          )}

          {/* ── Earn points screen ── */}
          {screen === 'earn' && (
            <>
              <Text style={[styles.title, { color: colors.text }]}>Earn More Points!</Text>
              <Text style={[styles.body, { color: colors.textSecondary }]}>
                Invite a friend to WatchDog and earn 3 points when they sign up.
                Once your balance is positive, your posts will automatically become active again!
              </Text>

              <Animated.View style={{ transform: [{ translateY: bounceAnim }], alignSelf: 'center', marginTop: 20 }}>
                <TouchableOpacity
                  style={{ backgroundColor: '#FF2D55', borderRadius: 10, paddingVertical: 14, paddingHorizontal: 28 }}
                  onPress={handleInviteShare}
                >
                  <Text style={{ color: '#fff', fontWeight: '700', fontSize: 16, textAlign: 'center' }}>
                    🔗 Invite a Friend (and earn 3 points!)
                  </Text>
                </TouchableOpacity>
              </Animated.View>

              <TouchableOpacity
                style={[styles.secondaryBtn, { borderColor: colors.primary, marginTop: 20 }]}
                onPress={() => setScreen('posts')}
              >
                <Text style={[styles.secondaryBtnText, { color: colors.primary }]}>Review Disabled Posts</Text>
              </TouchableOpacity>

              <TouchableOpacity onPress={handleClose}>
                <Text style={[styles.dismissText, { color: colors.textSecondary }]}>Dismiss</Text>
              </TouchableOpacity>
            </>
          )}
          </View>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
};

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.7)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 24,
  },
  card: {
    width: '100%',
    maxHeight: '80%',
    borderRadius: borderRadius.lg,
    padding: spacing.lg,
  },
  title: {
    fontSize: 20,
    fontWeight: '700',
    textAlign: 'center',
    marginBottom: 12,
  },
  body: {
    fontSize: 15,
    lineHeight: 22,
    textAlign: 'center',
  },
  primaryBtn: {
    borderRadius: 10,
    paddingVertical: 14,
    paddingHorizontal: 24,
    marginTop: 20,
    alignItems: 'center',
  },
  primaryBtnText: {
    color: '#fff',
    fontWeight: '700',
    fontSize: 16,
  },
  secondaryBtn: {
    borderRadius: 10,
    borderWidth: 1.5,
    paddingVertical: 12,
    paddingHorizontal: 24,
    marginTop: 12,
    alignItems: 'center',
  },
  secondaryBtnText: {
    fontWeight: '600',
    fontSize: 15,
  },
  dismissText: {
    textAlign: 'center',
    marginTop: 16,
    fontSize: 14,
  },
  postsList: {
    maxHeight: 300,
    marginTop: 8,
  },
  postCard: {
    borderRadius: borderRadius.md,
    padding: spacing.md,
    marginBottom: 10,
  },
  postTitle: {
    fontSize: 16,
    fontWeight: '600',
    marginBottom: 4,
  },
  postMeta: {
    fontSize: 13,
    marginBottom: 10,
  },
  cashRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 10,
    gap: 8,
  },
  cashLabel: {
    fontSize: 14,
    fontWeight: '500',
  },
  cashInput: {
    flex: 1,
    borderWidth: 1,
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 6,
    fontSize: 14,
  },
  cashBtn: {
    borderRadius: 8,
    paddingVertical: 8,
    paddingHorizontal: 14,
  },
  cashBtnText: {
    color: '#fff',
    fontWeight: '600',
    fontSize: 14,
  },
  deleteLink: {
    color: '#FF3B30',
    fontSize: 14,
    fontWeight: '500',
    textAlign: 'center',
  },
});

export default InsufficientPointsModal;
