import { Router } from "express";
import { z } from "zod";
import { getDb, type BloodBankDoc } from "../db/mongo.ts";
import { ESCALATION_RADII_KM } from "../matching/eligibility.ts";
import { asyncHandler } from "./async-handler.ts";

export const nearbyRouter = Router();

const MAX_RADIUS_KM = ESCALATION_RADII_KM[ESCALATION_RADII_KM.length - 1];

const Query = z.object({
  lat: z.coerce.number().min(-90).max(90),
  lng: z.coerce.number().min(-180).max(180),
});

// Called right after the browser shares the user's location, before the MCQ
// step -- shows what's actually reachable (blood banks + donor counts by
// group) so staff see the real picture, the same one the dispatch workflow
// will later search, before they answer anything.
nearbyRouter.get("/nearby", asyncHandler(async (req, res) => {
  const parsed = Query.safeParse(req.query);
  if (!parsed.success) return res.status(400).json({ error: "invalid_coordinates" });
  const { lat, lng } = parsed.data;

  const db = await getDb();
  const near = { type: "Point" as const, coordinates: [lng, lat] as [number, number] };
  const maxDistanceMeters = MAX_RADIUS_KM * 1000;

  const bloodBanks = await db
    .collection<BloodBankDoc>("blood_banks")
    .aggregate([
      { $geoNear: { near, distanceField: "distanceMeters", maxDistance: maxDistanceMeters, spherical: true } },
      { $limit: 25 },
      { $project: { _id: 0, bankId: 1, name: 1, phone: 1, distanceKm: { $round: [{ $divide: ["$distanceMeters", 1000] }, 1] } } },
    ])
    .toArray();

  const donorGroups = await db
    .collection("donors")
    .aggregate<{ _id: string; count: number }>([
      {
        $geoNear: {
          near,
          distanceField: "distanceMeters",
          maxDistance: maxDistanceMeters,
          spherical: true,
          query: { optInStatus: true, active: true },
        },
      },
      { $group: { _id: "$bloodGroup", count: { $sum: 1 } } },
    ])
    .toArray();

  const donorCountByGroup = Object.fromEntries(donorGroups.map((g) => [g._id, g.count]));
  const totalDonors = donorGroups.reduce((sum, g) => sum + g.count, 0);

  res.json({ searchedRadiusKm: MAX_RADIUS_KM, bloodBanks, donorCountByGroup, totalDonors });
}));
