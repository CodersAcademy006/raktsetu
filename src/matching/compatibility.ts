export const BLOOD_GROUPS = ["O-", "O+", "A-", "A+", "B-", "B+", "AB-", "AB+"] as const;
export type BloodGroup = (typeof BLOOD_GROUPS)[number];

export const COMPONENTS = ["whole_blood", "prbc", "platelets", "plasma"] as const;
export type Component = (typeof COMPONENTS)[number];

export const COMPONENT_LABELS: Record<Component, string> = {
  whole_blood: "Whole blood",
  prbc: "Red cells (PRBC)",
  platelets: "Platelets",
  plasma: "Plasma (FFP)",
};

// Red cells (whole blood, PRBC): who can donate TO a given recipient.
const RED_CELL_DONORS: Record<BloodGroup, BloodGroup[]> = {
  "O-": ["O-"],
  "O+": ["O-", "O+"],
  "A-": ["O-", "A-"],
  "A+": ["O-", "O+", "A-", "A+"],
  "B-": ["O-", "B-"],
  "B+": ["O-", "O+", "B-", "B+"],
  "AB-": ["O-", "A-", "B-", "AB-"],
  "AB+": [...BLOOD_GROUPS],
};

// Plasma runs the other way: donor plasma must not carry antibodies against
// the recipient's ABO antigens, so AB is the universal plasma donor. Rh does
// not matter for plasma.
const PLASMA_DONOR_ABO: Record<string, string[]> = {
  O: ["O", "A", "B", "AB"],
  A: ["A", "AB"],
  B: ["B", "AB"],
  AB: ["AB"],
};

const abo = (g: BloodGroup) => g.slice(0, -1);
const isRhNegative = (g: BloodGroup) => g.endsWith("-");

// Platelets follow the plasma ABO rule (plasma-compatible units are preferred)
// and additionally give Rh-negative recipients Rh-negative donors only, since
// platelet units carry some red cells. A simplification of transfusion
// practice, where ABO-incompatible platelets are also used when stock is short.
export function compatibleDonorGroups(recipient: BloodGroup, component: Component = "whole_blood"): BloodGroup[] {
  if (component === "whole_blood" || component === "prbc") return RED_CELL_DONORS[recipient];
  const plasmaOk = BLOOD_GROUPS.filter((g) => PLASMA_DONOR_ABO[abo(recipient)].includes(abo(g)));
  if (component === "plasma") return plasmaOk;
  return isRhNegative(recipient) ? plasmaOk.filter(isRhNegative) : plasmaOk;
}

export function isCompatibleDonor(donor: BloodGroup, recipient: BloodGroup, component: Component = "whole_blood"): boolean {
  return compatibleDonorGroups(recipient, component).includes(donor);
}
