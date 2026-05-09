import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";

const prisma = new PrismaClient();

async function main() {
  console.log("🌱 Seeding database...");

  // ── Districts ──────────────────────────────────────
  const districts = await Promise.all([
    prisma.district.upsert({ where: { name: "Ilir Barat I" },    update: {}, create: { name: "Ilir Barat I",    latitude: -2.9833, longitude: 104.7333 } }),
    prisma.district.upsert({ where: { name: "Ilir Barat II" },   update: {}, create: { name: "Ilir Barat II",   latitude: -2.9667, longitude: 104.7167 } }),
    prisma.district.upsert({ where: { name: "Ilir Timur I" },    update: {}, create: { name: "Ilir Timur I",    latitude: -2.9667, longitude: 104.7667 } }),
    prisma.district.upsert({ where: { name: "Ilir Timur II" },   update: {}, create: { name: "Ilir Timur II",   latitude: -2.9833, longitude: 104.7833 } }),
    prisma.district.upsert({ where: { name: "Ilir Timur III" },  update: {}, create: { name: "Ilir Timur III",  latitude: -2.9750, longitude: 104.7750 } }),
    prisma.district.upsert({ where: { name: "Seberang Ulu I" },  update: {}, create: { name: "Seberang Ulu I",  latitude: -3.0000, longitude: 104.7667 } }),
    prisma.district.upsert({ where: { name: "Seberang Ulu II" }, update: {}, create: { name: "Seberang Ulu II", latitude: -3.0167, longitude: 104.7833 } }),
    prisma.district.upsert({ where: { name: "Kemuning" },        update: {}, create: { name: "Kemuning",        latitude: -2.9833, longitude: 104.7500 } }),
    prisma.district.upsert({ where: { name: "Sukarami" },        update: {}, create: { name: "Sukarami",        latitude: -2.9333, longitude: 104.7167 } }),
    prisma.district.upsert({ where: { name: "Sematang Borang" }, update: {}, create: { name: "Sematang Borang", latitude: -2.9167, longitude: 104.7500 } }),
  ]);
  console.log(`✅ ${districts.length} districts seeded`);

  // ── Admin user ─────────────────────────────────────
  const admin = await prisma.user.upsert({
    where: { email: "admin@sibanjir.id" },
    update: {},
    create: {
      name: "Admin BPBD",
      email: "admin@sibanjir.id",
      password: await bcrypt.hash("Admin@123", 12),
      role: "admin",
      reputationScore: 1000,
      phone: "+6271123456",
    },
  });

  const user1 = await prisma.user.upsert({
    where: { email: "budi@gmail.com" },
    update: {},
    create: {
      name: "Budi Santoso",
      email: "budi@gmail.com",
      password: await bcrypt.hash("User@123", 12),
      reputationScore: 850,
      phone: "+628112345678",
    },
  });

  const user2 = await prisma.user.upsert({
    where: { email: "ani@gmail.com" },
    update: {},
    create: {
      name: "Ani Rahayu",
      email: "ani@gmail.com",
      password: await bcrypt.hash("User@123", 12),
      reputationScore: 320,
      phone: "+628198765432",
    },
  });
  console.log("✅ Users seeded");

  // ── Flood reports ──────────────────────────────────
  const report1 = await prisma.floodReport.create({
    data: {
      userId: user1.id,
      districtId: districts[2].id, // Ilir Timur I
      title: "Banjir Jl. Sudirman Simpang Charitas",
      description: "Air naik cepat setelah hujan deras 2 jam. Kendaraan roda dua tidak bisa lewat. Warga mulai mengungsi.",
      latitude: -2.9681,
      longitude: 104.7456,
      address: "Jl. Sudirman, depan RS Charitas, Ilir Timur I",
      waterDepthCm: 80,
      severityLevel: "high",
      roadAccess: "impassable",
      waterCurrent: "moderate",
      status: "active",
      confidenceScore: 87.5,
    },
  });

  const report2 = await prisma.floodReport.create({
    data: {
      userId: user2.id,
      districtId: districts[7].id, // Kemuning
      title: "Genangan Air Sekip Bendung Blok C",
      description: "Genangan air mulai masuk ke halaman rumah warga di blok C. Ketinggian masih aman untuk dilalui mobil.",
      latitude: -2.9850,
      longitude: 104.7280,
      address: "Sekip Bendung Blok C, Kemuning",
      waterDepthCm: 30,
      severityLevel: "low",
      roadAccess: "difficult",
      waterCurrent: "calm",
      status: "active",
      confidenceScore: 62.0,
    },
  });

  await prisma.floodReport.create({
    data: {
      userId: user1.id,
      districtId: districts[3].id, // Ilir Timur II
      title: "Banjir Jl. R. Sukamto depan PTC Mall",
      description: "Terdapat genangan di depan mall PTC, lalu lintas melambat. Motor masih bisa lewat.",
      latitude: -2.9600,
      longitude: 104.7650,
      address: "Jl. R. Sukamto, depan PTC Mall, Ilir Timur II",
      waterDepthCm: 40,
      severityLevel: "medium",
      roadAccess: "motorcycle_only",
      waterCurrent: "slow",
      status: "active",
      confidenceScore: 71.3,
    },
  });
  console.log("✅ Flood reports seeded");

  // ── Verifications ──────────────────────────────────
  await prisma.reportVerification.createMany({
    data: [
      { reportId: report1.id, userId: user2.id,  vote: "confirm", comment: "Saya konfirmasi, motor saya nyaris mogok di sana." },
      { reportId: report1.id, userId: admin.id,  vote: "confirm", comment: "Tim BPBD sudah cek lokasi, benar." },
      { reportId: report2.id, userId: user1.id,  vote: "confirm", comment: "Lewat tadi, genangan ada tapi masih aman." },
    ],
    skipDuplicates: true,
  });
  console.log("✅ Verifications seeded");

  // ── Report updates (timeline) ──────────────────────
  await prisma.reportUpdate.createMany({
    data: [
      { reportId: report1.id, createdBy: user1.id,  waterDepthCm: 30, status: "active",  description: "Awal hujan, genangan mulai terbentuk." },
      { reportId: report1.id, createdBy: user1.id,  waterDepthCm: 60, status: "surging", description: "Air terus naik, hujan belum berhenti." },
      { reportId: report1.id, createdBy: admin.id,  waterDepthCm: 80, status: "surging", description: "Tim pompa air sudah dikerahkan ke lokasi." },
      { reportId: report2.id, createdBy: user2.id,  waterDepthCm: 20, status: "active",  description: "Genangan masih kecil, masuk halaman warga." },
      { reportId: report2.id, createdBy: user2.id,  waterDepthCm: 30, status: "active",  description: "Naik sedikit setelah hujan sore." },
    ],
    skipDuplicates: true,
  });
  console.log("✅ Report updates seeded");

  // ── Flood zones ────────────────────────────────────
  await prisma.floodZone.upsert({
    where: { districtId: districts[2].id },
    update: { riskLevel: "high", avgDepth: 65, reportCount: 5 },
    create: { districtId: districts[2].id, riskLevel: "high", avgDepth: 65, reportCount: 5 },
  });
  await prisma.floodZone.upsert({
    where: { districtId: districts[7].id },
    update: { riskLevel: "medium", avgDepth: 30, reportCount: 3 },
    create: { districtId: districts[7].id, riskLevel: "medium", avgDepth: 30, reportCount: 3 },
  });
  await prisma.floodZone.upsert({
    where: { districtId: districts[3].id },
    update: { riskLevel: "medium", avgDepth: 40, reportCount: 2 },
    create: { districtId: districts[3].id, riskLevel: "medium", avgDepth: 40, reportCount: 2 },
  });
  console.log("✅ Flood zones seeded");

  // ── Notifications ──────────────────────────────────
  await prisma.notification.createMany({
    data: [
      { userId: user1.id, title: "Laporan Anda Diverifikasi", message: "Laporan banjir di Jl. Sudirman Anda telah diverifikasi oleh tim BPBD.", type: "verification" },
      { userId: user2.id, title: "Peringatan: Kenaikan Debit Air", message: "Terpantau kenaikan debit air di area Sukarami. Status Siaga 2.", type: "alert" },
      { userId: user1.id, title: "Laporan Banjir Baru di Sekitar Anda", message: "Laporan baru genangan 30cm di Ilir Barat I.", type: "report_update" },
    ],
  });
  console.log("✅ Notifications seeded");

  console.log("\n🎉 Database seeded successfully!");
  console.log("   Admin  → admin@sibanjir.id  / Admin@123");
  console.log("   User 1 → budi@gmail.com     / User@123");
  console.log("   User 2 → ani@gmail.com      / User@123");
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(() => prisma.$disconnect());
