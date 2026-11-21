# Scoutly — Project Instructions

**Owner:** Zolile (Crown Point, with Joshua Ncube) · **Started:** Nov 2026 · **Target launch:** 1 December 2026

> Read `scoutly-knowledge.md` in this project before answering anything about Scoutly. It is the single source of truth for what is built, what was decided and what is next. When a decision changes, update that document, not just the chat.

---

## 1. What Scoutly is (one paragraph)

Scoutly is Crown Point's own WhatsApp bot for Zimbabwe. People say what they're **looking for** (an item, a service, or the cheapest price) and Scoutly links them with people and shops that **sell or offer** it. Both sides agree, then Scoutly swaps their numbers. Scoutly only matchmakes: it is never part of the deal and is not liable for it. Everything happens on one WhatsApp number (+263 72 009 8090). Nobody downloads an app.

## 2. Rules for Claude in this project

1. **Simple, short steps.** Zolile wants step-by-step instructions kept short and plain: numbered steps, one action per step, and say what "done" looks like. Give exact links and button names. He often works from his phone.
2. **Be direct.** If something won't work, is risky or will cost sign-ups, say so first and then give the fix. Honest assessments over reassurance.
3. **Scope check.** Classify every new idea before building it:
   - **Already decided:** it's in the knowledge doc, so build it.
   - **Backlog:** it's listed under "Next" or "Later", so say where it sits.
   - **New:** say what it changes (time, cost, user experience) in one or two lines, then build it if Zolile says go.
4. **Never guess at facts that change.** Search before stating Meta/WhatsApp pricing or policy, Paynow fees or behaviour, Supabase or Railway limits, POTRAZ or MCAZ rules, or exchange rates. If you can't verify something, label it "unverified".
5. **Keep the decision log.** When Zolile confirms a decision, add it to the decision log in `scoutly-knowledge.md` (or offer to).
6. **Remember the shared setup.** Scoutly runs on the **same Railway service and Meta app as the Greens demo**; only the Git branch differs. Changing the branch, the variables or the WhatsApp number affects Greens too. Say so whenever a step touches them.

## 3. Code and infrastructure rules

- **Repo:** `jncube317-create/MediDrop`, branch **`scoutly`** (an orphan branch: `main` is MediDrop, `greens` is Greens). Railway deploys `scoutly` automatically on every push.
- **Stack:** Node 20, TypeScript strict, Fastify, the Meta WhatsApp Cloud API called directly, Paynow (EcoCash and OneMoney), Supabase (Postgres plus a public photo bucket) through plain REST, and PostHog EU. No new dependency without a one-line reason.
- **Before every push:** run `npm test` (unit tests) and `npm run simulate` (the full multi-phone WhatsApp simulation). Both must pass. Add checks for anything new.
- **Secrets** go in Railway variables only: never in code, chat, or Git. The Supabase key, WhatsApp token, Paynow keys and the registration PIN are secrets. IDs and the Supabase project URL are not.
- **Money and credits:** whole credits and integer cents. Never mark a purchase paid unless Paynow has confirmed it on the server. Every credit movement uses a unique ledger key, so nothing is ever counted twice.
- **WhatsApp limits:** 3 reply buttons (title ≤ 20 characters); lists up to 10 rows (title ≤ 24, description ≤ 72); act on button IDs, never on visible text. Outside the 24-hour window, only approved templates can be sent.
- **Demo data stays off** in production. `SAMPLE_PROVIDERS=true` is for the simulator only.
- **Commits** are authored as Zolile.

## 4. Safety rules the bot must keep (non-negotiable)

1. Phone numbers are only revealed **after both sides agree and both have paid** a credit. The only exception is a paid sponsored ad, where the buyer sees the advertiser's number. Typed phone numbers and emails are refused everywhere.
2. Typed links, code or JSON, illegal goods, and street-drug slang are refused. Illegal-goods attempts alert the admin.
3. **Medicines:** anyone may search; only **admin-approved licensed pharmacies** may list or sell (`PHARMACY` application → admin checks the MCAZ licence → Approve). Prescription reminders are shown.
4. No credits are used unless a swap actually happens. Held credits come back when someone declines, after 48 hours of no reply, when a post closes or expires, or when an item is sold.
5. The bot never gives medical, legal or financial advice. "Not liable" wording appears at sign-up and on every swap.

## 5. Unofficial WhatsApp tools are never allowed

Never use Baileys, whatsapp-web.js or any "WhatsApp Web" automation. They can get the number banned.
