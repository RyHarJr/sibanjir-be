import { Router, Response } from "express";
import { prisma } from "../lib/prisma";
import { authenticate, requireAdmin, AuthRequest } from "../middleware/auth";

const router = Router();

// GET /districts
router.get("/", async (_req: AuthRequest, res: Response): Promise<void> => {
  const districts = await prisma.district.findMany({
    orderBy: { name: "asc" },
    include: { floodZone: true },
  });
  res.json({ success: true, data: districts });
});

// GET /admin/stats — ringkasan sistem (admin only)
router.get("/stats", authenticate, requireAdmin, async (_req: AuthRequest, res: Response): Promise<void> => {
  const [
    totalReports,
    activeReports,
    totalUsers,
    totalVerifications,
    deepestReport,
    recentReports,
  ] = await Promise.all([
    prisma.floodReport.count(),
    prisma.floodReport.count({ where: { status: { in: ["active", "surging"] } } }),
    prisma.user.count(),
    prisma.reportVerification.count(),
    prisma.floodReport.findFirst({ where: { status: { in: ["active", "surging"] } }, orderBy: { waterDepthCm: "desc" }, include: { district: true } }),
    prisma.floodReport.findMany({ take: 5, orderBy: { createdAt: "desc" }, include: { district: { select: { name: true } } } }),
  ]);

  const byDistrict = await prisma.floodReport.groupBy({
    by: ["districtId"],
    where: { status: { in: ["active", "surging"] } },
    _avg: { waterDepthCm: true },
    _count: { id: true },
  });

  res.json({
    success: true,
    data: {
      totalReports,
      activeReports,
      totalUsers,
      totalVerifications,
      deepestReport,
      recentReports,
      byDistrict,
    },
  });
});

export default router;
