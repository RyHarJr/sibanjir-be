import { Router } from "express";
import { body } from "express-validator";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import { prisma } from "../lib/prisma";
import { validate } from "../middleware/validate";
import { authenticate, AuthRequest } from "../middleware/auth";
import { Response } from "express";

const router = Router();

// POST /auth/register
router.post(
  "/register",
  [
    body("name").trim().notEmpty().withMessage("Nama wajib diisi"),
    body("email").isEmail().withMessage("Email tidak valid"),
    body("password").isLength({ min: 6 }).withMessage("Password minimal 6 karakter"),
    body("phone").optional().isMobilePhone("id-ID").withMessage("Nomor HP tidak valid"),
  ],
  validate,
  async (req: AuthRequest, res: Response): Promise<void> => {
    const { name, email, password, phone } = req.body;

    const existing = await prisma.user.findUnique({ where: { email } });
    if (existing) {
      res.status(409).json({ success: false, message: "Email sudah terdaftar" });
      return;
    }

    const hashed = await bcrypt.hash(password, 12);
    const user = await prisma.user.create({
      data: { name, email, password: hashed, phone },
      select: { id: true, name: true, email: true, phone: true, role: true, reputationScore: true, createdAt: true },
    });

    const token = jwt.sign(
      { id: user.id, role: user.role },
      process.env.JWT_SECRET!,
      { expiresIn: "7d" }
    );

    res.status(201).json({ success: true, message: "Registrasi berhasil", data: { user, token } });
  }
);

// POST /auth/login
router.post(
  "/login",
  [
    body("email").isEmail().withMessage("Email tidak valid"),
    body("password").notEmpty().withMessage("Password wajib diisi"),
  ],
  validate,
  async (req: AuthRequest, res: Response): Promise<void> => {
    const { email, password } = req.body;

    const user = await prisma.user.findUnique({ where: { email } });
    if (!user || !(await bcrypt.compare(password, user.password))) {
      res.status(401).json({ success: false, message: "Email atau password salah" });
      return;
    }

    const token = jwt.sign(
      { id: user.id, role: user.role },
      process.env.JWT_SECRET!,
      { expiresIn: "7d" }
    );

    res.json({
      success: true,
      message: "Login berhasil",
      data: {
        user: { id: user.id, name: user.name, email: user.email, role: user.role, reputationScore: user.reputationScore, avatar: user.avatar },
        token,
      },
    });
  }
);

// GET /auth/me
router.get("/me", authenticate, async (req: AuthRequest, res: Response): Promise<void> => {
  const user = await prisma.user.findUnique({
    where: { id: req.user!.id },
    select: {
      id: true, name: true, email: true, phone: true, avatar: true,
      role: true, reputationScore: true, createdAt: true,
      _count: { select: { reports: true, verifications: true } },
    },
  });
  res.json({ success: true, data: user });
});

export default router;
