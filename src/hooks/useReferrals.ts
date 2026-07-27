import { ReferralCode } from '../models/types';
import {
  ensureReferralCodeSecure,
  getReferralCountSecure,
  redeemReferralCodeSecure,
  validateReferralCodeSecure,
} from '../services/secureOperations';

/** The public promo label is harmless; eligibility and redemption stay server-side. */
export const PROMO_CODES = new Set(['WATCHDOGFREE']);

export const isPromoCode = (code: string): boolean =>
  PROMO_CODES.has(code.trim().toUpperCase());

export const validateReferralCode = async (
  code: string,
): Promise<ReferralCode | null> => {
  try {
    const result = await validateReferralCodeSecure(code);
    if (!result.valid || !result.createdBy) return null;
    return {
      code: result.code,
      createdBy: result.createdBy,
      isActive: true,
      usedBy: [],
      maxUses: 1,
      usedCount: 0,
      createdAt: new Date(),
    };
  } catch {
    return null;
  }
};

export const redeemReferralCode = async (
  code: string,
  _userId: string,
): Promise<void> => {
  await redeemReferralCodeSecure(code);
};

export const generateReferralCode = async (_userId: string): Promise<string> => {
  const result = await ensureReferralCodeSecure();
  return result.code;
};

export const ensureReferralCode = generateReferralCode;

export const getReferralCount = async (_userId: string): Promise<number> => {
  try {
    const result = await getReferralCountSecure();
    return result.count;
  } catch {
    return 0;
  }
};
