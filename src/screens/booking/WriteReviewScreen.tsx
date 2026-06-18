import React, { useState } from 'react';
import { View, Text, TextInput, TouchableOpacity, StyleSheet, Alert, KeyboardAvoidingView, Platform, ScrollView } from 'react-native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { RouteProp } from '@react-navigation/native';
import * as Haptics from 'expo-haptics';
import { RequestsStackParamList } from '../../navigation/types';
import { useAuthContext } from '../../contexts/AuthContext';
import { useTheme } from '../../contexts/ThemeContext';
import { useReviews } from '../../hooks/useReviews';
import { spacing, borderRadius, typography } from '../../config/theme';
import StarRating from '../../components/common/StarRating';

type Props = {
  navigation: NativeStackNavigationProp<RequestsStackParamList, 'WriteReview'>;
  route: RouteProp<RequestsStackParamList, 'WriteReview'>;
};

const WriteReviewScreen: React.FC<Props> = ({ navigation, route }) => {
  const { colors } = useTheme();
  const { user } = useAuthContext();
  const { createReview } = useReviews();
  const [rating, setRating] = useState(0);
  const [comment, setComment] = useState('');
  const [loading, setLoading] = useState(false);

  const handleSubmit = async () => {
    if (rating === 0) { Alert.alert('Required', 'Please select a rating'); return; }
    if (!user) return;
    setLoading(true);
    try {
      await createReview({
        reviewerId: user.uid,
        revieweeId: route.params?.revieweeId ?? '',
        swapRequestId: route.params?.swapRequestId ?? '',
        rating,
        comment: comment.trim() || undefined,
        reviewRole: route.params?.reviewRole ?? undefined,
      });
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
    <KeyboardAvoidingView
      style={{ flex: 1, backgroundColor: colors.background }}
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      keyboardVerticalOffset={Platform.OS === 'ios' ? 90 : 0}
    >
      <ScrollView contentContainerStyle={styles.container} keyboardShouldPersistTaps="handled">
      <Text style={[styles.title, { color: colors.text }]}>{route.params?.reviewRole === 'sitter' ? 'Rate the Pet Sitter' : route.params?.reviewRole === 'owner' ? 'Rate the Pet Owner' : 'How was your experience?'}</Text>
      <Text style={[styles.sub, { color: colors.textSecondary }]}>Your review helps the community</Text>
      <View style={styles.ratingContainer} accessibilityRole="adjustable" accessibilityLabel={`Selected rating: ${rating} of 5 stars`}>
        <StarRating rating={rating} onRate={setRating} size={40} />
      </View>
      <TextInput
        style={[styles.input, { backgroundColor: colors.surface, borderColor: colors.border, color: colors.text }]}
        placeholder="Share your experience... (optional)"
        placeholderTextColor={colors.textSecondary}
        value={comment}
        onChangeText={setComment}
        multiline
        numberOfLines={4}
        accessibilityLabel="Review comment, optional"
      returnKeyType="done"
              blurOnSubmit={true}
              />
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
    </KeyboardAvoidingView>
  );
};

const styles = StyleSheet.create({
  container: { flexGrow: 1, padding: spacing.lg, justifyContent: 'center' },
  title: { ...typography.h2, textAlign: 'center', marginBottom: spacing.xs },
  sub: { ...typography.body, textAlign: 'center', marginBottom: spacing.xl },
  ratingContainer: { alignItems: 'center', marginBottom: spacing.xl },
  input: {
    borderWidth: 1, borderRadius: borderRadius.md, padding: spacing.md,
    fontSize: 15, height: 100, textAlignVertical: 'top', marginBottom: spacing.lg,
  },
  btn: { padding: spacing.md, borderRadius: borderRadius.md, alignItems: 'center' },
  btnText: { color: '#fff', ...typography.button },
});

export default WriteReviewScreen;
