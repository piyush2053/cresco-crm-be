# CRM Cresco Backend

This backend is designed for a simple Node.js + Express + PostgreSQL CRM system with role-based access control, email OTP, Excel import, and weekly report delivery.

## Setup

1. Start PostgreSQL and backend with Docker Compose:
   ```bash
   docker compose up --build
   ```

2. Initialize the database once:
   ```bash
   psql -h localhost -U postgres -d cresco-local -f db-init.sql
   ```

3. Run the backend locally:
   ```bash
   cd crm-cresco-be
   npm install
   npm run dev
   ```

## Notes

- Backend configuration is stored in `src/config.js`.
- No runtime environment variables are required for database connection or SMTP settings.
- Frontend uses a single API URL configuration.


Uske baad login use karo:
Email: admin@cresco.local
Password: Cresco@2026

local pr db connect krne ke liye Alg bash me 
ye chala dena

$ ssh -N -L 55432:127.0.0.1:5432 deploy@50.6.45.98