import React, { useState } from 'react';
import { View, Text, TextInput, TouchableOpacity, StyleSheet, Alert, Platform, ScrollView } from 'react-native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { RouteProp } from '@react-navigation/native';
import * as Haptics from 'expo-haptics';
import { RequestsStackParamList } from '../../navigation/types';
import { useAuthContext } from '../../contexts/AuthContext';
import { useTheme } from '../../contexts/ThemeContext';
import { useReviews } from '../../hooks/useReviews';
import { spacing, borderRadius, typography } from '../../config/theme';
import StarRating from '../../components/common/StarRating';
import KeyboardDoneBar, { DONE_ACCESSORY_ID } from '../../components/common/KeyboardDoneBar';
import { useKeyboardScroll } from '../../hooks/useKeyboardScroll';

type Props = {
  navigation: NativeStackNavigationProp<RequestsStackParamList, 'WriteReview'>;
  route: RouteProp<RequestsStackParamList, 'WriteReview'>;
};

const WriteReviewScreen: React.FC<Props> = ({ navigation, route }) => {
  const { colors } = useTheme();
  const { user } = useAuthContext();
  const { createReview } = useReviews();
  const { scrollRef, onScroll, onLayout, onContentSizeChange, refFor, scrollToInput } = useKeyboardScroll();
  const isLateCancellation = route.params?.lateCancellation === true;
  const [rating, setRating] = useState(isLateCancellation ? 1 : 0);
  const [comment, setComment] = useState(
    isLateCancellation
      ? 'Caretaker canceled less than 24 hours before the scheduled care.'
      : ''
  );
  const [loading, setLoading] = useState(false);

  const handleSubmit = async () => {
    if (rating === 0) { Alert.alert('Required', 'Please select a rating'); return; }
    if (!user) return;
    setLoading(true);
    try {
      await createReview({
        postId: route.params?.swapRequestId ?? '',
        reviewerId: user.uid,
        reviewerName: 'Anonymous',
        revieweeId: route.params?.revieweeId ?? '',
        targetType: route.params?.reviewRole === 'sitter' ? 'caregiver' : 'owner',
        rating,
        note: comment.trim() || undefined,
        // Legacy compat fields
        swapRequestId: route.params?.swapRequestId ?? '',
        comment: comment.trim() || undefined,
        reviewRole: route.params?.reviewRole ?? undefined });
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      Alert.alert('Review submitted!', 'Thanks for your feedback', [
        { text: 'OK', onPress: () => navigation.goBack() },
      ]);
    } catch (error: unknown) {
      Alert.alert('Error', error instanceof Error ? error.message : 'Failed to submit review');
    } finally {
      setLoading(false);
    }
  };

  return (
    <View style={{ flex: 1, backgroundColor: colors.background }}>
      <ScrollView
        ref={scrollRef}
        onScroll={onScroll}
        onLayout={onLayout}
        onContentSizeChange={onContentSizeChange}
        scrollEventThrottle={16}
        automaticallyAdjustKeyboardInsets={false}
        contentContainerStyle={styles.container}
        keyboardShouldPersistTaps="handled">
      {isLateCancellation && (
        <View style={{ backgroundColor: '#FF2D5520', borderRadius: 12, padding: 14, marginBottom: 16, borderWidth: 1, borderColor: '#FF2D5540' }}>
          <Text style={{ color: '#FF2D55', fontSize: 15, fontWeight: '700', textAlign: 'center', marginBottom: 4 }}>
            ⚠️ Late Cancellation
          </Text>
          <Text style={{ color: colors.textSecondary, fontSize: 14, textAlign: 'center' }}>
            This caretaker canceled less than 24 hours before the scheduled care. A 1-star rating has been suggested — you can change it if you{"'"}d like.
          </Text>
        </View>
      )}
      <Text style={[styles.title, { color: colors.text }]}>{route.params?.reviewRole === 'sitter' ? 'Rate the Pet Sitter' : route.params?.reviewRole === 'owner' ? 'Rate the Pet Owner' : isLateCancellation ? 'Rate the Caretaker' : 'How was your experience?'}</Text>
      <Text style={[styles.sub, { color: colors.textSecondary }]}>Your review helps the community</Text>
      <View style={styles.ratingContainer} accessibilityRole="adjustable" accessibilityLabel={`Selected rating: ${rating} of 5 stars`}>
        <StarRating rating={rating} onRate={setRating} size={40} />
      </View>
      <View ref={refFor('reviewComment')}>
        <TextInput
          style={[styles.input, { backgroundColor: colors.surface, borderColor: colors.border, color: colors.text }]}
          placeholder="Share your experience... (optional)"
          placeholderTextColor={colors.textSecondary}
          value={comment}
          onChangeText={setComment}
          onFocus={() => scrollToInput('reviewComment')}
          multiline
          inputAccessoryViewID={DONE_ACCESSORY_ID}
          numberOfLines={4}
          accessibilityLabel="Review comment, optional"
          returnKeyType="done"
          blurOnSubmit={true}
        />
      </View>
      <TouchableOpacity
        style={[styles.btn, { backgroundColor: colors.primary, opacity: loading ? 0.7 : 1 }]}
        onPress={handleSubmit}
        disabled={loading}
        accessibilityLabel={loading ? 'Submitting review...' : 'Submit review'}
        accessibilityRole="button"
      >
        <Text style={styles.btnText}>{loading ? 'Submitting...' : 'Submit Review'}</Text>
      </TouchableOpacity>
      </ScrollView>
    <KeyboardDoneBar />
</View>
  );
};

const styles = StyleSheet.create({
  container: { flexGrow: 1, padding: spacing.lg, justifyContent: 'center' },
  title: { ...typography.h2, textAlign: 'center', marginBottom: spacing.xs },
  sub: { ...typography.body, textAlign: 'center', marginBottom: spacing.xl },
  ratingContainer: { alignItems: 'center', marginBottom: spacing.xl },
  input: {
    borderWidth: 1, borderRadius: borderRadius.md, padding: spacing.md,
    fontSize: 17, height: 100, textAlignVertical: 'top', marginBottom: spacing.lg },
  btn: { padding: spacing.md, borderRadius: borderRadius.md, alignItems: 'center' },
  btnText: { color: '#fff', ...typography.button } });

export default WriteReviewScreen;
