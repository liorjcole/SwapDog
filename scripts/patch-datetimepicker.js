/**
 * Postinstall script to disable keyboard input on iOS DateTimePicker spinners.
 *
 * iOS 15+ lets users tap the selected spinner row to type via keyboard.
 * Previous approaches (Keyboard.dismiss, endEditing, disabling UITextFields)
 * all failed because UIDatePicker re-triggers keyboard after dismiss.
 *
 * THIS approach: override hitTest:withEvent: to intercept taps that would
 * land on the internal UITextField. Instead of letting the tap reach the
 * text field (which triggers keyboard), we redirect it to the picker itself
 * (which does nothing). Scroll gestures are unaffected because they use
 * UIPanGestureRecognizer on the UIPickerView, not on the UITextField.
 */
const fs = require('fs');
const path = require('path');

const MARKER = '// SWAPDOG_KEYBOARD_PATCH';

// The native code to inject — hitTest override that blocks UITextField taps
const PICKER_PATCH = `
${MARKER}
// Prevent keyboard input on iOS 15+ spinner by intercepting taps on internal UITextFields.
// When the user taps the selected row, iOS creates a UITextField and the tap would
// make it first responder (opening the keyboard). We override hitTest:withEvent: to
// redirect those taps to the picker itself, so the keyboard never opens.
// Scroll gestures (UIPanGestureRecognizer) are unaffected — they're attached to
// the UIPickerView, not the UITextField.

- (UIView *)hitTest:(CGPoint)point withEvent:(UIEvent *)event {
    UIView *hit = [super hitTest:point withEvent:event];
    if (!hit) return hit;

    // If the hit target is a UITextField or is inside one, redirect to self
    UIView *check = hit;
    while (check && check != self) {
        if ([check isKindOfClass:[UITextField class]]) {
            return self;
        }
        check = check.superview;
    }
    return hit;
}
`;

// Fabric component view patch — same approach but on the contentView
const FABRIC_PATCH = `
${MARKER}
// Prevent keyboard input on iOS 15+ spinner in Fabric/New Architecture.
// The picker is self.contentView — we add a tap gesture that swallows taps
// and use keyboard notifications as a safety net.

- (void)didMoveToWindow {
    [super didMoveToWindow];
    if (self.window) {
        // Remove any existing SWAPDOG tap recognizers to avoid duplicates
        for (UIGestureRecognizer *gr in self.contentView.gestureRecognizers.copy) {
            if (gr.name && [gr.name isEqualToString:@"SWAPDOG_BLOCK_TAP"]) {
                [self.contentView removeGestureRecognizer:gr];
            }
        }
        // Add tap recognizer that swallows taps on the picker
        UITapGestureRecognizer *tap = [[UITapGestureRecognizer alloc]
            initWithTarget:self action:@selector(swapdog_handleTap:)];
        tap.cancelsTouchesInView = YES;
        tap.name = @"SWAPDOG_BLOCK_TAP";
        [self.contentView addGestureRecognizer:tap];

        // Safety net: keyboard notification listener
        [[NSNotificationCenter defaultCenter] addObserver:self
                                                 selector:@selector(swapdog_keyboardWillShow:)
                                                     name:UIKeyboardWillShowNotification
                                                   object:nil];
    } else {
        [[NSNotificationCenter defaultCenter] removeObserver:self
                                                        name:UIKeyboardWillShowNotification
                                                      object:nil];
    }
}

- (void)swapdog_handleTap:(UITapGestureRecognizer *)sender {
    // Swallow the tap — do nothing. Scroll gestures (pan) pass through.
}

- (void)swapdog_keyboardWillShow:(NSNotification *)notification {
    if (!self.window) return;
    // Nuclear: end editing on ALL windows
    for (UIWindow *window in [UIApplication sharedApplication].windows) {
        [window endEditing:YES];
    }
}

- (void)dealloc {
    [[NSNotificationCenter defaultCenter] removeObserver:self];
}
`;

function patchFile(filePath, patchCode, label) {
    if (!fs.existsSync(filePath)) {
        console.log('[patch-datetimepicker] ⚠️  ' + label + ': file not found, skipping');
        return;
    }

    let content = fs.readFileSync(filePath, 'utf8');

    // Already patched?
    if (content.includes(MARKER)) {
        console.log('[patch-datetimepicker] ✅ ' + label + ': already patched');
        return;
    }

    // Find the LAST @end in the file (closes @implementation)
    const lastEndIdx = content.lastIndexOf('@end');
    if (lastEndIdx === -1) {
        console.log('[patch-datetimepicker] ❌ ' + label + ': could not find @end');
        process.exit(1);
    }

    // Insert patch code right before the final @end
    content = content.slice(0, lastEndIdx) + patchCode + '\n' + content.slice(lastEndIdx);

    fs.writeFileSync(filePath, content);
    console.log('[patch-datetimepicker] ✅ ' + label + ': patched successfully');
}

console.log('');
console.log('╔══════════════════════════════════════════════════════════╗');
console.log('║  SWAPDOG: Patching DateTimePicker to disable keyboard   ║');
console.log('╚══════════════════════════════════════════════════════════╝');

const basePath = path.join(__dirname, '..', 'node_modules', '@react-native-community', 'datetimepicker', 'ios');

patchFile(
    path.join(basePath, 'RNDateTimePicker.m'),
    PICKER_PATCH,
    'RNDateTimePicker.m'
);

patchFile(
    path.join(basePath, 'fabric', 'RNDateTimePickerComponentView.mm'),
    FABRIC_PATCH,
    'RNDateTimePickerComponentView.mm (Fabric)'
);

console.log('[patch-datetimepicker] 🎉 All patches applied — keyboard input disabled on spinners');
console.log('');
