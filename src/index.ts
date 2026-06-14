import "dotenv/config"
import express from "express"
import cors from "cors"
import morgan from "morgan"

import authRouter from "./routes/auth"
import reportsRouter from "./routes/reports"
import mapRouter from "./routes/map"
import notificationsRouter from "./routes/notifications"
import districtsRouter from "./routes/districts"
import usersRouter from "./routes/users"
import weatherRouter from "./routes/weather"
import { errorHandler, notFound } from "./middleware/error"

const app = express()
const PORT = process.env.PORT || 3001

// ── Global middleware ──────────────────────────────────────────────────────
app.use(cors({ origin: process.env.CORS_ORIGIN || "*" }))
app.use(express.json({ limit: "10mb" }))
app.use(express.urlencoded({ extended: true }))
app.use(morgan(process.env.NODE_ENV === "production" ? "combined" : "dev"))
app.use("/uploads", express.static("uploads"))

// ── Health check ───────────────────────────────────────────────────────────
app.get("/health", (_req, res) => {
  res.json({ status: "ok", service: "sibanjir-be", timestamp: new Date().toISOString() })
})

// ── Routes ─────────────────────────────────────────────────────────────────
app.use("/auth", authRouter)
app.use("/reports", reportsRouter)
app.use("/map", mapRouter)
app.use("/notifications", notificationsRouter)
app.use("/districts", districtsRouter)
app.use("/users", usersRouter)
app.use("/weather", weatherRouter)

// ── Error handling ─────────────────────────────────────────────────────────
app.use(notFound)
app.use(errorHandler)

app.listen(PORT, () => {
  console.log(`🚀 sibanjir-be running on http://localhost:${PORT}`)
  console.log(`   ENV: ${process.env.NODE_ENV || "development"}`)
})

export default app
