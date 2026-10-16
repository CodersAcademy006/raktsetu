export const BLOOD_GROUPS = ["O-", "O+", "A-", "A+", "B-", "B+", "AB-", "AB+"] as const;
export type BloodGroup = (typeof BLOOD_GROUPS)[number];

// Who can donate TO a given recipient blood group (standard whole-blood compatibility).
const COMPATIBLE_DONORS: Record<BloodGroup, BloodGroup[]> = {
  "O-": ["O-"],
  "O+": ["O-", "O+"],
  "A-": ["O-", "A-"],
  "A+": ["O-", "O+", "A-", "A+"],
  "B-": ["O-", "B-"],
  "B+": ["O-", "O+", "B-", "B+"],
  "AB-": ["O-", "A-", "B-", "AB-"],
  "AB+": [...BLOOD_GROUPS],
};

export function isCompatibleDonor(donorGroup: BloodGroup, recipientGroup: BloodGroup): boolean {
  return COMPATIBLE_DONORS[recipientGroup].includes(donorGroup);
}

export function compatibleDonorGroups(recipientGroup: BloodGroup): BloodGroup[] {
  return COMPATIBLE_DONORS[recipientGroup];
}
