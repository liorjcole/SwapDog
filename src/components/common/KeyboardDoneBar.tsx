import React from 'react';
import { InputAccessoryView, View, TouchableOpacity, Text, Keyboard, StyleSheet } from 'react-native';

/** Shared accessory view ID — all multiline TextInputs use this */
export const DONE_ACCESSORY_ID = 'keyboard-done-bar';

/**
 * Minimal "Done" button that floats above the keyboard for multiline TextInputs.
 * Mount once per screen and set `inputAccessoryViewID={DONE_ACCESSORY_ID}` on each multiline TextInput.
 * iOS only — Android ignores InputAccessoryView.
 */
const KeyboardDoneBar: React.FC = () => (
  <InputAccessoryView nativeID={DONE_ACCESSORY_ID}>
    <View style={styles.bar}>
      <TouchableOpacity onPress={() => Keyboard.dismiss()} hitSlop={{ top: 8, bottom: 8, left: 16, right: 16 }}>
        <Text style={styles.doneText}>Done</Text>
      </TouchableOpacity>
    </View>
  </InputAccessoryView>
);

const styles = StyleSheet.create({
  bar: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    alignItems: 'center',
    backgroundColor: '#D1D5DB',
    paddingHorizontal: 16,
    paddingVertical: 8,
  },
  doneText: {
    fontSize: 17,
    fontWeight: '600',
    color: '#007AFF',
  },
});

export default KeyboardDoneBar;
