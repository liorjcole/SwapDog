import React, { useState, useRef, useEffect } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, Image, Dimensions, Alert } from 'react-native';
import * as Haptics from 'expo-haptics';
import { useTheme } from '../../contexts/ThemeContext';
import ButtonConfettiBurst from './ButtonConfettiBurst';
import { spacing, borderRadius } from '../../config/theme';

interface Props {
  text: string;
  isMe: boolean;
  createdAt: Date;
  /** Optional message type for special rendering */
  type?: 'text' | 'reschedule' | 'reschedule_request' | 'image' | 'help_request';
  /** Optional image URL for photo messages */
  imageURL?: string;
  /** Callback when "Accept" is tapped on a help request */
  onAcceptHelp?: () => void;
  /** Whether this help request has already been accepted */
  helpAccepted?: boolean;
  /** Callback when helper removes their own help request */
  onRemoveRequest?: () => void;
  /** Whether this help request removal is in progress */
  removingRequest?: boolean;
  /** Callbacks for caregiver response to an owner reschedule request */
  onRescheduleWorks?: () => void;
  onRescheduleCannot?: () => void;
  rescheduleResponded?: boolean;
  /** Callback when user long-presses to unsend (only available within 1 min) */
  onUnsend?: () => void;
}

const MessageBubble: React.FC<Props> = ({ text, isMe, createdAt, type, imageURL, onAcceptHelp, helpAccepted, onRemoveRequest, removingRequest, onRescheduleWorks, onRescheduleCannot, rescheduleResponded, onUnsend }) => {
  const { colors } = useTheme();

  // Init to current value so an already-accepted offer never replays on mount.
  const prevAccepted = useRef(helpAccepted ?? false);
  // Confetti burst: showBurst gates rendering; burstKey remounts to replay.
  const [burstKey, setBurstKey] = useState(0);
  const [showBurst, setShowBurst] = useState(false);

  // Fire confetti on the false→true helpAccepted transition only.
  // Fires for BOTH owner (who tapped Accept) and helper (whose offer was accepted)
  // because helpAccepted derives from persisted swapPost.status === 'claimed'.
  useEffect(() => {
    if (!prevAccepted.current && helpAccepted) {
      setBurstKey((k) => k + 1);
      setShowBurst(true);
    }
    prevAccepted.current = helpAccepted ?? false;
  }, [helpAccepted]);

  const timeStr = createdAt.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

  const handleLongPress = () => {
    if (!onUnsend) return;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    Alert.alert(
      'Unsend Message',
      'This message will be removed for everyone.',
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Unsend', style: 'destructive', onPress: onUnsend },
      ],
    );
  };

  return (
    <TouchableOpacity
      style={[styles.container, isMe ? styles.meContainer : styles.themContainer]}
      activeOpacity={onUnsend ? 0.7 : 1}
      onLongPress={onUnsend ? handleLongPress : undefined}
      delayLongPress={400}
      disabled={!onUnsend}
    >
      <View
        style={[
          styles.bubble,
          isMe ? { backgroundColor: colors.primary } : { backgroundColor: colors.surface },
        ]}
        accessibilityRole="none"
      >
        {type === 'image' && imageURL && (
          <Image
            source={{ uri: imageURL }}
            style={styles.chatImage}
            resizeMode="cover"
            accessibilityLabel={text || 'Photo'}
          />
        )}
        {text ? (
          <Text
            style={[styles.text, { color: isMe ? '#fff' : colors.text }]}
            accessibilityLabel={`${isMe ? 'You' : 'Them'}: ${text}`}
          >
            {text}
          </Text>
        ) : null}
        {/* Accepted badge — shown to both sender (helper) and receiver (owner) */}
        {type === 'help_request' && helpAccepted && (
          <View style={styles.acceptedBadge}>
            <Text style={styles.acceptedBadgeText}>✅ Accepted</Text>
          </View>
        )}
        {/* Accept button — owner only, before accepting */}
        {type === 'help_request' && !helpAccepted && !isMe && onAcceptHelp && (
          <TouchableOpacity onPress={onAcceptHelp} style={styles.acceptBtn}>
            <Text style={styles.acceptBtnText}>Accept</Text>
          </TouchableOpacity>
        )}
        {/* Remove Request — sender (helper) only, before accepting */}
        {type === 'help_request' && !helpAccepted && isMe && onRemoveRequest && (
          <TouchableOpacity
            onPress={onRemoveRequest}
            style={styles.removeRequestBtn}
            disabled={removingRequest}
          >
            <Text style={styles.removeRequestBtnText}>
              {removingRequest ? 'Removing...' : 'Remove Request'}
            </Text>
          </TouchableOpacity>
        )}
        {type === 'reschedule_request' && !isMe && !rescheduleResponded && onRescheduleWorks && onRescheduleCannot && (
          <View style={styles.rescheduleActions}>
            <TouchableOpacity onPress={onRescheduleWorks} style={styles.worksBtn}>
              <Text style={styles.worksBtnText}>Works for me!</Text>
            </TouchableOpacity>
            <TouchableOpacity onPress={onRescheduleCannot} style={styles.cannotBtn}>
              <Text style={styles.cannotBtnText}>Can{"'"}t make it</Text>
            </TouchableOpacity>
          </View>
        )}
        {type === 'reschedule_request' && rescheduleResponded && (
          <View style={styles.acceptedBadge}>
            <Text style={styles.acceptedBadgeText}>Responded</Text>
          </View>
        )}
        <Text style={[styles.time, { color: isMe ? 'rgba(255,255,255,0.7)' : colors.textSecondary }]}>
          {timeStr}
        </Text>
        {/* Confetti burst anchored to bubble centre; fires on false→true transition (both parties). */}
        {type === 'help_request' && showBurst && (
          <ButtonConfettiBurst
            key={burstKey}
            onDone={() => setShowBurst(false)}
          />
        )}
      </View>
    </TouchableOpacity>
  );
};

const styles = StyleSheet.create({
  container: { marginVertical: 2, paddingHorizontal: spacing.sm },
  meContainer: { alignItems: 'flex-end' },
  themContainer: { alignItems: 'flex-start' },
  bubble: {
    maxWidth: '78%',
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: borderRadius.lg,
  },
  text: { fontSize: 17 },
  chatImage: {
    width: Dimensions.get('window').width * 0.55,
    height: Dimensions.get('window').width * 0.55,
    borderRadius: 12,
    marginBottom: 4,
  },
  time: { fontSize: 12, marginTop: 2, alignSelf: 'flex-end' },
  acceptBtn: { marginTop: 8, backgroundColor: '#00B894', paddingVertical: 8, paddingHorizontal: 20, borderRadius: 8, alignItems: 'center' },
  acceptBtnText: { color: '#fff', fontSize: 16, fontWeight: '700' },
  acceptedBadge: { marginTop: 8, paddingVertical: 6, paddingHorizontal: 16, borderRadius: 8, backgroundColor: 'rgba(0,184,148,0.15)', alignItems: 'center' },
  acceptedBadgeText: { color: '#00B894', fontSize: 15, fontWeight: '600' },
  removeRequestBtn: { marginTop: 8, backgroundColor: 'rgba(255,255,255,0.25)', paddingVertical: 8, paddingHorizontal: 20, borderRadius: 8, alignItems: 'center' },
  removeRequestBtnText: { color: '#FFFFFF', fontSize: 15, fontWeight: '600' },
  rescheduleActions: { flexDirection: 'row', gap: 8, marginTop: 10 },
  worksBtn: { flex: 1, backgroundColor: '#00B894', paddingVertical: 8, paddingHorizontal: 10, borderRadius: 8, alignItems: 'center' },
  worksBtnText: { color: '#FFFFFF', fontSize: 14, fontWeight: '800' },
  cannotBtn: { flex: 1, backgroundColor: '#FF3B30', paddingVertical: 8, paddingHorizontal: 10, borderRadius: 8, alignItems: 'center' },
  cannotBtnText: { color: '#FFFFFF', fontSize: 14, fontWeight: '800' },
});


export default MessageBubble;
