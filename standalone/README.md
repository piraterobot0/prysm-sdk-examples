# Prysm Standalone Trading CLI

Trade on Prysm prediction markets from the command line. Plain JavaScript, no build step.

**Network:** Polygon Amoy testnet (chain 80002)

---

## Quick Start

```bash
# 1. Clone or copy this folder
cd standalone

# 2. Install dependencies (just ethers)
npm install

# 3. Create .env file
cat > .env << 'EOF'
PRIVATE_KEY=0xYOUR_PRIVATE_KEY_HERE
CONDITION_ID=0xYOUR_CONDITION_ID_HERE
EOF

# 4. Trade!
node trade.js balance
node trade.js book
node trade.js post BUY 0.55 10
```

## Commands

| Command | Description |
|---------|-------------|
| `node trade.js post BUY 0.55 10` | Post BUY order @ 55c for $10 USDC |
| `node trade.js post SELL 0.45 10` | Post SELL order @ 45c for $10 USDC |
| `node trade.js take 123 5` | Take order #123 for $5 |
| `node trade.js take 123` | Take order #123 for its full remaining size |
| `node trade.js cancel 123` | Cancel your order #123 |
| `node trade.js book` | Show all open orders for the active market |
| `node trade.js balance` | Show USDC, POL, YES/NO token balances |
| `node trade.js mint 100` | Mint 100 testnet USDC to your wallet |
| `node trade.js help` | Show usage info |

## Environment Variables

Set these in a `.env` file in the same directory, or export them:

| Variable | Required | Description |
|----------|----------|-------------|
| `PRIVATE_KEY` | Yes | Your wallet private key (0x-prefixed) |
| `CONDITION_ID` | Yes | The market's conditionId (bytes32 hex string) |
| `RPC_URL` | No | Custom Amoy RPC (default: `https://rpc-amoy.polygon.technology`) |

## How Trading Works

- **Prices** range from 0.01 to 0.99 — they represent the probability of YES happening
- **BUY @ 0.55** = you pay $0.55/share, win $1.00 if YES, lose $0.55 if NO
- **SELL @ 0.45** = you pay $0.45/share, win $1.00 if NO, lose $0.45 if YES
- **Post** = place a limit order on the book (waits for someone to take it)
- **Take** = fill someone else's resting order immediately
- Orders expire after 10 minutes by default
- Approvals (USDC + CTF) are set automatically on your first trade

## Finding Condition IDs

Check the Prysm dashboard for active markets, or ask the team for the conditionId of current games.

## Contract Addresses (Amoy Testnet)

| Contract | Address |
|----------|---------|
| PrysmBookV1 | `0x15622Dd913f199Ca467861BD530183B594d56C63` |
| MockUSDC | `0x1505F986436B1454BD163a7C2d70526a8Cf48692` |
| MockCTF | `0x19769a54A1677BEd3A5457020F8D19DD8B0FB503` |

## Troubleshooting

- **"insufficient funds for gas"** — You need POL for gas. Ask for a top-up.
- **"insufficient USDC"** — Run `node trade.js mint 1000` to mint testnet USDC (anyone can mint, no restrictions).
- **Transaction stuck** — Amoy can be slow, wait 30-60s. If stuck, try a higher gas RPC.
- **"PRIVATE_KEY env var is required"** — Create a `.env` file or export the var.
