# POWERSOL Frontend

POWERSOL is a Powerball-style Solana token-game frontend. It retains the existing frontend runtime:

- Root route static server (`npm start`)
- Existing public WebSocket source: `wss://marcelo-admin.up.railway.app`
- Existing `state`, `holders_update`, holder patch, scheduler, and tick events
- Public wallet-address ticket lookup; no wallet-provider connection or signature is required

## Current backend capability

The connected backend currently supplies distribution state and holders, but it does **not** provide authoritative Powerball cycle, ticket-assignment, draw, or payout events. The interface does not fake those values:

- Holder balances are shown live from the existing feed.
- The current main token CA is displayed from the connected backend configuration.
- Eligibility is displayed as `floor(tokensHeld / 500,000)`, capped at 80.
- Ticket balls, draw numbers, prizes, winner history, and past tickets remain unavailable until the backend supplies them.

## Powerball event contract for backend integration

When available, broadcast one of `power_state`, `powersol_state`, or `powerball_state` using:

```js
{
  type: "powersol_state",
  data: {
    cycle: { id: 42, nextDrawTime: "2026-08-16T23:00:00.000Z" },
    prizePool: 1500000,
    winningNumber: 777,
    entriesByWallet: {
      "WalletAddress": [12, 88, 550]
    },
    history: [
      {
        cycle: 41,
        winningNumber: 212,
        prizePool: 1250000,
        winners: [{ wallet: "WalletAddress", amount: 625000 }]
      }
    ]
  }
}
```

Draw events can also arrive as `power_draw`, `powersol_draw`, or `powerball_draw`.

## Run locally

```bash
npm start
```

Open `http://localhost:8080/`.
