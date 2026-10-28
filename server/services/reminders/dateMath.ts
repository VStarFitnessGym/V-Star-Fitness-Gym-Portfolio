// ============================================================================
// Stage 5A Reminder Engine: Calendar Date Arithmetic & Timezone Utilities
// Strictly calendar-based (non-floating 72-hour) deterministic date calculations
// ============================================================================

import { NotificationMilestone } from './types';

/**
 * Returns true if a given year is a leap year according to the Gregorian calendar
 */
export function isLeapYear(year: number): boolean {
  return (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
}

/**
 * Formats a Date object as YYYY-MM-DD using UTC values
 */
export function formatUtcDateString(d: Date): string {
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, '0');
  const day = String(d.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/**
 * Derives the local calendar date (YYYY-MM-DD) for a given Date in the gym's configured timezone.
 * Defaults to Asia/Kolkata (+05:30).
 */
export function getGymLocalCalendarDate(date: Date = new Date(), timezone: string = 'Asia/Kolkata'): string {
  try {
    const formatter = new Intl.DateTimeFormat('en-CA', {
      timeZone: timezone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit'
    });
    return formatter.format(date);
  } catch {
    return formatUtcDateString(date);
  }
}

/**
 * Adds or subtracts integer calendar days from a YYYY-MM-DD date string.
 * Strictly respects month boundaries, year boundaries, and leap years.
 */
export function addCalendarDays(dateStr: string, days: number): string {
  const parts = dateStr.split('-');
  if (parts.length !== 3) {
    throw new Error(`Invalid date string format: ${dateStr}. Expected YYYY-MM-DD.`);
  }

  const y = parseInt(parts[0], 10);
  const m = parseInt(parts[1], 10) - 1; // 0-indexed
  const d = parseInt(parts[2], 10);

  // Use UTC to prevent local DST or machine timezone offsets from distorting calendar day math
  const date = new Date(Date.UTC(y, m, d));
  date.setUTCDate(date.getUTCDate() + days);

  return formatUtcDateString(date);
}

/**
 * Calculates the exact milestone target calendar date relative to subscription expiry date
 */
export function calculateMilestoneTargetDate(expiryDate: string, milestone: NotificationMilestone): string {
  switch (milestone) {
    case 'EXPIRY_MINUS_3':
      return addCalendarDays(expiryDate, -3);
    case 'EXPIRY_ZERO':
      return expiryDate;
    case 'EXPIRY_PLUS_3':
      return addCalendarDays(expiryDate, +3);
    case 'MANUAL_TRIGGER':
      return expiryDate;
    default:
      throw new Error(`Unknown milestone: ${milestone}`);
  }
}

/**
 * Known fixed timezone offsets in minutes relative to UTC
 */
const TIMEZONE_OFFSET_MINUTES: Record<string, number> = {
  'Asia/Kolkata': 330, // UTC +05:30
  'Asia/Calcutta': 330,
  'UTC': 0,
  'GMT': 0
};

/**
 * Converts a target calendar date (YYYY-MM-DD) and a local gym send hour (0-23)
 * into an authoritative UTC ISO string (TIMESTAMPTZ) for scheduling.
 * Defaults to Asia/Kolkata (+05:30).
 */
export function convertTargetDateToUtcSchedule(
  targetDateStr: string,
  sendHour: number = 10,
  timezone: string = 'Asia/Kolkata'
): string {
  const parts = targetDateStr.split('-');
  const y = parseInt(parts[0], 10);
  const m = parseInt(parts[1], 10) - 1;
  const d = parseInt(parts[2], 10);

  const offsetMinutes = TIMEZONE_OFFSET_MINUTES[timezone] ?? 330; // Default +05:30 (India Standard Time)

  // Total minutes from UTC midnight for the local time: (sendHour * 60) - offsetMinutes
  const totalLocalMinutes = sendHour * 60;
  const totalUtcMinutes = totalLocalMinutes - offsetMinutes;

  const utcDate = new Date(Date.UTC(y, m, d, 0, 0, 0, 0));
  utcDate.setUTCMinutes(utcDate.getUTCMinutes() + totalUtcMinutes);

  return utcDate.toISOString();
}

/**
 * Evaluates whether a member is active on a given date under the inclusive expiry rule.
 * The member remains active through the end of their expiry date.
 */
export function isSubscriptionActiveOnDate(startDate: string, endDate: string, checkDate: string): boolean {
  return checkDate >= startDate && checkDate <= endDate;
}

/**
 * Checks whether a milestone target date is considered stale and should not be dispatched
 * in an obsolete burst following a missed scheduler run.
 * Grace period defaults to 1 calendar day.
 */
export function isMilestoneStale(targetDate: string, currentDate: string, graceDays: number = 1): boolean {
  const cutoffDate = addCalendarDays(currentDate, -graceDays);
  return targetDate < cutoffDate;
}
