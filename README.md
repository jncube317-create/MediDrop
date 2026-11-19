# Scoutly – WhatsApp demo

Scoutly links people who are **looking for** something with people who **sell or offer** it:
cars, fridges, doors, clothes, carpenters, painters, mechanics, venues and more.
Everything happens on one WhatsApp number. Nobody downloads an app.

> *What are the chances that someone is looking to buy what you're selling today?*
> Scoutly sends them straight to you.

## The experience

**Sign-up (under a minute):** agree to the rules → first name → town → 3 free credits.

**Looking for an item** (cars, appliances, doors, clothes, phones, houses…):
1. Type it ("car under $9,000") or tap *Find something* → item → category.
2. Budget (or *Not sure yet*) → when (today, this week, **pick a date & time**, flexible) → in your town or anywhere in Zimbabwe.
3. Matches come back as **swipeable picture cards**: new and pre-loved side by side, best match then cheapest first,
   each with photo, price, condition, seller level, stars and ✅ verified badge.
   The last card can be a **Sponsored** card (e.g. car insurance for a car search).
4. *I'm interested* → the seller sees the buyer's budget and taps *Accept* → both get each other's number.
5. *Found what you needed?* → *Yes* closes the post so nobody else gets it.
6. No match yet? Opt in to an **alert** and get the card the moment someone lists one.

**Looking for a service** (painter, mechanic, venue, printing, moving…):
the post goes to matching providers in your town, they **send quotes**, and you get a
**compare list, cheapest first**, before choosing who to swap numbers with.

**Selling:** *Sell or offer* → item or service → name, description, **new / pre-loved: good / pre-loved: used**,
price, **up to 3 photos**, your town or all of Zimbabwe. Buyers who already posted (with alerts on) get it instantly.
Listing score tells sellers what to improve. *Mark as sold* in *My posts*.

**Swapping numbers costs credits on both sides:** 1 credit for most things, 2 for venues, 3 for cars and houses.
Credits are held while waiting and come back if the swap doesn't happen.

**Advertising:** anyone can create an ad (*📣 Advertise*): category to target, one line, photo, town or nationwide.
The admin approves or rejects it. Live ads show as the last card in matching searches and cost
**1 credit per tap** (each person's first tap only).

**Rules:** consent includes "no illegal goods or services" and "Scoutly only connects people, we aren't part
of any deal". The no-liability line is repeated on every swap. Posts with banned words (drugs, weapons, stolen,
fake documents, counterfeit, ivory…) are refused and the admin is told. 3 reports pause a listing. Type **TERMS**.

**Words that work anywhere** (any capitals): MENU, HI, HELP, TERMS, CREDITS, STOP (alerts off).

## Admin (from `ADMIN_PHONE`, or `STAFF_PHONE` on the Greens service)
| Command | What it does |
|---|---|
| `STATS` | People, posts, top searches, swaps, ads, credits sold |
| `LOOKUP N-1001` | A post, listing (O-501) or lead (L3) with both sides' names and numbers |
| `GRANT 0771234567 5` | Give credits (founding-seller packs paid in cash, refunds) |
| `VERIFY 0771234567` | ✅ badge for a seller you've checked |
| `ADS` | Ads waiting for approval, with Approve/Reject buttons |

Approve/Reject buttons also arrive by themselves when an ad is submitted.

## Seller levels
🆕 New → 🥉 Bronze (1+ swap) → 🥈 Silver (5+ swaps, ⭐4.0+) → 🥇 Gold (20+ swaps, ⭐4.5+). Stars only, from real swaps.

## Analytics (PostHog)
Set `POSTHOG_KEY` and events go to PostHog EU: `signed_up`, `post_created`, `post_no_match`, `cards_shown`,
`interest_sent`, `leads_sent`, `quote_sent`, `numbers_swapped`, `post_found`, `alert_opt_in`, `alert_sent`,
`listing_created`, `listing_sold`, `out_of_credits`, `credits_bought`, `sponsored_tap`, `ad_created`, `rated`, `reported`, `post_refused`.
People are a scrambled ID: no phone numbers, names or message text go to PostHog. Phone numbers stay in the bot
(use `LOOKUP`). No key = no tracking.

## Demo data
`SAMPLE_PROVIDERS=true` loads sample listings with real photos (BMW 745i $5,500, Nissan NP300 $8,500,
Defy combi fridge $520 new, woven mules $12, two steel doors $480 / $420 new), 10 sample service providers
(painters, mechanics, venue, printing, movers…) and 2 sample ads (Ace Paint Centre, Kudu Car Cover).
Prices are realistic samples from Nov 2026 research, not real offers. Sample sellers reply by themselves,
their numbers start with 26300 (never real) and they're marked as samples.
**Set `SAMPLE_PROVIDERS=false` before real people use it.** Get permission before showing other people's photos publicly.

## Demo script (2 phones + admin)
1. Phone A: *hi* → agree → name → Bulawayo → type **car under $9,000** → An item → Cars & bakkies → *9000* → This week → In Bulawayo → Post it.
   Swipe the BMW, the Nissan and the sponsored insurance card. Tap *I'm interested* on the Nissan → numbers swapped → *Yes, close my post*.
2. Phone A: type **fridge** → item → Fridges & appliances → *350* → Flexible → Post → *Alert me*.
3. Phone B: *Sell or offer* → Sell an item → Fridges → name, description, Pre-loved: good, *300*, send a photo → Done → List it.
   Phone A gets the new fridge card instantly → *I'm interested* → Phone B *Accept* → numbers swapped.
4. Phone B: list a painting service. Phone A: post **painter for 6 rooms, Dulux, fix and supply** → service →
   Building & painting → Pick a date → *Sat 20 Dec, 9am* → Post. See the paint-shop ad, Sipho's quote, then Phone B's quote, and the compare list.
5. Phone B: *📣 Advertise* → create an ad → admin approves it.
6. Admin: `STATS`, `LOOKUP N-1003`.

## Railway: reuse the Greens service
Scoutly reads the same variables as Greens: open the Greens service → **Settings → Source → Branch** → `scoutly`.
Check `https://<domain>/health` shows `"app":"Scoutly"`. Optional extra variables: `POSTHOG_KEY`, `SAMPLE_PROVIDERS`.
Paynow keys on that service are **live**: credit purchases take real money.

Before the demo, every demo phone must message the bot first (24-hour window), and be a test recipient if you're on the test number.

## Run locally
```
npm install
npm test          # 30 unit tests: matching, credits, leads, data, money
npm run simulate  # full 4-phone run on a fake WhatsApp, 60 checks
npm start
```

## Not in the demo yet (v1)
Database (everything is in memory: a restart clears posts and photos) · photo storage that survives redeploys ·
WhatsApp templates for leads and alerts outside 24 hours · Haiku 5.5 to read free-text posts and Ndebele/Shona ·
monthly business plans and paid boosts · fast-reply streaks, leagues and weekly reports · referrals.
