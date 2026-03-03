#!/usr/bin/env node
/**
 * simple-trader.js — Example using @prysm/sdk to trade on Amoy testnet
 *
 * Install:
 *   npm install @prysm/sdk ethers@^5.8.0
 *
 * Usage:
 *   PRIVATE_KEY=0x... CONDITION_ID=0x... node simple-trader.js
 */

try { require('dotenv').config(); } catch (_) {}

const {
  createAmoySigner,
  createAmoyClient,
  BookSide,
  BookMode,
  BookStatus,
} = require('@prysm/sdk');

const PRICE_RESOLUTION = 10_000;

async function main() {
  const privateKey = process.env.PRIVATE_KEY;
  if (!privateKey) throw new Error('PRIVATE_KEY is required');
  const conditionId = process.env.CONDITION_ID;
  if (!conditionId) throw new Error('CONDITION_ID is required');

  // Create signer and client (Amoy testnet with gas patches)
  const signer = createAmoySigner(privateKey);
  const client = createAmoyClient(signer);
  const address = await signer.getAddress();

  console.log(`Wallet:  ${address}`);
  console.log(`Market:  ${conditionId.slice(0, 10)}...`);

  // Check balances
  const usdcBalance = await client.getUsdcBalance(address);
  console.log(`USDC:    $${(Number(usdcBalance) / 1e6).toFixed(2)}`);

  // Set approvals (idempotent)
  const MAX = BigInt('0xffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff');
  await client.approveUsdc(client.addresses.book, MAX);
  await client.approveCTF(client.addresses.book);
  console.log('Approvals set.');

  // Post a BUY order at 50c for $5
  const orderId = await client.postOrder({
    conditionId,
    side: BookSide.BUY,
    mode: BookMode.MINT,
    price: BigInt(5000),       // 0.50 * 10000
    size: BigInt(5_000_000),   // $5 in USDC (6 decimals)
    expiration: BigInt(Math.floor(Date.now() / 1000) + 600),
  });
  console.log(`Posted BUY @ 0.50 for $5 — order #${orderId}`);

  // Read it back
  const order = await client.getOrder(orderId);
  console.log(`Status: ${BookStatus[order.status]}, price: ${Number(order.price) / PRICE_RESOLUTION}`);

  // Cancel it
  await client.cancelOrder(orderId);
  console.log(`Cancelled order #${orderId}`);
}

main().catch((err) => {
  console.error(`Error: ${err.message}`);
  process.exit(1);
});
