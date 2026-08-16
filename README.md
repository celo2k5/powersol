# POWERSOL Frontend

POWERSOL is a Lucky V1 Solana holder-draw frontend. It uses the public WebSocket runtime:

- Root route static server (`npm start`)
- Existing public WebSocket source: `wss://marcelo-admin.up.railway.app`
- `state`, `tx_history`, `cycle_start`, `cycle_update`, `holders_update`, `transfer`, `cycle_end`, scheduler, and tick events
- Public wallet-address ticket lookup; no wallet-provider connection or signature is required

## Lucky V1 integration

Lucky V1 randomly selects one qualifying holder and sends the creator wallet's distributable native SOL. The frontend represents that draw as one ball per qualifying holder: `holders.length` is the eligible-ball count, and every holder has equal selection odds regardless of balance or array position. The frontend follows the backend event order and never fabricates a winner:

- `state` hydrates `config.robinhoodMode`, `config.minHolding`, holder eligibility, timer, history, and the main token CA.
- `cycle_start` opens the center-screen Lucky V1 holder-scanning presentation.
- `holders_update` replaces the qualifying holder list for the live `config.tokenMint`; the holder board labels that mint and clears stale holders if the configured mint changes.
- `cycle_update` tracks the scan and enters suspense when its phase is `distributing`.
- A new live native-SOL `transfer` is authoritative. The interface holds at least seven seconds of suspense before it reveals the selected ball's wallet, exact SOL amount, and Solscan transaction link.
- `cycle_end` replaces history, updates the deployed-SOL total, and closes the completed winner presentation after a short celebration, even when it arrives before the delayed reveal. Failed cycles show an explicit no-winner state.
- `tx_history` rebuilds the public activity stream and seeds transfer deduplication without replaying a cached winner.

The live ball registry renders every qualifying holder with a one-to-one visual ball ID. During scanning, the registry animates all eligible balls. Once the authoritative transfer arrives, the matching wallet's ball is locked, all other balls dim, and the center-screen winner presentation reveals the wallet and SOL payout.

Winner transfers are deduplicated by signature (or a wallet/timestamp/amount identity when a signature is absent). Transfers restored from `tx_history` rebuild the cached transfer set without replaying the winner celebration.

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
