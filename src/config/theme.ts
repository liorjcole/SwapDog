// ── SPLASH SCREEN COLOR ──────────────────────────────────────────────────────
// The vibrant hot pink-red from the splash screen.  All primary/accent colors
// throughout the app must reference this constant or colors.primary / darkColors.primary.
export const SPLASH_COLOR = '#FF2D55';

export const colors = {
  primary: SPLASH_COLOR,
  secondary: '#4ECDC4',
  background: '#FFFFFF',
  surface: '#FFFFFF',
  // One step above surface — used for elevated card cells (e.g. tappable list rows).
  backgroundElevated: '#EBEBEB',
  text: '#2D3436',
  textSecondary: '#636E72',
  error: '#E17055',
  success: '#00B894',
  warning: '#FDCB6E',
  border: '#E8E8E8',
};

export const darkColors = {
  primary: SPLASH_COLOR,
  secondary: '#4ECDC4',
  background: '#1A1A1A',
  surface: '#2C2C2C',
  // One step above surface — used for elevated card cells (e.g. tappable list rows).
  backgroundElevated: '#383838',
  text: '#FAFAFA',
  textSecondary: '#ABABAB',
  error: '#E17055',
  success: '#00B894',
  warning: '#FDCB6E',
  border: '#3A3A3A',
};

export const spacing = {
  xs: 4,
  sm: 8,
  md: 16,
  lg: 24,
  xl: 32,
};

export const borderRadius = {
  sm: 8,
  md: 12,
  lg: 16,
  full: 9999,
};

export const typography = {
  h1: { fontSize: 34, fontWeight: '700' as const },
  h2: { fontSize: 26, fontWeight: '700' as const },
  h3: { fontSize: 22, fontWeight: '600' as const },
  body: { fontSize: 18, fontWeight: '400' as const },
  bodySmall: { fontSize: 16, fontWeight: '400' as const },
  caption: { fontSize: 14, fontWeight: '400' as const },
  button: { fontSize: 18, fontWeight: '600' as const },
};

export const shadow = {
  sm: {
    shadowColor: SPLASH_COLOR,
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.06,
    shadowRadius: 2,
    elevation: 2,
  },
  md: {
    shadowColor: SPLASH_COLOR,
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.10,
    shadowRadius: 4,
    elevation: 4,
  },
  lg: {
    shadowColor: SPLASH_COLOR,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.14,
    shadowRadius: 8,
    elevation: 8,
  },
};

export const theme = {
  colors,
  darkColors,
  spacing,
  borderRadius,
  typography,
  shadow,
};

export default theme;
