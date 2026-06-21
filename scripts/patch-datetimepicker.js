#!/usr/bin/env node
/**
 * SWAPDOG: Patch @react-native-community/datetimepicker to suppress keyboard.
 *
 * ROOT CAUSE: UIDatePicker's internal UITextFields become first responder
 * PROGRAMMATICALLY (not via touch) after the wheel settles. This means:
 *   - hitTest: overrides don't work (only intercepts touches)
 *   - Tap gesture recognizers don't work (not a tap event)
 *   - Keyboard.dismiss() from JS doesn't work (picker re-triggers it)
 *
 * FIX: Override layoutSubviews to find all UITextField subviews recursively
 * and set their inputView to an empty UIView. This is a standard iOS pattern
 * that replaces the keyboard with nothing — even when the text field becomes
 * first responder programmatically, no keyboard appears. The scroll wheels
 * are completely unaffected (they use UIPanGestureRecognizer on UIPickerView).
 */
const fs = require('fs');
const path = require('path');

const MARKER = 'SWAPDOG_KEYBOARD_PATCH';

const PATCH_CODE = `
// ${MARKER}
// Replace the keyboard with an empty view on all internal UITextFields.
// UIDatePicker programmatically makes its UITextFields first responder
// after the wheel settles — this can't be intercepted via hitTest or
// gesture recognizers. Setting inputView to an empty UIView is the
// standard iOS pattern: the text field CAN become first responder,
// but no keyboard appears. tintColor = clear hides the cursor.
- (void)layoutSubviews {
    [super layoutSubviews];
    [self swapdog_suppressKeyboardInView:self];
}

- (void)swapdog_suppressKeyboardInView:(UIView *)view {
    for (UIView *subview in view.subviews) {
        if ([subview isKindOfClass:[UITextField class]]) {
            UITextField *tf = (UITextField *)subview;
            if (!tf.inputView) {
                tf.inputView = [[UIView alloc] initWithFrame:CGRectZero];
                tf.tintColor = [UIColor clearColor];
            }
        }
        [self swapdog_suppressKeyboardInView:subview];
    }
}
`;

console.log('');
console.log('╔══════════════════════════════════════════════════════════╗');
console.log('║  SWAPDOG: Patching DateTimePicker to disable keyboard   ║');
console.log('╚══════════════════════════════════════════════════════════╝');

function patchFile(relPath, label) {
    const fullPath = path.join(
        __dirname, '..', 'node_modules',
        '@react-native-community', 'datetimepicker',
        relPath
    );
    if (!fs.existsSync(fullPath)) {
        console.log(`[patch-datetimepicker] ⚠️  ${label}: file not found — skipping`);
        return;
    }
    let src = fs.readFileSync(fullPath, 'utf8');
    if (src.includes(MARKER)) {
        console.log(`[patch-datetimepicker] ✅ ${label}: already patched`);
        return;
    }

    // Find the last @end and insert before it
    const lastEnd = src.lastIndexOf('@end');
    if (lastEnd === -1) {
        console.error(`[patch-datetimepicker] ❌ ${label}: could not find @end`);
        process.exit(1);
    }

    src = src.slice(0, lastEnd) + PATCH_CODE + '\n' + src.slice(lastEnd);
    fs.writeFileSync(fullPath, src);
    console.log(`[patch-datetimepicker] ✅ ${label}: patched successfully`);
}

patchFile('ios/RNDateTimePicker.m', 'RNDateTimePicker.m');
patchFile(
    'ios/fabric/RNDateTimePickerComponentView.mm',
    'RNDateTimePickerComponentView.mm (Fabric)'
);

console.log('[patch-datetimepicker] 🎉 All patches applied — keyboard input disabled on spinners');
console.log('');
