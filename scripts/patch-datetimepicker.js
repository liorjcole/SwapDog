/**
 * Postinstall script to disable keyboard input on iOS DateTimePicker spinners.
 * 
 * iOS 15+ allows tapping the selected spinner row to open a numeric keyboard.
 * This patches the native Objective-C code to prevent that behavior.
 * 
 * Much more reliable than patch-package because it doesn't depend on
 * exact diff context matching — it reads the file and injects code
 * before the final @end in the @implementation block.
 */
const fs = require('fs');
const path = require('path');

const filePath = path.join(
  __dirname, '..', 'node_modules',
  '@react-native-community', 'datetimepicker',
  'ios', 'RNDateTimePicker.m'
);

const MARKER = '// SWAPDOG_KEYBOARD_PATCH';

const PATCH_CODE = `
${MARKER}
#pragma mark - Keyboard Input Prevention (iOS 15+)

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
                                                 selector:@selector(handleKeyboardWillShow:)
                                                     name:UIKeyboardWillShowNotification
                                                   object:nil];
        [[NSNotificationCenter defaultCenter] addObserver:self
                                                 selector:@selector(handleKeyboardDidShow:)
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

- (void)handleKeyboardWillShow:(NSNotification *)notification {
    if (!self.window) return;
    [self endEditing:YES];
    [self disableTextFieldsInView:self];
}

- (void)handleKeyboardDidShow:(NSNotification *)notification {
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

try {
  if (!fs.existsSync(filePath)) {
    console.log('[patch-datetimepicker] File not found, skipping:', filePath);
    process.exit(0);
  }

  let content = fs.readFileSync(filePath, 'utf8');

  // Already patched?
  if (content.includes(MARKER)) {
    console.log('[patch-datetimepicker] ✅ Already patched');
    process.exit(0);
  }

  // Find the LAST @end in the file (end of @implementation block)
  const lastEndIdx = content.lastIndexOf('@end');
  if (lastEndIdx === -1) {
    console.error('[patch-datetimepicker] ❌ Could not find @end in file');
    process.exit(1);
  }

  // Insert patch code before the final @end
  content = content.slice(0, lastEndIdx) + PATCH_CODE + '\n' + content.slice(lastEndIdx);

  fs.writeFileSync(filePath, content, 'utf8');
  console.log('[patch-datetimepicker] ✅ Patched successfully — keyboard input disabled on iOS spinners');
} catch (err) {
  console.error('[patch-datetimepicker] ❌ Error:', err.message);
  process.exit(1);
}
