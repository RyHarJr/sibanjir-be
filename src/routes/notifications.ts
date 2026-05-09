import { Router, Response } from "express";
import { prisma } from "../lib/prisma";
import { authenticate, AuthRequest } from "../middleware/auth";

const router = Router();

// GET /notifications — notifikasi milik user yang login
router.get("/", authenticate, async (req: AuthRequest, res: Response): Promise<void> => {
  const { unread } = req.query;

  const notifications = await prisma.notification.findMany({
    where: {
      userId: req.user!.id,
      ...(unread === "true" ? { isRead: false } : {}),
    },
    orderBy: { createdAt: "desc" },
    take: 50,
  });

  const unreadCount = await prisma.notification.count({
    where: { userId: req.user!.id, isRead: false },
  });

  res.json({ success: true, data: notifications, meta: { unreadCount } });
});

// PATCH /notifications/read-all — tandai semua dibaca
router.patch("/read-all", authenticate, async (req: AuthRequest, res: Response): Promise<void> => {
  await prisma.notification.updateMany({
    where: { userId: req.user!.id, isRead: false },
    data: { isRead: true },
  });
  res.json({ success: true, message: "Semua notifikasi ditandai dibaca" });
});

// PATCH /notifications/:id/read — tandai satu notifikasi dibaca
router.patch("/:id/read", authenticate, async (req: AuthRequest, res: Response): Promise<void> => {
  const notif = await prisma.notification.findUnique({ where: { id: Number(req.params.id) } });
  if (!notif || notif.userId !== req.user!.id) {
    res.status(404).json({ success: false, message: "Notifikasi tidak ditemukan" });
    return;
  }
  await prisma.notification.update({ where: { id: notif.id }, data: { isRead: true } });
  res.json({ success: true, message: "Notifikasi ditandai dibaca" });
});

export default router;
