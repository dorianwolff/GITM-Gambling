/**
 * validation.js
 * Pure-function input validators. Server re-validates everything anyway.
 */
import { LIMITS } from '../config/constants.js';

export function isEmail(s) {
  return typeof s === 'string' && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s);
}

export function isAllowedDomain(email, allowed) {
  if (!isEmail(email)) return false;
  const dom = email.toLowerCase().split('@')[1];
  return allowed.some((d) => dom === d || dom.endsWith('.' + d));
}

export function validateBet(amount, balance) {
  const n = Number(amount);
  if (!Number.isFinite(n) || !Number.isInteger(n)) return 'Bet must be a whole number';
  if (n < LIMITS.MIN_BET) return `Minimum bet is ${LIMITS.MIN_BET}`;
  if (n > LIMITS.MAX_BET) return `Maximum bet is ${LIMITS.MAX_BET}`;
  if (balance != null && n > balance) return 'Not enough credits';
  return null;
}

export function validateEventDraft(draft) {
  const errs = {};
  const title = String(draft.title || '').trim();
  if (title.length < LIMITS.EVENT_TITLE_MIN) errs.title = 'Title too short';
  else if (title.length > LIMITS.EVENT_TITLE_MAX) errs.title = 'Title too long';

  const desc = String(draft.description || '').trim();
  if (desc.length > LIMITS.EVENT_DESC_MAX) errs.description = 'Description too long';

  const opts = (draft.options || []).map((o) => String(o).trim()).filter(Boolean);
  if (opts.length < LIMITS.EVENT_OPTIONS_MIN) errs.options = 'Need at least 2 options';
  else if (opts.length > LIMITS.EVENT_OPTIONS_MAX) errs.options = 'Too many options';
  else if (new Set(opts).size !== opts.length) errs.options = 'Options must be unique';

  if (draft.closesAt) {
    const t = new Date(draft.closesAt).getTime();
    if (Number.isNaN(t)) errs.closesAt = 'Invalid close date';
    else if (t < Date.now() + 60_000) errs.closesAt = 'Close date must be in the future';
  } else {
    errs.closesAt = 'Close date required';
  }

  return { ok: Object.keys(errs).length === 0, errors: errs, sanitized: { title, description: desc, options: opts, closesAt: draft.closesAt } };
}
