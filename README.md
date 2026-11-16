# MediDrop – WhatsApp demo bot (Stage A)

The demo server for Tuesday. It runs the full OTC order, Rx approve/reject,
driver flow, delivery code and emergency-word handling on the Meta test number.

## Roles (decided by phone number)
- `PHARMACIST_PHONE` → pharmacist (gets scripts + paid orders)
- `DRIVER_PHONE` → driver (sends ON, accepts jobs, enters the code)
- any other allowed number → customer

## Payments
- No Paynow keys → payments are **simulated** (confirm after ~6 seconds).
- With Paynow test keys → a real test-mode EcoCash prompt. Test number `0771111111` = success.

## Run locally
```
npm install
npm test
npm start
```

## Health check
Open `https://<your-railway-domain>/health` → `{"ok":true,...}`

Logs never contain message text or medicine names. Failed WhatsApp sends are logged as
`[WA] SEND FAILED (HTTP xxx): {Meta's error}`.
