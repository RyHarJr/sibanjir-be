import { Router } from "express";
import { prisma } from "../lib/prisma";
import { authenticate, requireAdmin, AuthRequest } from "../middleware/auth";
import { Response } from "express";

const router = Router();

// GET /users - Fetch all users for Admin
router.get("/", authenticate, requireAdmin, async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const users = await prisma.user.findMany({
      select: {
        id: true,
        name: true,
        email: true,
        phone: true,
        role: true,
        reputationScore: true,
        createdAt: true,
        _count: {
          select: { reports: true, verifications: true }
        }
      },
      orderBy: { createdAt: 'desc' }
    });
    res.json({ success: true, data: users });
  } catch (error) {
    console.error("Failed to fetch users", error);
    res.status(500).json({ success: false, message: "Server error fetching users" });
  }
});

// PATCH /users/:id/role - Update user role
router.patch("/:id/role", authenticate, requireAdmin, async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const userId = parseInt(req.params.id, 10);
    const { role } = req.body;
    
    if (role !== "admin" && role !== "user") {
      res.status(400).json({ success: false, message: "Invalid role" });
      return;
    }

    const updatedUser = await prisma.user.update({
      where: { id: userId },
      data: { role },
      select: { id: true, name: true, role: true }
    });

    res.json({ success: true, message: "Role updated successfully", data: updatedUser });
  } catch (error) {
    console.error("Failed to update user role", error);
    res.status(500).json({ success: false, message: "Server error updating role" });
  }
});

export default router;
