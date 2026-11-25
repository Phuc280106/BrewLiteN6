# BrewLite

Ứng dụng đặt đồ uống trực tuyến và điều phối quầy pha chế (Barista KDS), xây dựng bằng Next.js (Frontend), NestJS (Backend) và PostgreSQL (Prisma ORM).

## 1. Yêu cầu môi trường

- Node.js >= 20 (khuyến nghị Node 22)
- Docker Desktop (hoặc PostgreSQL 16+)

## 2. Cấu trúc thư mục

- `backend/`: RESTful API (NestJS), Prisma schema/migrations/seed, unit test (Vitest)
- `frontend/`: Giao diện người dùng và màn hình Barista (Next.js, Tailwind CSS, Zustand)
- `docker-compose.yml`: Chạy PostgreSQL (cổng `5433`), Backend (`3001`) và Frontend (`3000`)

## 3. Hướng dẫn chạy dự án

### Cách 1: Chạy toàn bộ bằng Docker Compose

```bash
docker compose up -d --build
```

- Frontend: `http://localhost:3000`
- Backend API & Swagger: `http://localhost:3001/swagger`

### Cách 2: Chạy Database bằng Docker, dev Backend/Frontend trên máy

1. Khởi động PostgreSQL container (cổng `5433`):

```bash
docker compose up -d postgres
```

2. Cấu hình file `backend/.env`:

```env
PORT=3001
DATABASE_URL="postgresql://postgres:123456@localhost:5433/brewlite"
```
3. Cài thư viện, chạy migration và nạp dữ liệu mẫu:

```bash
cd backend
npm install
npx prisma migrate deploy
npx prisma db seed
npm run start:dev
```

4. Mở terminal khác để chạy Frontend:

```bash
cd frontend
npm install
npm run dev
```

## 4. Tài khoản thử nghiệm

| Vai trò | Email | Mật khẩu |
| :--- | :--- | :--- |
| Barista | `barista@brewlite.vn` | `123456` |
| Khách hàng 1 | `user1@brewlite.vn` | `123456` |
| Khách hàng 2 | `user2@brewlite.vn` | `123456` |
