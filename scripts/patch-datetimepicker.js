/**
 * Postinstall script to disable keyboard input on iOS DateTimePicker spinners.
 * 
 * iOS 15+ allows tapping the selected spinner row to open a numeric keyboard.
 * This patches the native Objective-C code to prevent that behavior.
 * 
 * Patches TWO files for full coverage:
 * 1. RNDateTimePicker.m — the UIDatePicker subclass (layoutSubviews + keyboard notifications)
 * 2. RNDateTimePickerComponentView.mm — the Fabric/New Architecture component view
 */
const fs = require('fs');
const path = require('path');

const MARKER = 'SWAPDOG_KEYBOARD_PATCH';

const basePath = path.join(
  __dirname, '..', 'node_modules',
  '@react-native-community', 'datetimepicker', 'ios'
);

// ─── Patch 1: RNDateTimePicker.m ───
const pickerPath = path.join(basePath, 'RNDateTimePicker.m');

const pickerPatch = `
#pragma mark - ${MARKER}
// Prevent iOS 15+ keyboard input on date picker spinner wheels.
// Three strategies: layoutSubviews scan, keyboard notifications, dealloc cleanup.

- (void)disableTextFieldsInView:(UIView *)view {
    for (UIView *subview in view.subviews) {
        if ([subview isKindOfClass:[UITextField class]]) {
            ((UITextField *)subview).userInteractionEnabled = NO;
            ((UITextField *)subview).enabled = NO;
            if ([subview isFirstResponder]) {
                [subview resignFirstResponder];
            }
        }
        [self disableTextFieldsInView:subview];
    }
}

- (void)layoutSubviews {
    [super layoutSubviews];
    [self disableTextFieldsInView:self];
}

- (void)didMoveToWindow {
    [super didMoveToWindow];
    if (self.window) {
        [[NSNotificationCenter defaultCenter] addObserver:self
                                                 selector:@selector(swapdog_handleKeyboardWillShow:)
                                                     name:UIKeyboardWillShowNotification
                                                   object:nil];
        [[NSNotificationCenter defaultCenter] addObserver:self
                                                 selector:@selector(swapdog_handleKeyboardDidShow:)
                                                     name:UIKeyboardDidShowNotification
                                                   object:nil];
    } else {
        [[NSNotificationCenter defaultCenter] removeObserver:self
                                                        name:UIKeyboardWillShowNotification
                                                      object:nil];
        [[NSNotificationCenter defaultCenter] removeObserver:self
                                                        name:UIKeyboardDidShowNotification
                                                      object:nil];
    }
}

- (void)swapdog_handleKeyboardWillShow:(NSNotification *)notification {
    if (!self.window) return;
    [self endEditing:YES];
    [self disableTextFieldsInView:self];
}

- (void)swapdog_handleKeyboardDidShow:(NSNotification *)notification {
    if (!self.window) return;
    [self endEditing:YES];
    [self disableTextFieldsInView:self];
    dispatch_after(dispatch_time(DISPATCH_TIME_NOW, (int64_t)(0.05 * NSEC_PER_SEC)), dispatch_get_main_queue(), ^{
        [self endEditing:YES];
        [self disableTextFieldsInView:self];
    });
}

- (void)dealloc {
    [[NSNotificationCenter defaultCenter] removeObserver:self];
}
`;

function patchFile(filePath, patchCode, label) {
  if (!fs.existsSync(filePath)) {
    console.log(`[patch-datetimepicker] ⚠️  ${label}: file not found at ${filePath}`);
    return false;
  }

  let content = fs.readFileSync(filePath, 'utf8');

  if (content.includes(MARKER)) {
    console.log(`[patch-datetimepicker] ✅ ${label}: already patched`);
    return true;
  }

  // Find the LAST @end in the file (end of @implementation)
  const lastEndIdx = content.lastIndexOf('@end');
  if (lastEndIdx === -1) {
    console.log(`[patch-datetimepicker] ❌ ${label}: could not find @end`);
    return false;
  }

  content = content.slice(0, lastEndIdx) + patchCode + '\n@end\n';
  fs.writeFileSync(filePath, content, 'utf8');
  console.log(`[patch-datetimepicker] ✅ ${label}: patched successfully`);
  return true;
}

// ─── Patch 2: RNDateTimePickerComponentView.mm (Fabric / New Architecture) ───
const fabricPath = path.join(basePath, 'fabric', 'RNDateTimePickerComponentView.mm');

const fabricPatch = `
#pragma mark - ${MARKER}
// Prevent iOS 15+ keyboard input — Fabric component view level.
// Catches keyboard show events and force-dismisses them on the picker.

- (void)didMoveToWindow {
    [super didMoveToWindow];
    if (self.window) {
        [[NSNotificationCenter defaultCenter] addObserver:self
                                                 selector:@selector(swapdog_fabricKeyboardWillShow:)
                                                     name:UIKeyboardWillShowNotification
                                                   object:nil];
        [[NSNotificationCenter defaultCenter] addObserver:self
                                                 selector:@selector(swapdog_fabricKeyboardDidShow:)
                                                     name:UIKeyboardDidShowNotification
                                                   object:nil];
    } else {
        [[NSNotificationCenter defaultCenter] removeObserver:self
                                                        name:UIKeyboardWillShowNotification
                                                      object:nil];
        [[NSNotificationCenter defaultCenter] removeObserver:self
                                                        name:UIKeyboardDidShowNotification
                                                      object:nil];
    }
}

- (void)swapdog_fabricKeyboardWillShow:(NSNotification *)notification {
    if (!self.window) return;
    [self endEditing:YES];
    [self.contentView endEditing:YES];
}

- (void)swapdog_fabricKeyboardDidShow:(NSNotification *)notification {
    if (!self.window) return;
    [self endEditing:YES];
    [self.contentView endEditing:YES];
    dispatch_after(dispatch_time(DISPATCH_TIME_NOW, (int64_t)(0.05 * NSEC_PER_SEC)), dispatch_get_main_queue(), ^{
        [self endEditing:YES];
        [self.contentView endEditing:YES];
    });
}

- (void)dealloc {
    [[NSNotificationCenter defaultCenter] removeObserver:self];
}
`;

console.log('');
console.log('╔══════════════════════════════════════════════════════════╗');
console.log('║  SWAPDOG: Patching DateTimePicker to disable keyboard   ║');
console.log('╚══════════════════════════════════════════════════════════╝');

const r1 = patchFile(pickerPath, pickerPatch, 'RNDateTimePicker.m');
const r2 = patchFile(fabricPath, fabricPatch, 'RNDateTimePickerComponentView.mm (Fabric)');

if (r1 && r2) {
  console.log('[patch-datetimepicker] 🎉 All patches applied — keyboard input disabled on spinners');
} else {
  console.log('[patch-datetimepicker] ⚠️  Some patches could not be applied — check output above');
}
console.log('');
