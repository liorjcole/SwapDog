export enum EnergyLevel {
  low = 'low',
  moderate = 'moderate',
  high = 'high',
  very_high = 'very_high',
}

export enum DogSex {
  male = 'male',
  female = 'female',
}

// Legacy enum kept for old data compatibility — new posts use string literals
export enum SwapStatus {
  pending = 'pending',
  accepted = 'accepted',
  declined = 'declined',
  cancelled = 'cancelled',
  completed = 'completed',
}

export type AccountStatus =
  | 'pending_referral'
  | 'pending_vetting'
  | 'pending_approval'
  | 'active'
  | 'suspended'
  | 'rejected'
  | 'terminated';

export interface GeoPoint {
  latitude: number;
  longitude: number;
}

export interface User {
  id: string;
  email: string;
  displayName: string;
  photoURL?: string;
  bio?: string;
  instagramHandle?: string;
  subscriptionStatus?: 'active' | 'expired' | 'cancelled';
  subscriptionPlan?: 'monthly';
  subscribedAt?: unknown;
  freeAccessUntil?: Date;   // Promo code grants paywall bypass until this date
  location?: GeoPoint;
  locationName?: string;
  pushToken?: string;
  pushTokens?: string[];
  isOnboarded: boolean;
  createdAt: Date;
  updatedAt: Date;
  rating?: number;
  reviewCount?: number;
  // Referral & account lifecycle fields
  referredBy?: string;        // userId of the referrer
  referralCode: string;       // unique code this user can share
  points: number;             // starts at 0
  accountStatus: AccountStatus;
  conductAgreedAt?: Date;
  contractSignedAt?: Date;
  vettingScheduledAt?: Date;
  isAdmin?: boolean;
  /** Post IDs the user permanently hid from the Create Post "Reuse a past request" list. */
  hiddenReusePostIds?: string[];
  /** User-saved Create-Post templates (opt-in saved reusable post details). */
  postTemplates?: PostTemplate[];
  /** Set by the onPostCompleted Cloud Function after a swap completes; cleared after the user submits or skips the review. */
  pendingReview?: PendingReview;
}

export interface ReferralCode {
  code: string;
  createdBy: string;         // userId
  isActive: boolean;
  usedBy?: string[];         // userIds
  maxUses: number;
  usedCount: number;
  createdAt: Date;
}

export interface Dog {
  id: string;
  ownerId: string;
  name: string;
  breed: string;
  /** Age in whole years (0 means puppy under 1 year) */
  ageYears: number;
  /** Additional months (0-11). For puppies (ageYears=0) this is the primary age. */
  ageMonths: number;
  weightLbs: number;
  sex: DogSex;
  energyLevel: EnergyLevel;
  /** Up to 10 photo URLs. First photo is the primary/thumbnail. */
  photoURLs: string[];
  bio?: string;
  isGoodWithDogs?: boolean;
  isGoodWithKids?: boolean;
  isSpayedNeutered?: boolean;
  vaccinated?: boolean;
  temperament?: string;
  /** Aggregate rating (1 decimal) written by recomputeDogAggregate CF */
  rating?: number;
  /** Number of dog reviews, written by recomputeDogAggregate CF */
  reviewCount?: number;
  createdAt: Date;
  updatedAt: Date;
}

export type CareType = 'overnight' | 'daySitting' | 'feeding' | 'dogWalking' | 'playtime' | 'medication';

export type PaymentType = 'points' | 'payment' | 'either';
export type SitterPreference = 'points' | 'payment';

// ─────────────────────────────────────────────────────────────────────────────
// NEW: Public post model — replaces targeted SwapRequest
// ─────────────────────────────────────────────────────────────────────────────

export type PostStatus = 'open' | 'claimed' | 'completed' | 'cancelled';
export type PaymentRate = 'per_hour' | 'per_day';
export type CompensationType = 'points' | 'payment' | 'either';

// ── Repeat scheduling for overnight add-on tasks ──────────────────────────────
export interface RepeatSchedule {
  /** 'daily' = every day, 'weekly' = one day per week, 'custom' = specific days */
  type: 'daily' | 'weekly' | 'custom' | 'specificDates';
  /** Day index for weekly (0=Sun, 1=Mon ... 6=Sat) */
  weeklyDay?: number;
  /** Day indices for custom (sorted, 0-6) */
  customDays?: number[];
  /** Whether all selected days share the same time or have individual times */
  timeMode?: 'same' | 'different';
  /** Per-day times as "h:mm AM/PM" strings, keyed by day index (0-6). Only set when timeMode='different'. */
  dayTimes?: Record<number, string>;
  /** ISO date strings ('YYYY-MM-DD') for specificDates type */
  specificDates?: string[];
}

export const DAY_LABELS = ['Sun', 'Mon', 'Tues', 'Wed', 'Thurs', 'Fri', 'Sat'] as const;

/** Human-readable label for a repeat schedule */
export const formatRepeatLabel = (schedule: RepeatSchedule): string => {
  if (schedule.type === 'daily') return 'Repeat daily';
  if (schedule.type === 'weekly') {
    return 'Repeat weekly';
  }
  if (schedule.type === 'custom') {
    return 'Repeat';
  }
  if (schedule.type === 'specificDates') {
    return 'Specific dates';
  }
  return 'Repeat';
};

/** Second line for repeat label — day names in parentheses */
export const formatRepeatSubLabel = (schedule: RepeatSchedule): string | null => {
  if (schedule.type === 'daily') return null;
  if (schedule.type === 'weekly') {
    return '(on ' + DAY_LABELS[schedule.weeklyDay ?? 1] + ')';
  }
  if (schedule.type === 'custom') {
    const dayNames = (schedule.customDays ?? []).map(d => DAY_LABELS[d]);
    if (dayNames.length > 4) {
      const line1 = dayNames.slice(0, 4).join('/');
      const line2 = dayNames.slice(4).join('/');
      return '(on ' + line1 + '/\n' + line2 + ')';
    }
    return '(on ' + dayNames.join('/') + ')';
  }
  if (schedule.type === 'specificDates') {
    return null; // no sub-label — just show "Specific dates"
  }
  return null;
};

export interface SwapPost {
  id: string;

  // Poster info (denormalised for feed performance)
  posterId: string;
  posterName: string;
  posterPhotoURL?: string;
  posterLocation?: GeoPoint;
  /** Full location label at post-creation time, e.g. "Montreal, Quebec, Canada". Optional; legacy posts won't have it. */
  posterLocationName?: string;

  // Dog info (denormalised for feed performance)
  // ── Single-dog fields (legacy / backward compat) ──
  dogId: string;
  dogName: string;
  dogBreed?: string;
  dogPhotoURL?: string;

  // ── Multi-dog fields (new) — populated alongside single-dog fields ──
  /** All selected dog IDs. dogId == dogIds[0] for backward compat. */
  dogIds?: string[];
  /** All selected dog names. dogName == dogNames[0] for backward compat. */
  dogNames?: string[];
  /** All selected dog breeds. */
  dogBreeds?: string[];
  /** All selected dog photo URLs. */
  dogPhotoURLs?: string[];

  // Coverage
  startDate: Date;
  endDate: Date;
  /** Free-text description of what the sitter needs to know */
  careDetails: string;
  /** Photos attached to care details (Firebase Storage URLs) */
  carePhotos?: string[];

  // Compensation
  compensationType: CompensationType;
  /** Auto-calculated: 1 day = 1 point, same day = 0.5 */
  pointsCost: number;
  /** Dollar amount per unit (per_hour or per_day). Only set when compensationType !== 'points' */
  paymentAmount?: number;
  paymentRate?: PaymentRate;
  /** Total calculated compensation = paymentAmount × totalUnits */
  totalPayment?: number;
  /** Number of hours or days used for calculation */
  totalUnits?: number;


  // Care type system (Wave 19B)
  careType?: CareType;
  /** Points amount set by the poster (new: replaces auto-calculated) */
  pointsOffered?: number;
  /** Walk duration in minutes (dogWalking care type) */
  walkDurationMinutes?: number;
  /** Feeding time string e.g. "8:00 AM" (feeding care type) */
  feedingTime?: string;
  /** Start time string e.g. "9:00 AM" (daySitting care type) */
  startTime?: string;
  /** End time string e.g. "5:00 PM" (daySitting care type) */
  endTime?: string;

  /** Add-on care types selected (e.g. ['feeding', 'dogWalking', 'playtime']) */
  addOnCareTypes?: string[];
  /** Address for care (owner's home or pickup address). Written by createPost; used for reuse prefill. */
  careAddress?: string;
  /** Stay-location preference (overnight/daySitting). Written by createPost; used for reuse prefill. */
  overnightLocation?: 'my_home' | 'sitters_home' | 'no_preference' | null;
  /** Sitter transport choice; only meaningful when overnightLocation === 'sitters_home'. */
  sitterTransport?: 'pickup' | 'dropoff';
  /** Walk sessions with times, settings, instructions, photos, and dog assignments */
  walkSessions?: { flexible?: boolean; startTime?: string | null; endTime?: string | null; durationMins?: number; dogIds: string[]; repeatSchedule?: RepeatSchedule | null; instructions?: string; photos?: string[] }[];
  /** Walk total duration in minutes (sum of all sessions) */
  walkDurationMins?: number;
  /** Feeding slots with times, instructions, photos, and dog assignments */
  feedingSlots?: { time: string; repeatSchedule?: RepeatSchedule | null; dogIds: string[]; instructions?: string; photos?: string[] }[];
  /** Play sessions with times, settings, instructions, photos, and dog assignments */
  playSessions?: { sessionNumber?: number; flexible?: boolean; startTime?: string | null; endTime?: string | null; durationMins?: number; dogIds: string[]; repeatSchedule?: RepeatSchedule | null; instructions?: string; photos?: string[] }[];
  /** Medication slots with time, extra times, details, photos, and dog assignments */
  medicationSlots?: { time: string; extraTimes?: string[]; details: string; repeatSchedule?: RepeatSchedule | null; dogIds: string[]; photos?: string[] }[];

  // Status
  status: PostStatus;
  /** userId of the sitter who claimed the post */
  claimedBy?: string;

  // ── Reschedule proposal fields ──
  /** Proposed new start date (original startDate stays unchanged until accepted) */
  rescheduleProposedStart?: Date;
  /** Proposed new end date */
  rescheduleProposedEnd?: Date;
  /** Optional note from the proposer */
  rescheduleNote?: string;
  /** userId of who proposed the reschedule */
  rescheduleProposedBy?: string;

  /** Notification IDs for scheduled swap reminders (owner-side). Used for cancellation. */
  reminderNotificationIds?: string[];

  /** Notification IDs for scheduled sitter-side reminders. Stored in Firestore so sitter device can skip re-scheduling. */
  sitterReminderNotificationIds?: string[];

  /** Users who responded 'I Can Help' to this post */
  respondedBy?: Array<{
    userId: string;
    userName: string;
    userPhotoURL?: string;
    respondedAt: Date;
    /** Counter-offer points proposed by the sitter (Wave 19B) */
    counterPoints?: number;
    /** Status of the counter offer (Wave 19B) */
    counterStatus?: 'pending' | 'accepted' | 'declined';
  }>;

  createdAt: Date;
  updatedAt: Date;
}

/**
 * A user-saved, reusable Create-Post template. Stored on users/{uid}.postTemplates.
 * Carries every reusable detail field (the SAME set reuse-prefill consumes),
 * but deliberately EXCLUDES the overall stay window (startDate/endDate/startTime/endTime).
 */
export interface PostTemplate {
  /** Stable id, generated client-side (e.g. `${Date.now()}-${random}`). */
  id: string;
  /** Epoch ms when first saved. */
  createdAt: number;

  // ── Identity / display (denormalized so the reuse row needs no lookups) ──
  dogIds: string[];
  dogNames?: string[];
  careType?: CareType;
  addOnCareTypes?: string[];

  // ── Stay-location preference ──
  overnightLocation?: 'my_home' | 'sitters_home' | 'no_preference' | null;
  sitterTransport?: 'pickup' | 'dropoff';
  careAddress?: string;

  // ── Free text ──
  careDetails?: string;

  // ── Per-service slots — SAME element shapes as SwapPost ──
  feedingSlots?: SwapPost['feedingSlots'];
  walkSessions?: SwapPost['walkSessions'];
  playSessions?: SwapPost['playSessions'];
  medicationSlots?: SwapPost['medicationSlots'];

  // ── Photos — remote Storage URLs only ──
  carePhotos?: string[];

  // ── Compensation ──
  compensationType?: CompensationType;
  /** prefill reads pointsOffered ?? pointsCost */
  pointsOffered?: number;
  pointsCost?: number;
  paymentAmount?: number;

  // EXCLUDED on purpose: startDate, endDate, startTime, endTime (overall window).
}

// ─────────────────────────────────────────────────────────────────────────────
// Legacy SwapRequest — kept for backward compat with existing Firestore records
// ─────────────────────────────────────────────────────────────────────────────
export interface SwapRequest {
  id: string;
  requesterId: string;
  receiverId: string;
  requesterDogIds: string[];
  receiverDogIds: string[];
  startDate: Date;
  endDate: Date;
  message?: string;
  /** Structured care details describing schedule, feeding, meds, etc. */
  careDetails?: string;
  status: SwapStatus;
  conversationId?: string;
  /** Auto-calculated: 1 full day = 1 point, same day = 0.5 points */
  pointsCost: number;
  /** Optional dollar amount if owner is also willing to pay */
  paymentOffered?: number;
  /** What the owner is offering: points only, payment only, or either */
  paymentType: PaymentType;
  /** What the sitter chose when accepting (if paymentType === 'either') */
  sitterPreference?: SitterPreference;
  createdAt: Date;
  updatedAt: Date;
}

export interface Conversation {
  id: string;
  participantIds: string[];
  swapRequestId?: string;
  lastMessage?: string;
  lastMessageAt?: Date;
  unreadCounts: Record<string, number>;
  createdAt: Date;
  updatedAt: Date;
}

export interface Message {
  id: string;
  conversationId: string;
  senderId: string;
  text: string;
  createdAt: Date;
  read: boolean;
  /** Optional message type for special messages (e.g. reschedule proposals) */
  type?: 'text' | 'reschedule' | 'image' | 'help_request';
  /** Optional image URL for photo messages */
  imageURL?: string;
  /** Optional metadata for typed messages */
  metadata?: {
    postId?: string;
    proposedStart?: string;  // ISO string
    proposedEnd?: string;    // ISO string
    helperId?: string;
  };
}

export type ReviewTargetType = 'owner' | 'caregiver' | 'dog';

export interface Review {
  id: string;
  /** The post this review is for */
  postId: string;
  /** Who wrote the review */
  reviewerId: string;
  reviewerName: string;
  /** The user whose profile this review appears on */
  revieweeId: string;
  /** What is being reviewed */
  targetType: ReviewTargetType;
  /** If targetType === 'dog', which dog */
  dogId?: string;
  dogName?: string;
  /** 1–5 star rating */
  rating: number;
  /** Optional written note */
  note?: string;
  createdAt: Date;

  // Legacy compat
  swapRequestId?: string;
  comment?: string;
  reviewRole?: 'owner' | 'sitter';
}

/** Pending review flag stored on the user doc */
export interface PendingReview {
  postId: string;
  /** 'owner' = you posted it, review the caregiver + nothing else
   *  'caregiver' = you sat, review each dog then the owner */
  role: 'owner' | 'caregiver';
  otherUserId: string;
  otherUserName: string;
  dogIds: string[];
  dogNames: string[];
  createdAt: Date;
}
