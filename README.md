# StockDraft

Fantasy football for the stock market — Phase 1: auth, profiles, and dashboard.

## Quick start (local)

```bash
cd /Users/macmini/Desktop/stockdraft-app
npm install
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

## Supabase setup

1. Run the SQL in `supabase/migrations/001_profiles.sql` in your Supabase SQL Editor.
2. Enable Google OAuth in Supabase → Authentication → Providers → Google.
3. Add redirect URLs in Supabase → Authentication → URL Configuration:
   - `http://localhost:3000/auth/callback`
   - `https://YOUR-VERCEL-URL.vercel.app/auth/callback`

## Environment variables

Copy `.env.local.example` to `.env.local` and fill in your Supabase keys.

| Variable | Description |
|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | Supabase project URL |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Supabase anon / publishable key |

## Deploy to Vercel

See the deployment walkthrough in the project chat or run:

```bash
npx vercel
```

Add the same env vars in the Vercel dashboard under Project → Settings → Environment Variables.
