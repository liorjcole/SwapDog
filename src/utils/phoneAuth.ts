const makeAuthError = (code: string, message: string): Error & { code: string } =>
  Object.assign(new Error(message), { code });

export const normalizePhoneNumber = (raw: string): string => {
  const value = raw.trim();
  const digits = value.replace(/\D/g, '');

  if (!digits) {
    throw makeAuthError('auth/invalid-phone-number', 'Please enter your phone number.');
  }

  let e164: string;
  if (value.startsWith('+')) {
    e164 = `+${digits}`;
  } else if (digits.length === 10) {
    e164 = `+1${digits}`;
  } else if (digits.length === 11 && digits.startsWith('1')) {
    e164 = `+${digits}`;
  } else {
    throw makeAuthError('auth/invalid-phone-number', 'Use a valid phone number, including country code if outside the US.');
  }

  const normalizedDigits = e164.slice(1);
  if (normalizedDigits.length < 8 || normalizedDigits.length > 15) {
    throw makeAuthError('auth/invalid-phone-number', 'Use a valid phone number.');
  }

  return e164;
};
