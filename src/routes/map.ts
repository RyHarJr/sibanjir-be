import { Router, Response } from "express"
import { prisma } from "../lib/prisma"
import { authenticate, AuthRequest } from "../middleware/auth"

const router = Router()

// ── Constants ─────────────────────────────────────────────────────────────────
const OSRM_BASE = "https://router.project-osrm.org"

// Radius (km) around a flood point that marks a road as "flooded"
const FLOOD_BLOCK_RADIUS_KM = 0.25 // 250 m — hard block
const FLOOD_WARN_RADIUS_KM = 0.5 // 500 m — soft penalty

// Water depth (cm) thresholds
const DEPTH_IMPASSABLE = 50 // ≥ 50 cm → completely block that route segment
const DEPTH_HEAVY = 30 // 30-50 cm → heavy penalty
const DEPTH_LIGHT = 10 // 10-30 cm → light penalty

// ── Haversine distance in kilometres ─────────────────────────────────────────
function haversine(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371
  const dLat = ((lat2 - lat1) * Math.PI) / 180
  const dLon = ((lon2 - lon1) * Math.PI) / 180
  const a = Math.sin(dLat / 2) ** 2 + Math.cos((lat1 * Math.PI) / 180) * Math.cos((lat2 * Math.PI) / 180) * Math.sin(dLon / 2) ** 2
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
}

// ── Score a route geometry against flood reports ──────────────────────────────
// Returns { floodScore, isBlocked, nearbyFloods, passableDepth }
function scoreRoute(coords: number[][], floodReports: Array<{ latitude: number; longitude: number; waterDepthCm: number; severityLevel: string; roadAccess: string | null; address: string | null }>) {
  let floodScore = 0
  let isBlocked = false
  const nearbyFloodsMap = new Map<string, any>()

  // Sample every N-th point for performance
  const step = Math.max(1, Math.floor(coords.length / 300))

  for (const report of floodReports) {
    const depth = report.waterDepthCm ?? 0
    let closestDist = Infinity

    for (let i = 0; i < coords.length; i += step) {
      const [lng, lat] = coords[i]
      const dist = haversine(lat, lng, report.latitude, report.longitude)
      if (dist < closestDist) closestDist = dist
      if (closestDist < FLOOD_BLOCK_RADIUS_KM) break // can't get closer
    }

    if (closestDist < FLOOD_BLOCK_RADIUS_KM) {
      // Hard block: road passes through flood zone
      if (depth >= DEPTH_IMPASSABLE) {
        isBlocked = true
        floodScore += 100000 // effectively infinite penalty
      } else if (depth >= DEPTH_HEAVY) {
        floodScore += (depth / Math.max(closestDist * 1000, 10)) * 500
      } else if (depth >= DEPTH_LIGHT) {
        floodScore += (depth / Math.max(closestDist * 1000, 10)) * 100
      } else {
        floodScore += (depth / Math.max(closestDist * 1000, 10)) * 20
      }

      const key = `${report.latitude.toFixed(4)},${report.longitude.toFixed(4)}`
      if (!nearbyFloodsMap.has(key)) {
        nearbyFloodsMap.set(key, {
          lat: report.latitude,
          lng: report.longitude,
          depth: `${depth}cm`,
          severity: report.severityLevel,
          roadAccess: report.roadAccess,
          address: report.address,
        })
      }
    } else if (closestDist < FLOOD_WARN_RADIUS_KM) {
      // Soft warning: route passes within 500m
      floodScore += (depth / Math.max(closestDist * 1000, 10)) * 10
    }
  }

  return {
    floodScore,
    isBlocked,
    nearbyFloods: Array.from(nearbyFloodsMap.values()),
  }
}

// ── Fetch route from OSRM ─────────────────────────────────────────────────────
async function fetchOSRM(originLat: number, originLng: number, destLat: number, destLng: number, waypoints: Array<{ lat: number; lng: number }> = []) {
  const coordinateStr = [`${originLng},${originLat}`, ...waypoints.map((w) => `${w.lng},${w.lat}`), `${destLng},${destLat}`].join(";")

  const url = `${OSRM_BASE}/route/v1/driving/${coordinateStr}` + `?alternatives=${waypoints.length === 0 ? "true" : "false"}` + `&overview=full&geometries=geojson&steps=true`

  const res = await fetch(url)
  if (!res.ok) throw new Error(`OSRM error: ${res.status}`)
  return res.json() as Promise<any>
}

// ── Generate MULTIPLE detour candidate waypoint sets ─────────────────────────
// Tries both left/right at several offsets, plus 2-waypoint arcs for wide floods
function generateMultiDetourCandidates(originLat: number, originLng: number, destLat: number, destLng: number, floodReports: Array<{ latitude: number; longitude: number; waterDepthCm: number }>): Array<Array<{ lat: number; lng: number }>> {
  const blockers = floodReports.filter((r) => r.waterDepthCm >= DEPTH_IMPASSABLE)
  if (blockers.length === 0) return []

  // Flood centroid
  const centLat = blockers.reduce((s, r) => s + r.latitude, 0) / blockers.length
  const centLng = blockers.reduce((s, r) => s + r.longitude, 0) / blockers.length

  // Flood cluster spread (max distance from centroid)
  const clusterSpreadKm = Math.max(...blockers.map((r) => haversine(centLat, centLng, r.latitude, r.longitude)), 0.1)

  // Direction vector of the direct route
  const dLat = destLat - originLat
  const dLng = destLng - originLng
  const len = Math.sqrt(dLat * dLat + dLng * dLng) || 1

  // Perpendicular unit vector (rotated 90°)
  const perpLat = -dLng / len
  const perpLng = dLat / len

  // Progress along route where flood centroid sits (0=origin, 1=dest)
  const t = Math.max(0.15, Math.min(0.85, ((centLat - originLat) * dLat + (centLng - originLng) * dLng) / (len * len)))

  // Point on the direct route closest to flood centroid
  const midLat = originLat + t * dLat
  const midLng = originLng + t * dLng

  const candidates: Array<Array<{ lat: number; lng: number }>> = []

  // 1 degree ≈ 111 km
  const offsets = [
    clusterSpreadKm + 0.5, // tight: just past the flood edge
    clusterSpreadKm + 1.5, // medium
    clusterSpreadKm + 3.0, // wide detour
  ]

  for (const offsetKm of offsets) {
    const degOffset = offsetKm / 111

    // Single waypoint — left
    candidates.push([
      {
        lat: midLat + perpLat * degOffset,
        lng: midLng + perpLng * degOffset,
      },
    ])

    // Single waypoint — right
    candidates.push([
      {
        lat: midLat - perpLat * degOffset,
        lng: midLng - perpLng * degOffset,
      },
    ])
  }

  // 2-waypoint arc for wide flood clusters (> 500m spread)
  if (clusterSpreadKm > 0.5) {
    const arcOffset = (clusterSpreadKm + 2.0) / 111
    const t1 = Math.max(0.1, t - 0.15)
    const t2 = Math.min(0.9, t + 0.15)
    const pre = { lat: originLat + t1 * dLat, lng: originLng + t1 * dLng }
    const post = { lat: originLat + t2 * dLat, lng: originLng + t2 * dLng }

    // Arc left
    candidates.push([
      { lat: pre.lat + perpLat * arcOffset, lng: pre.lng + perpLng * arcOffset },
      { lat: post.lat + perpLat * arcOffset, lng: post.lng + perpLng * arcOffset },
    ])

    // Arc right
    candidates.push([
      { lat: pre.lat - perpLat * arcOffset, lng: pre.lng - perpLng * arcOffset },
      { lat: post.lat - perpLat * arcOffset, lng: post.lng - perpLng * arcOffset },
    ])
  }

  return candidates
}

// GET /map/reports — semua laporan aktif dengan koordinat (untuk marker peta)
router.get("/reports", async (req: AuthRequest, res: Response): Promise<void> => {
  const { dateFrom, dateTo } = req.query // optional YYYY-MM-DD range

  const where: Record<string, unknown> = {
    status: { in: ["active", "surging"] },
  }

  const createdAtFilter: Record<string, Date> = {}
  if (dateFrom && typeof dateFrom === "string") {
    const parsed = new Date(`${dateFrom}T00:00:00+07:00`)
    if (!isNaN(parsed.getTime())) {
      createdAtFilter.gte = parsed
    }
  }
  if (dateTo && typeof dateTo === "string") {
    const parsed = new Date(`${dateTo}T23:59:59.999+07:00`)
    if (!isNaN(parsed.getTime())) {
      createdAtFilter.lte = parsed
    }
  }
  if (Object.keys(createdAtFilter).length > 0) {
    where.createdAt = createdAtFilter
  }

  const reports = await prisma.floodReport.findMany({
    where,
    select: {
      id: true,
      title: true,
      latitude: true,
      longitude: true,
      waterDepthCm: true,
      severityLevel: true,
      status: true,
      roadAccess: true,
      confidenceScore: true,
      address: true,
      createdAt: true,
      district: { select: { name: true } },
      _count: { select: { verifications: true } },
    },
    orderBy: { waterDepthCm: "desc" },
  })
  res.json({ success: true, data: reports })
})

// GET /map/zones — heatmap per kecamatan
router.get("/zones", async (_req: AuthRequest, res: Response): Promise<void> => {
  const zones = await prisma.floodReport.groupBy({
    by: ["districtId"],
    where: { status: { in: ["active", "surging"] }, districtId: { not: null } },
    _avg: { waterDepthCm: true },
    _count: { id: true },
  })

  const districtIds = zones.map((z) => z.districtId).filter(Boolean) as number[]
  const districts = await prisma.district.findMany({
    where: { id: { in: districtIds } },
    include: { floodZone: true },
  })

  const result = zones.map((z) => {
    const district = districts.find((d) => d.id === z.districtId)
    const avgDepth = z._avg.waterDepthCm ?? 0
    const riskLevel = avgDepth <= 30 ? "low" : avgDepth <= 60 ? "medium" : avgDepth <= 100 ? "high" : "extreme"

    return {
      districtId: z.districtId,
      districtName: district?.name,
      latitude: district?.latitude,
      longitude: district?.longitude,
      avgDepth,
      reportCount: z._count.id,
      riskLevel,
      polygonGeojson: district?.floodZone?.polygonGeojson ?? null,
    }
  })

  res.json({ success: true, data: result })
})

// GET /map/nearby
router.get("/nearby", async (req: AuthRequest, res: Response): Promise<void> => {
  const { lat, lng, radius = "2" } = req.query
  if (!lat || !lng) {
    res.status(400).json({ success: false, message: "Parameter lat dan lng wajib ada" })
    return
  }
  const latNum = Number(lat)
  const lngNum = Number(lng)
  const radiusDeg = Number(radius) / 111

  const reports = await prisma.floodReport.findMany({
    where: {
      status: { in: ["active", "surging"] },
      latitude: { gte: latNum - radiusDeg, lte: latNum + radiusDeg },
      longitude: { gte: lngNum - radiusDeg, lte: lngNum + radiusDeg },
    },
    include: { district: { select: { name: true } } },
    orderBy: { waterDepthCm: "desc" },
    take: 50,
  })
  res.json({ success: true, data: reports })
})

// ── POST /map/safe-route ──────────────────────────────────────────────────────
router.post("/safe-route", async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { originLat, originLng, destLat, destLng } = req.body

    if (!originLat || !originLng || !destLat || !destLng) {
      res.status(400).json({
        success: false,
        message: "Parameter originLat, originLng, destLat, destLng wajib ada",
      })
      return
    }

    const oLat = Number(originLat),
      oLng = Number(originLng)
    const dLat = Number(destLat),
      dLng = Number(destLng)

    // ── 1. Load active flood reports ─────────────────────────────────────
    const floodReports = await prisma.floodReport.findMany({
      where: { status: { in: ["active", "surging"] } },
      select: {
        latitude: true,
        longitude: true,
        waterDepthCm: true,
        severityLevel: true,
        roadAccess: true,
        address: true,
      },
    })

    // ── 2. Get primary + alternative routes from OSRM ────────────────────
    const osrmData: any = await fetchOSRM(oLat, oLng, dLat, dLng)

    if (osrmData.code !== "Ok" || !osrmData.routes?.length) {
      res.status(404).json({ success: false, message: "Tidak dapat menemukan rute" })
      return
    }

    // ── 3. Score all returned routes ─────────────────────────────────────
    const scoredRoutes = osrmData.routes.map((route: any, index: number) => {
      const coords: number[][] = route.geometry.coordinates
      const { floodScore, isBlocked, nearbyFloods } = scoreRoute(coords, floodReports)
      const summary =
        route.legs
          ?.map((l: any) => l.summary || "")
          .filter(Boolean)
          .join(", ") || ""

      return {
        index,
        points: coords.map((c: number[]) => ({ lat: c[1], lng: c[0] })),
        distance: route.distance,
        duration: route.duration,
        floodScore,
        isBlocked,
        nearbyFloods,
        summary,
      }
    })

    // Sort by floodScore ascending (safest first)
    scoredRoutes.sort((a: any, b: any) => a.floodScore - b.floodScore)

    let safeRoute = scoredRoutes[0]

    // ── 4. If best route is still blocked → try multiple detour candidates ─
    if (safeRoute.isBlocked) {
      const detourCandidates = generateMultiDetourCandidates(oLat, oLng, dLat, dLng, floodReports)

      // Try all candidates in parallel, score each
      const detourResults = await Promise.allSettled(
        detourCandidates.map(async (waypoints) => {
          const detourData: any = await fetchOSRM(oLat, oLng, dLat, dLng, waypoints)
          if (detourData.code !== "Ok" || !detourData.routes?.length) return null

          const detourRoute = detourData.routes[0]
          const coords: number[][] = detourRoute.geometry.coordinates
          const scored = scoreRoute(coords, floodReports)

          return {
            points: coords.map((c: number[]) => ({ lat: c[1], lng: c[0] })),
            distance: detourRoute.distance,
            duration: detourRoute.duration,
            floodScore: scored.floodScore,
            isBlocked: scored.isBlocked,
            nearbyFloods: scored.nearbyFloods,
            summary:
              detourRoute.legs
                ?.map((l: any) => l.summary || "")
                .filter(Boolean)
                .join(", ") || "Rute Detour",
            index: -1,
          }
        }),
      )

      // Pick the best detour (lowest flood score, prefer unblocked)
      for (const result of detourResults) {
        if (result.status !== "fulfilled" || !result.value) continue
        const candidate = result.value

        // Better than current best?
        if (candidate.floodScore < safeRoute.floodScore) {
          safeRoute = candidate
        }
      }
    }

    // ── 5. Flooded route = worst-scoring route (for comparison UI) ───────
    const floodedRoute = scoredRoutes.length > 1 && scoredRoutes[scoredRoutes.length - 1].floodScore > safeRoute.floodScore ? scoredRoutes[scoredRoutes.length - 1] : null

    // ── 6. All flood markers near any displayed route ────────────────────
    const routePoints = [...safeRoute.points, ...(floodedRoute?.points ?? [])]

    const allFloodMarkers = floodReports
      .filter((r) => routePoints.some((p) => haversine(p.lat, p.lng, r.latitude, r.longitude) < 1))
      .map((r) => ({
        lat: r.latitude,
        lng: r.longitude,
        depth: `${r.waterDepthCm}cm`,
        severity: r.severityLevel,
        roadAccess: r.roadAccess,
      }))

    // ── 7. Generate warning message ─────────────────────────────────────
    let warningMessage: string | null = null
    if (safeRoute.isBlocked) {
      warningMessage = "⚠️ Semua rute melewati area banjir parah. Pertimbangkan untuk menunda perjalanan."
    } else if (safeRoute.floodScore > 0 && safeRoute.index === -1) {
      warningMessage = "🔄 Rute dialihkan untuk menghindari area banjir. Perjalanan mungkin lebih jauh dari biasanya."
    } else if (safeRoute.floodScore > 0) {
      warningMessage = "⚠️ Rute ini mendekati area banjir. Harap berhati-hati."
    }

    // ── 8. Respond ────────────────────────────────────────────────────────
    res.json({
      success: true,
      data: {
        safeRoute: {
          points: safeRoute.points,
          distance: safeRoute.distance,
          duration: safeRoute.duration,
          floodScore: safeRoute.floodScore,
          summary: safeRoute.summary,
          isSafe: safeRoute.floodScore === 0,
          isDetour: safeRoute.index === -1,
          nearbyFloods: safeRoute.nearbyFloods,
        },
        floodedRoute: floodedRoute
          ? {
              points: floodedRoute.points,
              distance: floodedRoute.distance,
              duration: floodedRoute.duration,
              floodScore: floodedRoute.floodScore,
              summary: floodedRoute.summary,
              nearbyFloods: floodedRoute.nearbyFloods,
            }
          : null,
        floodMarkers: allFloodMarkers,
        totalFloodReports: floodReports.length,
        warningMessage,
      },
    })
  } catch (err: any) {
    console.error("safe-route error:", err)
    res.status(500).json({
      success: false,
      message: "Gagal menghitung rute: " + (err.message || "Unknown error"),
    })
  }
})

export default router
