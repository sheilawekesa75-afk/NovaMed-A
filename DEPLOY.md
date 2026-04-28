# NovaMed AI — Render Deployment Guide

## Architecture on Render
```
GitHub Repo
    └── backend/         ← Render Web Service (Node.js)
    └── frontend/        ← Built by backend's build script → served as static files
```
Single Render Web Service serves both the API and the React frontend.

---

## Step 1 — Push to GitHub

```bash
git init
git add .
git commit -m "Initial commit"
git remote add origin https://github.com/YOUR_USERNAME/novamed-ai.git
git push -u origin main
```

---

## Step 2 — Create Render Postgres Database

1. Go to [render.com](https://render.com) → **New → PostgreSQL**
2. Name: `novamed-db` | Plan: **Free**
3. After creation, copy the **Internal Database URL**

---

## Step 3 — Create Render Web Service

1. **New → Web Service** → Connect your GitHub repo
2. Settings:
   - **Build Command**: `npm run build`
   - **Start Command**: `npm start`
   - **Plan**: Free (or Starter for always-on)

---

## Step 4 — Set Environment Variables in Render Dashboard

Go to your Web Service → **Environment** tab and add:

| Key | Value |
|-----|-------|
| `NODE_ENV` | `production` |
| `DATABASE_URL` | *(paste Internal DB URL from Step 2)* |
| `JWT_SECRET` | *(generate: `openssl rand -base64 32`)* |
| `AI_PROVIDER` | `groq` |
| `GROQ_API_KEY` | *(your Groq key from console.groq.com)* |
| `ADMIN_EMAIL` | `admin@yourdomain.com` |
| `ADMIN_PASSWORD` | *(strong password)* |
| `ADMIN_NAME` | `System Administrator` |
| `OTP_VISIBLE` | `false` |
| `OTP_TTL_MIN` | `10` |

> **Never commit `.env` to GitHub.** Use `.env.example` as a template.

---

## Step 5 — Initialize the Database

After first deploy, open the Render **Shell** tab for your service and run:

```bash
node src/db/init.js
```

This creates all tables and the super-admin account.

---

## Step 6 — Verify

Visit `https://your-service.onrender.com/api/health` — should return `{"ok":true}`.

---

## Local Development

```bash
# Backend
cd backend
cp .env.example .env      # fill in your local values
npm install
npm run db:init           # first time only
npm start                 # runs on :4000

# Frontend (separate terminal)
cd frontend
npm install
npm run dev               # runs on :5173, proxies /api to :4000
```

---

## Notes
- Render free tier **spins down** after 15 min inactivity — first request may be slow.
- Uploaded images in `backend/uploads/` are **not persisted** on Render free tier (ephemeral filesystem). For production, integrate an S3-compatible store.
- To use Gemini or OpenAI instead of Groq, change `AI_PROVIDER` env var and set the matching API key.
