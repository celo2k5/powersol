# POWERSOL Frontend

POWERSOL is a Lucky V1 Solana holder-draw frontend. It retains the existing frontend runtime:

- Root route static server (`npm start`)
- Existing public WebSocket source: `wss://marcelo-admin.up.railway.app`
- Existing `state`, `holders_update`, holder patch, scheduler, and tick events
- Public wallet-address ticket lookup; no wallet-provider connection or signature is required

## Lucky V1 integration

Lucky V1 randomly selects one qualifying holder and sends the creator wallet's distributable native SOL. The frontend follows the backend event order and never fabricates a winner:

- `state` hydrates `config.robinhoodMode`, `config.minHolding`, holder eligibility, timer, history, and the main token CA.
- `cycle_start` opens the center-screen Lucky V1 holder-scanning presentation.
- `holders_update` replaces the qualifying holder list.
- `cycle_update` enters suspense when its phase is `distributing`.
- A live native-SOL `transfer` is authoritative. The interface holds at least seven seconds of suspense before it reveals the winner wallet, exact SOL amount, and Solscan transaction link.
- `cycle_end` replaces history and closes the completed winner presentation after a short celebration, even when it arrives before the delayed reveal.

Winner transfers are deduplicated by signature. Transfers restored from `tx_history` do not replay the winner celebration.

## Expected winner transfer

```js
{
  type: "transfer",
  data: {
    wallet: "WINNER_WALLET",
    tokenSymbol: "SOL",
    tokenMint: "native",
    tokenMetadata: null,
    amount: 1.2345,
    signature: "REAL_SOLANA_SIGNATURE",
    status: "pending",
    timestamp: "2026-08-16T12:00:00.000Z"
  }
}
```

The presentation uses a center-screen overlay while scanning and selecting, then changes to a native-SOL winner confirmation once this transfer arrives.

## Run locally

```bash
npm start
```

Open `http://localhost:8080/`.
