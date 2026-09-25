# ReceptionAI

AI-powered WhatsApp receptionist for small private clinics in Kerala. Clinics subscribe to a plan (Starter / Growth / Pro) and receive an AI-powered WhatsApp number that handles patient bookings, token queue management, and appointment reminders — without any staff involvement.

## Architecture

- **Frontend** — React SPA (Vite + Tailwind), served as static files from Nginx at `/var/www/booking-platform/frontend/`. Communicates with the backend exclusively via REST at `/api/v1/`.
- **Backend** — Node.js/Express, running under PM2 as `receptionai-backend` on port 3001. All business logic, AI orchestration, and WhatsApp webhook processing.
- **Database** — PostgreSQL. Multi-tenant: every table has a `tenant_id` column. Migrations in `backend/database/migrations/`.
- **Cache / locks** — Redis. Message deduplication (5-min TTL), slot locking during concurrent bookings.
- **AI** — Google Gemini 2.5 Flash (Starter/Growth) or Pro (Pro plan). Called on every incoming WhatsApp message via function calling: `check_doctor_availability`, `create_token_booking`, `cancel_booking`, `get_patient_info`.
- **WhatsApp** — Meta Cloud API. Webhooks at `/webhook`, HMAC-SHA256 verified against `META_APP_SECRET`.

## Data flow — incoming patient message

1. Meta sends POST to `/webhook` → HMAC signature verified → message parsed
2. `ai.service.js` builds system prompt (schedule, KB snippets, doctor profiles per plan)
3. Gemini responds with a function call → `ai.executor.js` executes it
4. Response sent back to patient via WhatsApp

## Branches

- `develop` — active development. All work goes here.
- `main` — releases only. Never commit directly to main.

## Local setup

Copy `backend/.env.example` to `backend/.env` and fill in all values. Then:
- Backend: `cd backend && npm install && npm run dev` (port 3001)
- Frontend: `cd frontend && npm install && npm run dev` (port 5173)

## Production deploy

**Backend** (SSH into server, then):
```
cd ~/receptionai/backend && git pull origin develop && pm2 restart receptionai-backend
```

**Frontend** (PowerShell — from `d:\Appointment Automation\frontend`):
```
cd "d:\Appointment Automation\frontend"
$env:VITE_API_URL="https://receptionai.in/api/v1"
npm run build
ssh -i "C:\Users\jinuj\Downloads\receptionai_new.key" jinujoee9633@35.234.212.43 "rm -rf /var/www/booking-platform/frontend/assets/*"
scp -i "C:\Users\jinuj\Downloads\receptionai_new.key" -r "d:\Appointment Automation\frontend\dist\*" jinujoee9633@35.234.212.43:/var/www/booking-platform/frontend/
```

**Server details:**
- IP: `35.234.212.43` (GCP asia-south1, e2-medium)
- SSH key: `C:\Users\jinuj\Downloads\receptionai_new.key`
- SSH user: `jinujoee9633`

## Environment variables

See `backend/.env.example`. Required at startup: `JWT_SECRET`, `DATABASE_URL`, `REDIS_URL`, `PORT`, `NODE_ENV`. Server refuses to start if any are missing.
