export function getFriendlyAuthError(error: unknown): { title: string; message: string } {
  const code = (error as { code?: string })?.code ?? '';
  switch (code) {
    case 'auth/email-already-in-use':
    case 'functions/already-exists':
      return {
        title: 'Phone Number Already Registered',
        message: 'This phone number is already in use. Try signing in instead!',
      };
    case 'auth/invalid-phone-number':
    case 'functions/invalid-argument':
      return {
        title: 'Invalid Phone Number',
        message: code === 'functions/invalid-argument'
          ? 'Please check the phone number or verification code and try again.'
          : 'Please enter a valid phone number.',
      };
    case 'auth/invalid-email':
      return {
        title: 'Invalid Phone Number',
        message: 'Please enter a valid phone number.',
      };
    case 'auth/weak-password':
      return {
        title: 'Weak Password',
        message: 'Password is too weak. Please use at least 6 characters.',
      };
    case 'auth/wrong-password':
    case 'auth/invalid-credential':
    case 'functions/permission-denied':
      return {
        title: 'Invalid Code',
        message: 'The verification code is incorrect or expired. Please try again.',
      };
    case 'auth/user-not-found':
    case 'functions/not-found':
      return {
        title: 'Account Not Found',
        message: 'No account found with this phone number. Try signing up!',
      };
    case 'auth/too-many-requests':
    case 'functions/resource-exhausted':
      return {
        title: 'Too Many Attempts',
        message: 'Too many attempts. Please wait a moment and try again.',
      };
    case 'auth/network-request-failed':
      return {
        title: 'Network Error',
        message: 'Please check your internet connection and try again.',
      };
    case 'auth/user-disabled':
      return {
        title: 'Account Disabled',
        message: 'This account has been disabled. Please contact support.',
      };
    default:
      return {
        title: 'Oops!',
        message: 'Something went wrong. Please try again.',
      };
  }
}
