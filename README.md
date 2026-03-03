# Prysm SDK Examples

Examples and tools for trading on [Prysm](https://prysm-lime.vercel.app/alpha) orderbook on Polymarket.

Prysm is an on-chain orderbook for prediction markets built on Polymarket's Conditional Token Framework (CTF), deployed on Polygon.

## Getting Started

### Option 1: Standalone Script (no SDK, no build step)

A single JavaScript file with everything hardcoded. Copy the folder, install ethers, trade.

```bash
cd standalone
npm install
# Set PRIVATE_KEY and CONDITION_ID in .env
node trade.js balance
node trade.js post BUY 0.55 10
```

See [`standalone/README.md`](standalone/README.md) for full docs.

### Option 2: Vincent Adapter (for agents / strategy engines)

A TypeScript adapter module that wraps PrysmBookV1 in a clean interface for Vincent (Lit Protocol) or any strategy engine. Generic signer interface — works with EOA keys now, plugs into Vincent's PKP smart wallet later.

```bash
cd vincent-adapter
npm install && npm run build
# Set PRIVATE_KEY and CONDITION_ID in .env
node test.js
```

See [`vincent-adapter/README.md`](vincent-adapter/README.md) for full API docs.

### Option 3: Using @prysm/sdk

The SDK gives you `PrysmBookClient` with typed methods for all on-chain operations, plus Amoy testnet helpers with gas patches.

```bash
npm install @prysm/sdk ethers@^5.8.0
```

```javascript
const { createAmoySigner, createAmoyClient, BookSide, BookMode } = require('@prysm/sdk');

const signer = createAmoySigner(process.env.PRIVATE_KEY);
const client = createAmoyClient(signer);

// Post a BUY order at 55c for $10
const orderId = await client.postOrder({
  conditionId: process.env.CONDITION_ID,
  side: BookSide.BUY,
  mode: BookMode.MINT,
  price: BigInt(5500),       // 0.55 * 10000
  size: BigInt(10_000_000),  // $10 USDC (6 decimals)
});
```

See [`examples/simple-trader.js`](examples/simple-trader.js) for a complete working example.

## Networks

### Polygon Amoy Testnet (chain 80002)

| Contract | Address |
|----------|---------|
| PrysmBookV1 | `0x15622Dd913f199Ca467861BD530183B594d56C63` |
| MockUSDC | `0x1505F986436B1454BD163a7C2d70526a8Cf48692` |
| MockCTF | `0x19769a54A1677BEd3A5457020F8D19DD8B0FB503` |

RPC: `https://rpc-amoy.polygon.technology`

**Testnet USDC faucet:** MockUSDC has unrestricted minting — anyone can call `mint(address, amount)` directly, or use `node trade.js mint 1000` in the standalone CLI.

### Polygon Mainnet (chain 137)

| Contract | Address |
|----------|---------|
| PrysmBookV2 | `0xa6D0CFfc4039bC6572e66CF9B09d004e811fd1B9` |
| USDC | `0x2791Bca1f2de4661ED88A30C99A7a9449Aa84174` |
| CTF | `0x4D97DCd97eC945f40cF65F87097ACe5EA0476045` |

## How Trading Works

- Prices range from **0.01 to 0.99** (probability of YES outcome)
- **BUY @ 0.55** = pay $0.55/share, win $1.00 if YES
- **SELL @ 0.45** = pay $0.45/share, win $1.00 if NO
- Price resolution: 10,000 (so 0.55 = `5500`)
- USDC has 6 decimals (so $10 = `10_000_000`)
- Orders are fully on-chain — no off-chain matching engine

## Links

- [Dashboard](https://prysm-lime.vercel.app/alpha)
