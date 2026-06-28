// ── Care type icon helper — shared across Discover and Schedule ─────────────
export function getCareTypeIcon(careType?: string): string {
  switch (careType) {
    case 'overnight':  return '🌙';
    case 'daySitting': return '☀️';
    case 'feeding':    return '🍽️';
    case 'dogWalking': return '🦮';
    default:           return '🐾';
  }
}

