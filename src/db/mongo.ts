import { MongoClient, type Db } from "mongodb";
import type { BloodGroup } from "../matching/compatibility.ts";
import type { Sex } from "../matching/eligibility.ts";

export interface BloodBankDoc {
  bankId: string;
  name: string;
  location: { type: "Point"; coordinates: [number, number] };
  phone: string;
  synthetic: boolean;
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
  unitsRequested: number;
  targetDonorAcceptances: number;
  location: { type: "Point"; coordinates: [number, number] };
  locationText: string;
  urgency: string;
  status: RequestStatus;
  currentRadiusKm: number | null;
  nextEscalationAt?: Date | null; // when the current batch's response window closes
  acceptedDonorIds: string[];
  contactedDonorIds: string[];
  createdAt: Date;
  requesterName?: string;
  contactPhone?: string;
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
  await db.collection<DispatchDoc>("dispatches").createIndex({ requestId: 1, donorId: 1 });
  await db.collection<DispatchDoc>("dispatches").createIndex({ dispatchId: 1 }, { unique: true });
  await db.collection<WorkflowEventDoc>("workflow_events").createIndex({ requestId: 1, timestamp: 1 });
}

export async function closeDb(): Promise<void> {
  const pending = clientPromise;
  clientPromise = null;
  if (pending) await (await pending).close();
}
