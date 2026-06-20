import React from 'react';
import { View, TouchableOpacity, StyleSheet, Platform, InputAccessoryView, Keyboard } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

interface Props {
  /** Must match the TextInput's inputAccessoryViewID */
  nativeID: string;
}

/**
 * iOS-only keyboard toolbar with a blue checkmark "Done" button.
 * Attach to any multiline TextInput via inputAccessoryViewID={nativeID}.
 *
 * Usage:
 *   <TextInput inputAccessoryViewID="myField" ... />
 *   <KeyboardDoneBar nativeID="myField" />
 */
const KeyboardDoneBar: React.FC<Props> = ({ nativeID }) => {
  if (Platform.OS !== 'ios') return null;

  return (
    <InputAccessoryView nativeID={nativeID}>
      <View style={styles.bar}>
        <View style={styles.spacer} />
        <TouchableOpacity
          onPress={() => Keyboard.dismiss()}
          style={styles.btn}
          hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
          accessibilityRole="button"
          accessibilityLabel="Dismiss keyboard"
        >
          <Ionicons name="checkmark-circle" size={28} color="#007AFF" />
        </TouchableOpacity>
      </View>
    </InputAccessoryView>
  );
};

const styles = StyleSheet.create({
  bar: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingVertical: 6,
    backgroundColor: '#D1D5DB',
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: '#8E8E93',
  },
  spacer: { flex: 1 },
  btn: { padding: 4 },
});

export default KeyboardDoneBar;
