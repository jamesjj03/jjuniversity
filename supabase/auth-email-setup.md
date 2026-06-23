# Supabase Auth Email Setup

The app-side email verification flow is wired through `/auth/callback`.

Before pushing `supabase/config.toml` to the linked Supabase project, set a real SMTP sender in the deployment environment:

- `SUPABASE_SMTP_HOST`
- `SUPABASE_SMTP_USER`
- `SUPABASE_SMTP_PASS`
- `SUPABASE_SMTP_ADMIN_EMAIL`
- `SUPABASE_SMTP_SENDER_NAME`

The current config is set for Resend SMTP:

- Custom SMTP: enabled
- Host: `smtp.resend.com`
- Port: `465`
- User: `resend`
- Password: your Resend API key
- Sender: `no-reply@jjuniversity.com`

After the sender is ready, apply the config with:

```powershell
npx supabase config push --project-ref nzlmnbppynjmutuukmbt
```

Then test from `/account` with a fresh email address:

1. Create an account.
2. Confirm the email arrives.
3. Open the verification link.
4. Confirm `/account` shows "Email verified. Cloud sync is ready."

Supabase requires auth redirect URLs to match the allow-list. This repo includes:

- `https://jjuniversity.com/auth/callback`
- `https://www.jjuniversity.com/auth/callback`
- `http://localhost:3000/auth/callback`
- `http://localhost:3100/auth/callback`
