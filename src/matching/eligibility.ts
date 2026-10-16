export const DONATION_COOLDOWN_DAYS = 90;

export function isEligibleToday(lastDonationDate: Date | null, now: Date = new Date()): boolean {
  if (!lastDonationDate) return true;
  const msSinceLast = now.getTime() - lastDonationDate.getTime();
  const daysSinceLast = msSinceLast / (1000 * 60 * 60 * 24);
  return daysSinceLast >= DONATION_COOLDOWN_DAYS;
}

export const ESCALATION_RADII_KM = [5, 10, 25, 50];

export function nextRadiusKm(currentRadiusKm: number | null): number | null {
  if (currentRadiusKm === null) return ESCALATION_RADII_KM[0];
  const idx = ESCALATION_RADII_KM.indexOf(currentRadiusKm);
  if (idx === -1 || idx === ESCALATION_RADII_KM.length - 1) return null;
  return ESCALATION_RADII_KM[idx + 1];
}
