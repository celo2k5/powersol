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

## Winner selection animation

The draw display animates when it receives any of these event types:

- `power_draw`, `powersol_draw`, or `powerball_draw`
- `test_event` or `test_draw`
- `winner_selection`, `winner_selected`, `draw_start`, or `draw_started`

The event payload may provide a verified winning ball as `winningNumber`, `number`, `winningBall`, `winner.number`, or `result.winningNumber`. The animation cycles display-only numbers, then settles on that authoritative value. A test event without a valid number still animates, but it returns to an awaiting-result state rather than fabricating a winner.

When winner selection begins, POWERSOL opens a center-screen overlay for every visitor. It rolls display-only numbers during the selection, then becomes the distribution reveal after the verified result. Send payout rows in `winners`, `distributions`, or `payouts` (or the corresponding `result.*` field). Each row may use `wallet`, `address`, `owner`, or `recipient`, along with `amount`, `payout`, `reward`, or `value`.

## Run locally

```bash
npm start
```

Open `http://localhost:8080/`.
