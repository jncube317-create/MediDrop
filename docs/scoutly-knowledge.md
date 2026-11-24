# Scoutly — Knowledge Base

**Status as of 21 Nov 2026:** live on its real number with friends testing; launch target **1 December 2026**.
This is the single source of truth. Update it when something changes.

---

## 1. The product

**One line:** *Tell Scoutly once what you need, and the sellers come to you.* Stop posting in 20 WhatsApp and Facebook groups.

**Who it serves**
- **People looking for something:** an item (new or pre-loved), a service, or the cheapest price.
- **Sellers:** individuals selling second-hand items, car sellers, landlords and agents, and informal and registered service providers (carpenters, mechanics, plumbers, painters, hair, events, printing, movers).
- **Shops** (planned): price comparison across stores.
- **Licensed pharmacies:** the only sellers allowed to list medicines.

**How money is made**
- **Credits:** both sides pay 1 credit when numbers are swapped.
- **Sponsored ads:** self-serve, admin-approved, 1 credit per tap.
- **Later:** paid boosts or featured listings, shop subscriptions, and paid verification.

**Zimbabwe only.** The language is English for now; Ndebele and Shona come later with AI.

## 2. How it works today (built and live)

### Sign-up (once)
1. **Rules and consent:** no illegal goods; Scoutly only connects people and isn't liable.
2. First name, then town.
3. **"What brings you here?"** I'm buying / I'm selling / Both.
4. **Everyone makes a profile:** a display name (business or own name), a 1–2 sentence "about", and a **photo (required)**. The preview card shows the name, town, 🆕 New member / ✅ Verified / 💊 Licensed pharmacy, and the star rating.
5. Buyers then go to search, sellers go to their first listing, and "Both" goes to the menu.
6. **3 welcome credits.**

### Searching (one message, after tester feedback on 21 Nov)
- The person types it all at once, e.g. *"pre-loved fridge, budget $100"*. The bot reads:
  - **Category**, from a word list (fridge → Appliances, Vitz → Cars, plumber → Plumbing). "Fix my fridge" counts as a service.
  - **Budget**: $100, under 4,000 usd, max $500, budget 5k. It ignores "250L" and years.
  - **When**: today, this week, a date, or otherwise flexible.
  - **Town**: the profile town unless they say "in Harare" or "anywhere in Zim".
- Results come straight back. The bot only asks for the category if it can't tell.
- **Items:** swipeable picture cards (or single picture cards as a fallback), best match then cheapest. Sponsored cards come last.
- **Services:** the post goes to up to 5 matching providers. They send quotes, and the buyer gets a compare list, cheapest first.
- After results comes a one-line summary (*Fridges & appliances · up to $100 · Bulawayo*) with **🔔 Alert me / ✏️ Edit search / 💳 My credits**. Edit search lets them change the budget, search all of Zim, fix the category, or start a new search.
- Matching works **across categories** when the post and listing share a real word (a fridge listed under Furniture still matches a fridge search). Filler words don't count.

### Swapping numbers
- Buyer taps **I'm interested**, which holds 1 credit. The seller sees the buyer's name, budget, ⏱ timeframe and town, and can **Accept**, **Decline** or mark **It's sold**.
- **On accept:** both get a message with the key facts (item and price, what was asked for, budget, ⏱ wanted, 📍 town), the other person's number, and a **"Tap to chat" link that pre-types a hello saying it came from Scoutly**.
- Then: *"Found what you needed?"* Yes closes the post. Up to 3 swaps per post.
- **No match means no credits used.** Holds are released on decline, after 48 hours of no reply, or when a post closes, expires or sells.

### Posts expire
- "Today": at midnight (Harare time).
- "This week": at the end of Sunday.
- Everything else: after 7 days.

### Selling
*Sell or offer* → item or service → category → title, description, condition (new / pre-loved good / pre-loved used), price, up to 3 photos, town or nationwide.
- Up to 5 active listings.
- *My posts*: mark sold, close, rate.
- People who posted earlier with alerts on get the new listing instantly.

### Ratings and badges
- Stars only, from real swaps.
- Levels: 🆕 New → 🥉 Bronze (1+ swap) → 🥈 Silver (5+, ⭐4.0+) → 🥇 Gold (20+, ⭐4.5+).
- ✅ Verified (given by admin) and 💊 Licensed pharmacy.

### Credits and pricing
| | |
|---|---|
| Welcome | 3 free credits |
| Weekly | **3 free credits every week** (from Monday, Harare time). Unused free credits **don't carry over**; free ones are used first; **bought credits never expire**. Admin GRANTs count as bought |
| $1 | 2 credits |
| $3 | 7 credits |
| $5 | 13 credits |
| Swap | 1 credit each side, every category |
| Ad tap | 1 credit (paid by the advertiser) |

Payments go through Paynow (EcoCash or OneMoney prompt). It's **live**, so purchases take real money.

### Safety filters (on every typed message)
Refused:
- Links and web addresses.
- Phone numbers and emails (protects the paid swap).
- Code and JSON.
- Illegal goods and street-drug slang (bronco, mbanje and so on). These alert the admin.
- **Medicine listings** from anyone who isn't an approved pharmacy. Searching for medicine is allowed and goes to licensed pharmacies only.
- Reports: 3 reports pause a listing.

### Words that work anywhere (any capitals)
MENU, HI, HELP, TERMS, CREDITS, STOP (alerts off), PHARMACY (apply as a pharmacy).

### Admin (from `ADMIN_PHONE`, which falls back to `STAFF_PHONE`)
| Command | What it does |
|---|---|
| `STATS` | People, posts, top searches, listings, leads, swaps, ads, credits sold |
| `LOOKUP N-1001` / `O-501` / `L3` | A post, listing or lead with both sides' names and numbers |
| `GRANT 0771234567 5` | Give credits |
| `VERIFY 0771234567` | ✅ badge |
| `ADS` | Ads waiting, with Approve/Reject buttons |
| `PHARMACY 0771234567` / `UNPHARMACY …` | Approve a pharmacy, or remove one (pauses its medicine listings) |
| Photo captioned `ADD Olivine cooking oil 2L` | Add a product with Scoutly's own photo (add `\| carparts` for spare parts). `ADD …` as text adds it without a photo |
| Photo captioned `PHOTO PR-001` | Set or change a product's photo |
| `PRODUCTS` | The product list (shows which have no photo) |
| `SHOP 0771234567` / `UNSHOP …` | Approve a shop, or remove it and its prices |

### Shop price comparison (groceries and motor spares)
1. **Scoutly owns the product list and photos.** Shops never upload pictures.
2. **Shops join** by typing SHOP, sending their name and opening hours, then picking an area: **Bulawayo CBD / Bulawayo suburbs / Outside Bulawayo**. **No street address is asked for, stored or shown** (privacy). Admin approves (🏪). They're told their WhatsApp number is shown to shoppers.
3. **Shops send prices only:** typed lines (`Olivine cooking oil 2L 3.80`) or an Excel/CSV file (product column, price column). Small typos match; sizes must match exactly. Unknown products go to the admin to add.
4. **Shoppers** typing e.g. "cheapest cooking oil" see the product photo and shops cheapest first, with how old each price is. Older than 14 days = ⚠️; older than 30 days = hidden. Each shop line shows its area. Tapping a shop shows area, hours, number and chat link **free (no credits)**. "Ask sellers too" turns it into a normal post. Car searches never show spare-part prices.
5. Monday 8am reminder to shops. It only reaches shops that messaged in the last 24 hours until a Meta template is approved.
6. Data: Supabase table `products`; shop details sit on the shop's user record.

Automatic admin alerts: blocked posts, medicine listing attempts, reports, new ads to approve, pharmacy applications (with Approve/Reject).

## 3. Infrastructure (where everything lives)

| Piece | Details |
|---|---|
| Code | GitHub `jncube317-create/MediDrop`, branch **`scoutly`** (orphan; `main` = MediDrop, `greens` = Greens) |
| Hosting | Railway, the **Greens service** with Source → Branch set to `scoutly`. Auto-deploys on push. ⚠️ Shared with the Greens demo |
| WhatsApp number | **+263 72 009 8090**, display name "Scoutly" (Meta name review may still apply) |
| Meta app | App ID 2441251413281331 (same app as MediDrop/Greens) |
| Business portfolio | 2611048959320108 |
| WhatsApp Business Account | "Scoutly", WABA ID 2229613204621115 |
| Phone number ID | 1351053908102128 |
| Token | Permanent system-user token (system user "MediDrop bot", with access to the Scoutly WABA) |
| Database | Supabase project `etpzlnqnxhrdmegcfthb`, region eu-west-1 (Ireland), Free plan |
| Photos | Supabase Storage bucket `scoutly-media` (public; JPG, PNG or WebP; 5 MB max) |
| Payments | Paynow live keys (on the Greens service) |
| Analytics | PostHog EU (anonymous IDs only; no phones, names or message text) |

**Railway variables used:** `WA_TOKEN`, `WA_PHONE_NUMBER_ID`, `WA_VERIFY_TOKEN`, `WA_APP_SECRET`, `GRAPH_API_VERSION`, `APP_NAME=Scoutly`, `ADMIN_PHONE`, `PAYNOW_*`, `POSTHOG_KEY`, `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `WA_WABA_ID`. Remove `WA_REGISTER_PIN` once registration is done.

**Database:**
- Tables: `users`, `needs`, `listings`, `leads`, `ads`, `purchases` (id + JSON data), `credit_entries` (append-only ledger with unique keys), and `meta` (number counters).
- Row-level security (RLS) is on with no policies, so only the server key can read or write.
- Admin views: `admin_profiles` and `admin_credit_balances`, readable from the Supabase Table Editor.
- The server loads everything on start and saves changes every 2 seconds and on shutdown, so redeploys lose nothing.

**Tests:** `npm test` runs 36 unit tests. `npm run simulate` runs a full 4-phone WhatsApp simulation (100+ checks). Both must pass before every push.

## 4. Decision log

| Date (2026) | Decision |
|---|---|
| Nov | Name: **Scoutly** (English, not Crown Point). Zimbabwe only |
| Nov | Core model: buyer posts a need → matched sellers → both agree → numbers swapped. Scoutly isn't liable |
| Nov | Both sides pay credits per swap; prepaid bundles |
| Nov | Use the Greens Railway service, Meta app and variables; only the branch changes |
| Nov | No AI at launch (rule-based); **Claude Haiku 5.5** later for free text and Ndebele/Shona |
| Nov | Stars-only ratings; levels and ✅ verified badges; opt-in alerts; seller leads on by default; at most one unrequested message a week |
| Nov | Self-serve sponsored ads with admin approval, pay per tap, complementary targeting (e.g. a paint shop on painting searches) |
| Nov | Admin works by WhatsApp commands; PostHog for trends |
| 19 Nov | Official number: Zolile's second number (+263 72 009 8090); its WhatsApp Business app account was deleted and it was registered on the Cloud API as "Scoutly" |
| 19 Nov | Sign-up asks buyer / seller / both |
| 20 Nov | **Supabase** for the database and photos |
| 20 Nov | **Everyone** makes a profile with a required photo; **1 credit per swap for all categories** |
| 20 Nov | Demo data removed from the live bot (simulator only) |
| 20 Nov | Refuse links, phone numbers and emails, code/JSON, illegal goods |
| 20 Nov | Medicines: searchable by all, listed only by admin-approved licensed pharmacies |
| 20–21 Nov | Bundles **$1 = 2, $3 = 7, $5 = 13** credits; **3 free credits every week** (stacking) |
| 21 Nov | **One-message search** (tester feedback: too many steps, compare with Facebook Marketplace) |
| 21 Nov | Swap message shows the key facts; chat link pre-types a Scoutly hello; "today" and "this week" posts close when their time passes |
| 24 Nov | Shops give an **area only** (CBD / suburbs / outside Bulawayo), never a street address, so no location leaks |
| 24 Nov | **Shop price comparison built** for groceries and motor spares (see section 2). Shop contact is **free** for shoppers; shops are **free** at first (charge later for featured spots); shops' numbers are public with their consent |
| 23 Nov | Search understands **brands** (Nike, Adidas, Samsung, HP, Defy, Hisense…), **singular/plural** (shoe = shoes) and **typos** (niker → Nike, samsang → Samsung), so most searches skip the category question |
| 23 Nov | No "anything else?" after every step; greetings like *hie, hey, howzit, good morning* open the menu; listing examples match the chosen category; short chat links (`/c/<code>`) instead of long wa.me links; unclear searches ask **one** category question (no item-or-service step) |
| 22 Nov | Search fixes from Joshua's test: local car words (fuel saver, ex-Jap, Aqua…), short natural question when unclear, branded category card instead of "No photo yet", **photo required for cars and houses**, cars need year + mileage, seller badges reworded, seller town always shown, 0-credit warning up front, honest "1 match so far" wording, STATS lists searches the bot didn't understand |
| 22 Nov | **Free credits never carry over**: each week free credits reset to 3; bought credits are kept |
| 22 Nov | "How it works" rewritten to explain credits clearly; sign-up consent, rules and How it works state that numbers are shared **only when both people agree** |
| 21 Nov | **Price comparison stays core.** Plan: shops upload prices; Scoutly owns one photo per product; start with one category |

## 5. Next (agreed or proposed, not yet built)

1. **WhatsApp message templates**: "new match", "someone wants what you offer" (utility), and "Scoutly is live" (marketing). Needed for alerts outside the 24-hour window; submit in WhatsApp Manager.
2. **Daily keep-awake check**, so the free Supabase project isn't paused after a quiet week.
3. **Posts open for 30 days** (instead of 7) to support the "sign up now, get matched later" plan.
4. **Admin tools:** unmet demand (searches with no match, by category and town), help desk ("talk to a person" plus `REPLY`), `BAN`/`PAUSE`, money alerts, a morning summary, stuck swaps.
5. **"Still available?" check** for sellers every 14 days (Yes / New price / Sold); pause the listing if there's no reply in 3 days.
6. **Reminder to list** for people who chose "Both" but haven't listed anything.
7. **Growth:** a status share card for sellers, referral credits (both get 2), founding-seller badge plus credits, and admin "list for a seller".
8. **Price comparison for shops:**
   - 🏪 business accounts and a spreadsheet or typed price upload.
   - A Scoutly-owned product list with one photo per product.
   - A "Compare prices" view: cheapest first, showing "updated X days ago".
   - A Monday reminder to shops; stale prices get a warning and are then hidden.
   - Start with one category (recommended: building materials). Greens could be the first grocery feed, with permission.
9. **Video ads:** MP4 up to 16 MB and about 30 seconds; raise the bucket limit. Check whether Meta allows mixing video and photo cards in one carousel.
10. **Pre-filled Click-to-WhatsApp ads**, recording which ad each user came from.
11. **Haiku 5.5** for messy free text (about $0.10 / $0.50 per million tokens input/output, checked Nov 2026).

**Premium ideas** (not decided): buyer "first look" (an early window on new listings), price check with a 🔥 good-deal badge, nearest-first by suburb, more open posts, a verified-only filter. For sellers: boost/featured, more listings, paid verification, stats.

## 6. Go-live checklist

- [x] Real number registered and working
- [x] Supabase connected (data and photos survive redeploys)
- [x] Demo data off on the live bot
- [ ] `ADMIN_PHONE` set to Zolile's personal number *(to confirm)*
- [ ] Payment method added in Meta WhatsApp Manager (needed for templates)
- [ ] Real $1 credit purchase tested end to end
- [ ] Templates built and approved
- [ ] 10 friends do a full run (post, list, swap, rate)
- [ ] Scoutly Facebook Page linked to the WhatsApp number (helps name approval and ads)
- [ ] **POTRAZ** data-controller registration checked (Cyber and Data Protection Act). Confirm with POTRAZ or a lawyer
- [ ] **MCAZ:** confirm pharmacies may take orders through a matching service before opening the medicines category
- [ ] Seed supply: one city (Bulawayo), 3–4 categories, about 10+ listings each, before paid ads

## 7. What testing has taught us

- **21 Nov, voice-note feedback:** sign-up length is acceptable, but search needed too many messages (fixed with one-message search). Speed is what keeps people.
- **21 Nov:** a fridge listed under Furniture didn't match a fridge search under Appliances (fixed with keyword matching across categories).
- **20 Nov:** one tester stopped at the **required profile photo**. Watch this drop-off. The fallback option is to require the photo only when someone first lists something.
- Real users so far: Zolile, Joshua (profile "Crownpoint"), Courage (stopped at the photo step).

## 8. Costs (check before quoting; prices change)

- **WhatsApp** (Rest of Africa, checked Nov 2026): marketing template about $0.0225, utility about $0.004. Service replies inside 24 hours are free (1,000 a month free). Click-to-WhatsApp ad chats get a free window of up to 7 days.
- **Supabase Free:** 500 MB database, 1 GB storage, 5 GB egress. Pauses after a week of no activity.
- **Railway:** shared Greens service; check the real bill.
- **Paynow:** per-transaction commission; check the rate on the Paynow account's fees page.

## 9. Related projects (in the other Claude project, "WhatsApp Based Health App")

- **MediDrop:** a WhatsApp pharmacy delivery service (a 50/50 venture with a partner). Branch `main` of the same repo. If Scoutly and MediDrop both deal with medicines, keep them separate: Scoutly only matchmakes with licensed pharmacies.
- **Greens:** a WhatsApp shopping bot demo for Greens supermarket. Branch `greens`. It shares the Railway service and Meta app with Scoutly, and its demo is currently down while the service runs the `scoutly` branch.
