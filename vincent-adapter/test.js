#!/usr/bin/env node
/**
 * test.js — Quick smoke test for the PrysmAdapter
 *
 * Usage:
 *   PRIVATE_KEY=0x... CONDITION_ID=0x... node test.js
 *
 * Runs through: getMarket → getBalances → mintTestnetUsdc → getOrderbook → postOrder → cancelOrder
 */

try { require('dotenv').config(); } catch (_) {}

const { ethers } = require('ethers');

// Use the compiled adapter (run `npm run build` first) or require the .ts via ts-node
let adapter;
try {
  adapter = require('./dist/adapter');
} catch {
  console.error('Run `npm run build` first.');
  process.exit(1);
}

const { PrysmAdapter, createEOASigner, BookSide } = adapter;

async function main() {
  const privateKey = process.env.PRIVATE_KEY;
  if (!privateKey) throw new Error('PRIVATE_KEY is required');
  const conditionId = process.env.CONDITION_ID;
  if (!conditionId) throw new Error('CONDITION_ID is required');

  // 1. Create adapter with EOA signer
  const provider = new ethers.providers.JsonRpcProvider('https://rpc-amoy.polygon.technology');
  const signer = createEOASigner(privateKey, provider);
  const prysm = new PrysmAdapter(signer);

  const address = await prysm.getAddress();
  console.log(`Wallet: ${address}`);

  // 2. Resolve market
  console.log('\n--- getMarket ---');
  const market = await prysm.getMarket(conditionId);
  console.log(`conditionId: ${market.conditionId}`);
  console.log(`yesTokenId:  ${market.yesTokenId.toString()}`);
  console.log(`noTokenId:   ${market.noTokenId.toString()}`);

  // 3. Check balances
  console.log('\n--- getBalances ---');
  const balances = await prysm.getBalances(conditionId);
  console.log(`USDC:   $${PrysmAdapter.formatUsdc(balances.usdc)}`);
  console.log(`POL:    ${parseFloat(ethers.utils.formatEther(balances.pol)).toFixed(4)}`);
  console.log(`YES:    ${PrysmAdapter.formatUsdc(balances.yesTokens)}`);
  console.log(`NO:     ${PrysmAdapter.formatUsdc(balances.noTokens)}`);

  // 4. Mint testnet USDC if low
  if (balances.usdc.lt(ethers.utils.parseUnits('10', 6))) {
    console.log('\n--- mintTestnetUsdc (balance low, minting $100) ---');
    const hash = await prysm.mintTestnetUsdc(100);
    console.log(`Minted! tx: ${hash}`);
  }

  // 5. Read orderbook
  console.log('\n--- getOrderbook ---');
  const book = await prysm.getOrderbook(conditionId);
  console.log(`Bids: ${book.bids.length} levels, Asks: ${book.asks.length} levels`);
  if (book.midPrice !== null) console.log(`Mid: ${book.midPrice.toFixed(4)}, Spread: ${book.spread.toFixed(4)}`);

  // 6. Post + cancel a test order
  console.log('\n--- postOrder (BUY @ 0.10 for $1, 10min expiry) ---');
  const orderId = await prysm.postOrder({
    conditionId,
    side: BookSide.BUY,
    price: 0.10,
    sizeUsdc: 1,
  });
  console.log(`Posted order #${orderId}`);

  console.log('\n--- cancelOrder ---');
  const cancelHash = await prysm.cancelOrder(orderId);
  console.log(`Cancelled! tx: ${cancelHash}`);

  // 7. Check positions
  console.log('\n--- getPositions ---');
  const pos = await prysm.getPositions(conditionId);
  console.log(`YES: ${PrysmAdapter.formatUsdc(pos.yesTokens)}, NO: ${PrysmAdapter.formatUsdc(pos.noTokens)}, Exposure: ${pos.netExposure}`);

  // 8. Test price subscription (one tick)
  console.log('\n--- subscribePrices (single tick) ---');
  await new Promise((resolve) => {
    const sub = prysm.subscribePrices(conditionId, (snap) => {
      console.log(`Price: bid=${snap.bestBid}, ask=${snap.bestAsk}, mid=${snap.midPrice}`);
      sub.stop();
      resolve(undefined);
    });
  });

  console.log('\nAll tests passed!');
}

main().catch((err) => {
  console.error(`Error: ${err.message}`);
  process.exit(1);
});
