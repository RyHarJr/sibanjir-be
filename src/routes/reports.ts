import { Router, Response } from "express";
import { body, query } from "express-validator";
import { prisma } from "../lib/prisma";
import { authenticate, AuthRequest } from "../middleware/auth";
import { validate } from "../middleware/validate";
import { computeSeverity, computeConfidence } from "../lib/scoring";
import { upload } from "../lib/upload";
import fs from "fs";
import path from "path";

const router = Router();

// ── GET /reports ───────────────────────────────────────────────────────────
router.get(
  "/",
  [
    query("status").optional().isIn(["active", "surging", "receded"]),
    query("severity").optional().isIn(["low", "medium", "high", "extreme"]),
    query("district").optional().isString(),
    query("sort").optional().isIn(["latest", "deepest", "confidence"]),
    query("userId").optional().isInt(),
    query("page").optional().isInt({ min: 1 }),
    query("dateFrom").optional().isString(),
    query("dateTo").optional().isString(),
  ],
  validate,
  async (req: AuthRequest, res: Response): Promise<void> => {
    const { status, severity, district, sort = "latest", page = 1, limit = 20, userId, dateFrom, dateTo } = req.query;

    const where: Record<string, unknown> = {};
    if (status)  where.status = status;
    if (severity) where.severityLevel = severity;
    if (district) where.district = { name: { contains: district as string } };
    if (userId)  where.userId = Number(userId);

    const createdAtFilter: Record<string, Date> = {};
    if (dateFrom && typeof dateFrom === "string") {
      const parsed = new Date(dateFrom);
      if (!isNaN(parsed.getTime())) { parsed.setHours(0, 0, 0, 0); createdAtFilter.gte = parsed; }
    }
    if (dateTo && typeof dateTo === "string") {
      const parsed = new Date(dateTo);
      if (!isNaN(parsed.getTime())) { parsed.setHours(23, 59, 59, 999); createdAtFilter.lte = parsed; }
    }
    if (Object.keys(createdAtFilter).length > 0) {
      where.createdAt = createdAtFilter;
    }

    const orderBy: Record<string, string> =
      sort === "deepest" ? { waterDepthCm: "desc" } :
      sort === "confidence" ? { confidenceScore: "desc" } :
      { createdAt: "desc" };

    const skip = (Number(page) - 1) * Number(limit);

    const [total, reports] = await Promise.all([
      prisma.floodReport.count({ where }),
      prisma.floodReport.findMany({
        where,
        orderBy,
        skip,
        take: Number(limit),
        include: {
          user: { select: { id: true, name: true, avatar: true, reputationScore: true } },
          district: { select: { id: true, name: true } },
          _count: { select: { verifications: true, photos: true, updates: true } },
          photos: { select: { imageUrl: true }, take: 1, orderBy: { createdAt: "asc" } },
        },
      }),
    ]);

    res.json({
      success: true,
      data: reports,
      meta: { total, page: Number(page), limit: Number(limit), totalPages: Math.ceil(total / Number(limit)) },
    });
  }
);

// ── GET /reports/:id ───────────────────────────────────────────────────────
router.get("/:id", async (req: AuthRequest, res: Response): Promise<void> => {
  const report = await prisma.floodReport.findUnique({
    where: { id: Number(req.params.id) },
    include: {
      user: { select: { id: true, name: true, avatar: true, reputationScore: true } },
      district: true,
      verifications: {
        include: { user: { select: { id: true, name: true, avatar: true } } },
        orderBy: { createdAt: "desc" },
      },
      updates: {
        include: { user: { select: { id: true, name: true } } },
        orderBy: { createdAt: "asc" },
      },
      photos: {
        include: { user: { select: { id: true, name: true } } },
        orderBy: { createdAt: "desc" },
      },
    },
  });

  if (!report) {
    res.status(404).json({ success: false, message: "Laporan tidak ditemukan" });
    return;
  }
  res.json({ success: true, data: report });
});

// ── POST /reports ──────────────────────────────────────────────────────────
router.post(
  "/",
  authenticate,
  [
    body("title").trim().notEmpty().withMessage("Judul wajib diisi"),
    body("description").trim().notEmpty().withMessage("Deskripsi wajib diisi"),
    body("latitude").isFloat({ min: -90, max: 90 }).withMessage("Latitude tidak valid"),
    body("longitude").isFloat({ min: -180, max: 180 }).withMessage("Longitude tidak valid"),
    body("waterDepthCm").isInt({ min: 0 }).withMessage("Tinggi air harus angka positif"),
    body("roadAccess").isIn(["passable", "motorcycle_only", "difficult", "impassable"]),
    body("waterCurrent").optional().isIn(["calm", "slow", "moderate", "fast"]),
    body("districtId").optional().isInt(),
    body("address").optional().isString(),
  ],
  validate,
  async (req: AuthRequest, res: Response): Promise<void> => {
    const { title, description, latitude, longitude, address, districtId, waterDepthCm, roadAccess, waterCurrent, photoUrl } = req.body;

    const user = await prisma.user.findUnique({ where: { id: req.user!.id } });

    const severityLevel = computeSeverity(Number(waterDepthCm));
    const confidence = computeConfidence(0, 0, user?.reputationScore ?? 0, 0);

    const report = await prisma.floodReport.create({
      data: {
        userId: req.user!.id,
        districtId: districtId ? Number(districtId) : undefined,
        title,
        description,
        latitude: Number(latitude),
        longitude: Number(longitude),
        address,
        waterDepthCm: Number(waterDepthCm),
        severityLevel,
        roadAccess,
        waterCurrent: waterCurrent ?? "calm",
        photoUrl,
        confidenceScore: confidence,
      },
      include: {
        user: { select: { id: true, name: true, avatar: true } },
        district: { select: { id: true, name: true } },
      },
    });

    // Bump reporter reputation
    await prisma.user.update({
      where: { id: req.user!.id },
      data: { reputationScore: { increment: 10 } },
    });

    res.status(201).json({ success: true, message: "Laporan berhasil dikirim", data: report });
  }
);

// ── POST /reports/:id/update ───────────────────────────────────────────────
router.post(
  "/:id/update",
  authenticate,
  [
    body("waterDepthCm").isInt({ min: 0 }),
    body("status").isIn(["active", "surging", "receded"]),
    body("description").optional().isString(),
  ],
  validate,
  async (req: AuthRequest, res: Response): Promise<void> => {
    const report = await prisma.floodReport.findUnique({ where: { id: Number(req.params.id) } });
    if (!report) {
      res.status(404).json({ success: false, message: "Laporan tidak ditemukan" });
      return;
    }

    const { waterDepthCm, status, description } = req.body;

    const [update] = await prisma.$transaction([
      prisma.reportUpdate.create({
        data: {
          reportId: report.id,
          createdBy: req.user!.id,
          waterDepthCm: Number(waterDepthCm),
          status,
          description,
        },
      }),
      prisma.floodReport.update({
        where: { id: report.id },
        data: {
          waterDepthCm: Number(waterDepthCm),
          severityLevel: computeSeverity(Number(waterDepthCm)),
          status,
        },
      }),
    ]);

    res.json({ success: true, message: "Update berhasil disimpan", data: update });
  }
);

// ── POST /reports/:id/verify ───────────────────────────────────────────────
router.post(
  "/:id/verify",
  authenticate,
  [
    body("vote").isIn(["confirm", "reject"]).withMessage("Vote harus confirm atau reject"),
    body("comment").optional().isString(),
  ],
  validate,
  async (req: AuthRequest, res: Response): Promise<void> => {
    const reportId = Number(req.params.id);
    const userId = req.user!.id;

    const report = await prisma.floodReport.findUnique({
      where: { id: reportId },
      include: { user: { select: { reputationScore: true } } },
    });
    if (!report) {
      res.status(404).json({ success: false, message: "Laporan tidak ditemukan" });
      return;
    }
    if (report.userId === userId) {
      res.status(400).json({ success: false, message: "Tidak bisa memverifikasi laporan sendiri" });
      return;
    }

    const existing = await prisma.reportVerification.findUnique({
      where: { userId_reportId: { userId, reportId } },
    });
    if (existing) {
      res.status(409).json({ success: false, message: "Anda sudah memberikan vote untuk laporan ini" });
      return;
    }

    const { vote, comment } = req.body;

    await prisma.reportVerification.create({
      data: { reportId, userId, vote, comment },
    });

    // Recalculate confidence
    const [confirms, rejects] = await Promise.all([
      prisma.reportVerification.count({ where: { reportId, vote: "confirm" } }),
      prisma.reportVerification.count({ where: { reportId, vote: "reject" } }),
    ]);

    const nearbyCount = await prisma.floodReport.count({
      where: {
        status: "active",
        id: { not: reportId },
        latitude: { gte: report.latitude - 0.02, lte: report.latitude + 0.02 },
        longitude: { gte: report.longitude - 0.02, lte: report.longitude + 0.02 },
      },
    });

    const newScore = computeConfidence(confirms, rejects, report.user.reputationScore, nearbyCount);

    await prisma.floodReport.update({
      where: { id: reportId },
      data: { confidenceScore: newScore },
    });

    // Bump verifier reputation slightly
    await prisma.user.update({
      where: { id: userId },
      data: { reputationScore: { increment: 2 } },
    });

    res.json({ success: true, message: `Vote '${vote}' berhasil disimpan`, data: { confirms, rejects, confidenceScore: newScore } });
  }
);

// ── POST /reports/:id/photos ──────────────────────────────────────────────
router.post(
  "/:id/photos",
  authenticate,
  upload.array("photos", 10),
  async (req: AuthRequest, res: Response): Promise<void> => {
    const reportId = Number(req.params.id);

    const report = await prisma.floodReport.findUnique({ where: { id: reportId } });
    if (!report) {
      res.status(404).json({ success: false, message: "Laporan tidak ditemukan" });
      return;
    }

    // Check existing photo count
    const existingCount = await prisma.reportPhoto.count({ where: { reportId } });
    const files = req.files as Express.Multer.File[];

    if (!files || files.length === 0) {
      res.status(400).json({ success: false, message: "Tidak ada foto yang diunggah" });
      return;
    }

    if (existingCount + files.length > 10) {
      // Delete newly uploaded files since we can't accept them
      files.forEach(f => { try { fs.unlinkSync(f.path); } catch {} });
      res.status(400).json({
        success: false,
        message: `Melebihi batas foto. Sudah ada ${existingCount} foto, maksimal 10.`,
      });
      return;
    }

    const baseUrl = process.env.BASE_URL || `http://localhost:${process.env.PORT || 3001}`;

    const photos = await prisma.$transaction(
      files.map(f =>
        prisma.reportPhoto.create({
          data: {
            reportId,
            uploadedBy: req.user!.id,
            imageUrl: `${baseUrl}/uploads/${path.basename(f.path)}`,
          },
        })
      )
    );

    res.status(201).json({
      success: true,
      message: `${files.length} foto berhasil diunggah`,
      data: photos,
    });
  }
);

// ── DELETE /reports/:id ────────────────────────────────────────────────────
router.delete("/:id", authenticate, async (req: AuthRequest, res: Response): Promise<void> => {
  const report = await prisma.floodReport.findUnique({ where: { id: Number(req.params.id) } });
  if (!report) {
    res.status(404).json({ success: false, message: "Laporan tidak ditemukan" });
    return;
  }

  const isOwner = report.userId === req.user!.id;
  const isAdmin = req.user!.role === "admin";

  if (!isOwner && !isAdmin) {
    res.status(403).json({ success: false, message: "Tidak punya akses menghapus laporan ini" });
    return;
  }

  await prisma.floodReport.delete({ where: { id: report.id } });
  res.json({ success: true, message: "Laporan berhasil dihapus" });
});

export default router;
