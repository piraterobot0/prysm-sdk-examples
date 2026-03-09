# Prysm Vincent Adapter

PrysmBookV1 adapter module for Vincent (Lit Protocol) strategy engines. Wraps the on-chain orderbook in a clean interface any strategy engine can call.

**Network:** Polygon Amoy testnet (chain 80002)

---

## Quick Start

```bash
cd vincent-adapter
npm install
npm run build

# Create .env
cat > .env << 'EOF'
PRIVATE_KEY=0xYOUR_PRIVATE_KEY_HERE
CONDITION_ID=0xYOUR_CONDITION_ID_HERE
EOF

# Run smoke test
node test.js
```

## API

### Constructor

```typescript
import { PrysmAdapter, createEOASigner } from './adapter';

// EOA signer (raw private key) — swap for Vincent PKP signer later
const signer = createEOASigner(process.env.PRIVATE_KEY, provider);
const prysm = new PrysmAdapter(signer);
```

### Core Methods

| Method | Returns | Description |
|--------|---------|-------------|
| `getMarket(conditionId)` | `Market` | Resolve conditionId to YES/NO token IDs |
| `getOrderbook(conditionId)` | `Orderbook` | Full orderbook with bids, asks, spread, midPrice |
| `postOrder(params)` | `number` | Post limit order, returns orderId |
| `takeOrder(orderId, amountUsdc?)` | `string` | Fill a resting order, returns tx hash |
| `cancelOrder(orderId)` | `string` | Cancel your order, returns tx hash |
| `getBalances(conditionId)` | `Balances` | USDC, POL, YES/NO token balances |
| `getOpenOrders(conditionId)` | `Order[]` | Your open orders for this market |
| `getPositions(conditionId)` | `Position` | Token holdings + net exposure direction |
| `subscribePrices(conditionId, callback, intervalMs?)` | `{ stop }` | Polling price feed for strategy engine |
| `mintTestnetUsdc(amountUsdc)` | `string` | Mint testnet USDC (unrestricted faucet) |

### Post Order Example

```typescript
const orderId = await prysm.postOrder({
  conditionId: '0xabc...',
  side: BookSide.BUY,
  price: 0.55,      // probability / price
  sizeUsdc: 10,     // $10
});
```

### Price Subscription

```typescript
const sub = prysm.subscribePrices(conditionId, (snap) => {
  console.log(`mid=${snap.midPrice} spread=${snap.spread}`);
  // Feed into strategy engine
}, 15_000);

// Later:
sub.stop();
```

## Design Decisions

1. **Generic Signer interface** — `PrysmSigner` has just `getAddress()` and `sendTransaction()`. Works with raw EOA keys today, plugs into Vincent's PKP smart wallet later without touching the adapter.

2. **Orderbook strategy is swappable** — currently scans on-chain state via `orders()` + `remainingSize()`. When an indexer is available, swap the `getOrderbook()` implementation without changing the interface.

## Known Gotchas

- **conditionId format**: Must be bytes32 hex (0x-prefixed, 66 chars). If you have a decimal ID from Polymarket, use `PrysmAdapter.decimalToConditionId('12345...')`
- **Amoy gas patch**: Required — the RPC under-reports EIP-1559 fees. The adapter applies this automatically.
- **conditionId not indexed**: `OrderPosted` events don't index `conditionId`, so orderbook scanning must fetch all orders and filter in JS. This is fine for low-volume testnet but would need an indexer for production.

## Contract Addresses (Amoy Testnet)

| Contract | Address |
|----------|---------|
| PrysmBookV1 | `0x15622Dd913f199Ca467861BD530183B594d56C63` |
| MockUSDC | `0x1505F986436B1454BD163a7C2d70526a8Cf48692` |
| MockCTF | `0x19769a54A1677BEd3A5457020F8D19DD8B0FB503` |

**Testnet USDC faucet:** MockUSDC has unrestricted minting — call `prysm.mintTestnetUsdc(1000)` to get $1000.
