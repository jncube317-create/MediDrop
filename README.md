# Greens – WhatsApp order-ahead & pickup demo

Customers shop on WhatsApp, pay with EcoCash, get a digital receipt with a
pickup code (and QR), then collect their bag at the store. No queue, no change.

## Roles (decided by phone number)
- `STAFF_PHONE` → store staff: gets each new order to pack, taps **All packed** or
  **Item missing**, and types the customer's 6-digit code at the counter.
- any other allowed number → customer

## What the customer can do
Shop by section (picture cards) or type a product name · cart (add / remove / empty) ·
pick a pickup time (1-hour slots, 10 orders each, at least 1 hour to pack) ·
pay with EcoCash · receipt + pickup code + QR · "I'm here" button ·
track order · reorder last basket · Greens wallet.

## The wallet (solves the change problem)
If staff mark an item **missing**, its full price goes into the customer's
Greens wallet straight away. The wallet comes off their next order automatically.

## Demo products and sample prices (USD)
| Product | Price |
|---|---|
| Proton White Loaf | $1.10 |
| Potatoes 10kg pocket | $7.00 |
| Kellogg's Noodles Durban curry 70g | $0.50 |
| Mazoe Orange Crush 2L | $4.00 |
| Cadbury Dairy Milk Oreo 162g | $3.50 |
| Sta-soft Baby 2L | $4.50 |
| OMO Auto Liquid 750ml | $4.00 |
| Nivea Roll-on Fresh Flower 50ml | $3.00 |

Sample prices only. Change them in `src/data.ts`.

## Change a product picture
Put a photo anywhere, then run:
```
python3 tools/make_cards.py path/to/photo.jpg g04
```
It makes `public/img/g04.jpg` (1000×600, the size WhatsApp cards need).

## Payments
- No Paynow keys → payments are **simulated** (confirm after ~6 seconds).
- With Paynow test keys → a real test-mode EcoCash prompt. Test number `0771111111` = success.

## Run locally
```
npm install
npm test          # 37 unit tests
npm run simulate  # full order on a fake WhatsApp, 29 checks
npm start
```

## Health check
`https://<your-railway-domain>/health` → `{"ok":true,...}`
