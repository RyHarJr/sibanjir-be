# SiBanjir Palembang — Backend API

REST API backend untuk **Sistem Informasi Banjir Kota Palembang**, memungkinkan warga melaporkan, memverifikasi, dan memantau kondisi banjir secara real-time.

## Tech Stack

| Layer       | Teknologi                     |
| ----------- | ----------------------------- |
| Runtime     | Node.js + TypeScript          |
| Framework   | Express 4                     |
| Database    | MySQL (via Prisma ORM)        |
| Auth        | JWT (jsonwebtoken + bcryptjs) |
| Validation  | express-validator             |
| File Upload | Multer                        |
| Logging     | Morgan                        |

## Fitur Utama

- **Autentikasi** — Register & login dengan JWT, role-based access (user/admin)
- **Laporan Banjir** — CRUD laporan dengan foto, kedalaman air, tingkat keparahan, akses jalan, arus air
- **Verifikasi Laporan** — Sistem voting (confirm/reject) oleh komunitas
- **Peta Banjir** — Endpoint data geospasial untuk visualisasi peta
- **Cuaca** — Integrasi data cuaca (XML parser)
- **Notifikasi** — Sistem notifikasi per-user (alert, update, verifikasi, sistem)
- **Manajemen Kecamatan** — Data kecamatan dengan koordinat & zona banjir
- **Manajemen User** — Admin panel untuk kelola pengguna

## Database Schema

```
User ──< FloodReport ──< ReportVerification
                    ──< ReportUpdate
                    ──< ReportPhoto
District ──< FloodReport
         ──< FloodZone
User ──< Notification
```

**Models:** User, District, FloodReport, ReportVerification, ReportUpdate, ReportPhoto, FloodZone, Notification

## API Endpoints

| Prefix           | Deskripsi              |
| ---------------- | ---------------------- |
| `GET /health`    | Health check           |
| `/auth`          | Register, login        |
| `/reports`       | CRUD laporan banjir    |
| `/map`           | Data peta & geospasial |
| `/weather`       | Data cuaca             |
| `/notifications` | Notifikasi user        |
| `/districts`     | Data kecamatan         |
| `/users`         | Manajemen user (admin) |

## Struktur Direktori

```
sibanjir-be/
├── prisma/
│   ├── schema.prisma      # Database schema
│   ├── seed.ts            # Seed data
│   └── migrations/        # Migration files
├── src/
│   ├── index.ts           # Entry point + Express setup
│   ├── routes/
│   │   ├── auth.ts        # Autentikasi
│   │   ├── reports.ts     # Laporan banjir
│   │   ├── map.ts         # Data peta
│   │   ├── weather.ts     # Data cuaca
│   │   ├── notifications.ts
│   │   ├── districts.ts
│   │   └── users.ts
│   ├── middleware/
│   │   ├── auth.ts        # JWT verification
│   │   ├── error.ts       # Error handler
│   │   └── validate.ts    # Validation middleware
│   └── lib/               # Utilities
├── uploads/               # Uploaded files
├── .env.example
├── package.json
└── tsconfig.json
```

## Setup & Development

### Prerequisites

- Node.js ≥ 18
- MySQL ≥ 8.0

### Instalasi

```bash
# 1. Install dependencies
npm install

# 2. Setup environment
cp .env.example .env
# Edit .env sesuai konfigurasi lokal

# 3. Generate Prisma client
npm run db:generate

# 4. Jalankan migrasi database
npm run db:migrate

# 5. (Opsional) Seed data awal
npm run db:seed
```

### Environment Variables

```env
NODE_ENV=development
PORT=3001
DATABASE_URL="mysql://root:password@localhost:3306/sibanjir"
JWT_SECRET=your_secret_here
JWT_EXPIRES_IN=7d
UPLOAD_DIR=uploads
MAX_FILE_SIZE=5242880
```

### Scripts

| Command               | Deskripsi                       |
| --------------------- | ------------------------------- |
| `npm run dev`         | Development server (hot reload) |
| `npm run build`       | Compile TypeScript              |
| `npm start`           | Production server               |
| `npm run db:generate` | Generate Prisma client          |
| `npm run db:migrate`  | Migrasi database                |
| `npm run db:seed`     | Seed data                       |
| `npm run db:studio`   | Prisma Studio (DB GUI)          |

## License

Private — SiBanjir Palembang
