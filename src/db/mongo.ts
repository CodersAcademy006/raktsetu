import { MongoClient, type Db } from "mongodb";
import type { BloodGroup, Component } from "../matching/compatibility.ts";
import type { Sex } from "../matching/eligibility.ts";

export interface BloodBankDoc {
  bankId: string;
  name: string;
  location: { type: "Point"; coordinates: [number, number] };
  phone: string;
  synthetic: boolean;
  // Units on the shelf, by component then blood group. Synthetic in the demo;
  // a real deployment syncs this from the bank's inventory (e.g. e-RaktKosh).
  stock: Partial<Record<Component, Partial<Record<BloodGroup, number>>>>;
}

export interface BankReservation {
  bankId: string;
  name: string;
  phone: string;
  distanceKm: number;
  bloodGroup: BloodGroup;
  units: number;
}

export interface DonorDoc {
  donorId: string;
  name: string;
  bloodGroup: BloodGroup;
  location: { type: "Point"; coordinates: [number, number] }; // [lng, lat]
  sex: Sex;
  dateOfBirth: Date;
  weightKg: number;
  lastDonationDate: Date | null;
  optInStatus: boolean;
  active: boolean;
  synthetic: boolean;
  phone: string;
}

export type RequestStatus = "MATCHING" | "DISPATCHING" | "WAITING" | "FULFILLED" | "EXHAUSTED";
export const TERMINAL_STATUSES: readonly RequestStatus[] = ["FULFILLED", "EXHAUSTED"];

export interface RequestDoc {
  requestId: string;
  requiredBloodGroup: BloodGroup;
  component: Component;
  unitsRequested: number;
  targetDonorAcceptances: number;
  bankReservations?: BankReservation[];
  donorsNeeded?: number; // target minus units reserved from banks
  location: { type: "Point"; coordinates: [number, number] };
  locationText: string;
  urgency: string;
  status: RequestStatus;
  currentRadiusKm: number | null;
  nextEscalationAt?: Date | null; // when the current batch's response window closes
  acceptedDonorIds: string[];
  contactedDonorIds: string[];
  createdAt: Date;
  hospitalName: string;
  contactPhone: string;
  requesterName?: string;
}

export interface DispatchDoc {
  dispatchId: string;
  requestId: string;
  donorId: string;
  batchNo: number;
  provider: "demo-web";
  message: string;
  status: "sent" | "accepted" | "declined" | "expired";
  createdAt: Date;
  respondedAt?: Date;
}

export interface WorkflowEventDoc {
  eventId: string;
  requestId: string;
  type: string;
  timestamp: Date;
  metadata: Record<string, unknown>;
}

// Cache the connect promise, not the client: concurrent callers share one
// connection attempt, and a failed attempt is dropped so the next call
// retries instead of reusing a closed client forever.
let clientPromise: Promise<MongoClient> | null = null;

export async function getDb(): Promise<Db> {
  if (!clientPromise) {
    const uri = process.env.MONGODB_URI;
    if (!uri) throw new Error("MONGODB_URI not set");
    clientPromise = new MongoClient(uri, { serverSelectionTimeoutMS: 10_000 }).connect().catch((err) => {
      clientPromise = null;
      throw err;
    });
  }
  return (await clientPromise).db();
}

export async function ensureIndexes(db: Db): Promise<void> {
  await db.collection<BloodBankDoc>("blood_banks").createIndex({ location: "2dsphere" });
  await db.collection<BloodBankDoc>("blood_banks").createIndex({ bankId: 1 }, { unique: true });
  await db.collection<DonorDoc>("donors").createIndex({ location: "2dsphere" });
  await db.collection<DonorDoc>("donors").createIndex({ donorId: 1 }, { unique: true });
  await db.collection<RequestDoc>("requests").createIndex({ requestId: 1 }, { unique: true });
  // Was non-unique in early versions; rebuild it unique if an old one exists.
  const dispatches = db.collection<DispatchDoc>("dispatches");
  try {
    await dispatches.createIndex({ requestId: 1, donorId: 1 }, { unique: true });
  } catch (err) {
    const code = (err as { code?: number }).code;
    if (code !== 85 && code !== 86) throw err; // IndexOptionsConflict / IndexKeySpecsConflict
    await dispatches.dropIndex("requestId_1_donorId_1");
    await dispatches.createIndex({ requestId: 1, donorId: 1 }, { unique: true });
  }
  await db.collection<DispatchDoc>("dispatches").createIndex({ dispatchId: 1 }, { unique: true });
  await db.collection<WorkflowEventDoc>("workflow_events").createIndex({ requestId: 1, timestamp: 1 });
}

export async function closeDb(): Promise<void> {
  const pending = clientPromise;
  clientPromise = null;
  if (pending) await (await pending).close();
}
