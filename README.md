# Scoutly – WhatsApp demo

Scoutly links people who **need** something with people who **offer** it:
carpenters, mechanics, plumbers, hairdressers and anyone selling things.
Everything happens on one WhatsApp number. Nobody downloads an app.

## How it works
1. **Someone posts what they need, with a budget.** Tap *I'm looking for…*, or just type it, e.g. "barber in town, $5"
   or "Toyota Vitz under $3,000". The budget makes every lead a qualified lead.
2. **Scoutly sends it to matching providers** in the same category, nearest first.
   Providers who cover all of Bulawayo get jobs from every area.
3. **A provider or seller taps *Interested*.** They see the budget first. The customer sees their profile: rating, jobs done, asking price, description.
4. **The customer chooses.** *Swap numbers* sends each of them the other's number and a chat link.
   *No thanks* keeps the customer's number private. *Report* flags the provider.
5. **After the job**, the customer rates the provider in *My posts*. Ratings show on future leads.

The customer's number is never shared until they say yes.

Sellers list once instead of posting in WhatsApp and Facebook groups and hoping:
every buyer who later posts in their category is sent to them.

**No liability:** people agree at sign-up, and are reminded on every swap, that
"Scoutly only connects you. We aren't part of any deal and aren't responsible for it."
(Have a local lawyer check the wording before launch.)

## How it makes money: credits, paid by both sides
- 1 credit = 1 number swap. **Both** the customer and the provider use 1 credit when they swap numbers.
- When a provider taps *Interested*, 1 credit is **held**. Swapped → spent. Declined, expired or post closed → given back.
- If either side has no credits, they're asked to buy some, and the lead or swap continues by itself after payment.
- Everyone gets **3 free credits** on sign-up. Bundles (placeholder prices in `src/data.ts`):

| Bundle | Price | Per swap |
|---|---|---|
| 2 credits | $1.00 | $0.50 |
| 5 credits | $2.00 | $0.40 |
| 15 credits | $5.00 | $0.33 |

- Credits are bought with EcoCash through Paynow and added **only after the server confirms payment**.
  With no Paynow keys, payments are simulated and confirm after ~6 seconds.

## Rules built in
- Up to 5 providers get each post. At 3 contacts the post closes itself.
- Posts stay open 7 days. A provider who joins later still gets open posts in their category.
- Leads close after 48 hours without a reply, and held credits come back.
- You never get a lead for your own post. Max 3 active listings per person.
- 3 reports pause a listing automatically. The admin phone is told about every report.
- Unfinished posts are cleared after 30 minutes. Anything unexpected → "Sorry, I didn't get that" plus the last options.

## Categories and areas
Carpentry & furniture · Mechanic & car repair · Plumbing · Electrical & solar · Building & painting ·
Hair & beauty · Cars & car parts · Phones & electronics · Clothes & shoes · Something else.

Areas: City centre, Northern, Eastern, Southern and Western suburbs, Outside Bulawayo.
Change both in `src/data.ts`.

## Demo with one phone
`SAMPLE_PROVIDERS=true` loads 8 fictional providers (e.g. *Thabo M.*, carpenter, ⭐ 4.7).
They reply *Interested* by themselves after a few seconds and are marked
"Sample provider for the demo". Their numbers start with 26300, so they're never real and never messaged.
**Set `SAMPLE_PROVIDERS=false` before real people use it.**

For the full demo, use 2–3 phones: one customer, one provider, and optionally the admin.

**Demo script**
1. Phone A (provider): *hi* → agree → name → area → *I offer or sell…* → Carpentry → describe → *All of Bulawayo* → Skip → *List me*.
2. Phone B (customer): *hi* → agree → name → same area → type *my wardrobe door is broken* → Carpentry → *This week* → type *$40* → *Post it*.
3. Phone A gets the lead → *Interested*. Phone B sees two profiles (Joe and sample Thabo).
4. Phone B → *Swap numbers* on Phone A's profile. Both phones get each other's number.
5. Phone B → *My posts* → the post → *Rate someone* → 5 stars. Phone A is told.
6. Phone A → *My credits* → 5 credits → pay. Balance goes up after payment.
7. Admin phone types **STATS**.

## Before the demo
- Every demo phone must be added as a test recipient in Meta (API Setup → To) and must message the bot first.
  The test number can only send free-form messages within 24 hours of the person's last message.
- Leads to providers who haven't messaged in 24 hours need approved **templates** in v1.
  The demo doesn't use templates.

## Railway: reuse the Greens service (quickest)
Scoutly reads the same variables as Greens, so nothing new is needed:
1. Open the **Greens** service → **Settings → Source → Branch** → change `greens` to `scoutly`.
2. Wait for the deploy, then open `https://<greens domain>/health` → `{"ok":true,"app":"Scoutly",...}`.

The domain, verify token and Meta webhook stay the same. `STAFF_PHONE` becomes the admin phone
(reports + STATS). Greens' other variables are ignored. To go back to Greens, set the branch back to `greens`.

## Railway: run it as its own service
1. In your Railway project: **+ New → GitHub Repo → MediDrop**.
2. Open the new service → **Settings → Source → Branch** → `scoutly`.
3. **Variables → Raw Editor**: paste from `.env.example` and fill in the values
   (`WA_TOKEN`, `WA_PHONE_NUMBER_ID`, `WA_APP_SECRET` are the same as MediDrop's).
4. **Settings → Networking → Generate Domain**.
5. In Meta → WhatsApp → Configuration → Webhook: callback URL `https://<domain>/webhook`,
   verify token `scoutly-demo-2026` → **Verify and save**. Subscribe to **messages**.
6. Open `https://<domain>/health` → `{"ok":true,...}`.

One WhatsApp number can point to one webhook at a time. To switch back, put the
MediDrop or Greens address back in Meta's webhook.

## Run locally
```
npm install
npm test          # unit tests: matching, credits, leads, limits
npm run simulate  # full 4-phone demo on a fake WhatsApp, 50 checks
npm start
```

## Not in the demo (v1)
Photos on listings (needs media download and re-upload) · Database (everything is in memory, so a restart clears it) · WhatsApp templates for leads
outside 24 hours · provider ID checks and verified badges ·
Ndebele/Shona · admin dashboard.
