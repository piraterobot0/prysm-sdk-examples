#!/usr/bin/env node
/**
 * trade.js — Standalone Prysm trading CLI for Polygon Amoy testnet
 *
 * Plain JavaScript, no build step. Just: npm install && node trade.js
 *
 * Commands:
 *   node trade.js post BUY 0.55 10       Post BUY @ 55c for $10
 *   node trade.js post SELL 0.45 10      Post SELL @ 45c for $10
 *   node trade.js take 123 5             Take order #123 for $5
 *   node trade.js take 123               Take order #123 full size
 *   node trade.js cancel 123             Cancel order #123
 *   node trade.js book                   Show open orders for market
 *   node trade.js balance                Show USDC + POL balances
 *
 * Env vars (or .env file):
 *   PRIVATE_KEY    — your wallet private key (0x-prefixed)
 *   CONDITION_ID   — the market's conditionId (bytes32 hex)
 *   RPC_URL        — (optional) custom Amoy RPC
 */

// Load .env if present
try { require('dotenv').config(); } catch (_) { /* dotenv is optional */ }

const { ethers } = require('ethers');

// =============================================================================
// Config — Polygon Amoy testnet
// =============================================================================

const AMOY_RPC = process.env.RPC_URL || 'https://rpc-amoy.polygon.technology';
const CHAIN_ID = 80002;

const ADDRESSES = {
  prysmBook: '0x15622Dd913f199Ca467861BD530183B594d56C63',
  usdc:      '0x1505F986436B1454BD163a7C2d70526a8Cf48692',
  ctf:       '0x19769a54A1677BEd3A5457020F8D19DD8B0FB503',
};

// Price resolution: 10000 = 100.00% (so 0.55 → 5500)
const PRICE_RESOLUTION = 10000;

// Enums matching PrysmBookV1.sol
const BookSide   = { BUY: 0, SELL: 1 };
const BookMode   = { MINT: 0, TRANSFER: 1 };
const BookStatus = { 0: 'OPEN', 1: 'FILLED', 2: 'CANCELLED', 3: 'EXPIRED' };

// =============================================================================
// ABIs (human-readable fragments)
// =============================================================================

const PRYSM_BOOK_ABI = [
  'function postOrder(bytes32 conditionId, uint8 side, uint8 mode, uint256 price, uint256 size, uint256 expiration, address originator, uint256 originatorFeeBps) returns (uint256 orderId)',
  'function takeOrder(uint256 orderId, uint256 amount, uint256 expectedPrice)',
  'function cancelOrder(uint256 orderId)',
  'function orders(uint256) view returns (address maker, bytes32 conditionId, uint256 yesTokenId, uint256 noTokenId, uint8 side, uint8 mode, uint256 price, uint256 size, uint256 filled, uint256 expiration, uint8 status, address originator, uint256 originatorFeeBps)',
  'function nextOrderId() view returns (uint256)',
  'function remainingSize(uint256 orderId) view returns (uint256)',
  'function getTokenIds(bytes32 conditionId) view returns (uint256 yesTokenId, uint256 noTokenId)',
  'event OrderPosted(uint256 indexed orderId, address indexed maker, bytes32 conditionId, uint256 yesTokenId, uint256 noTokenId, uint8 side, uint8 mode, uint256 price, uint256 size, uint256 expiration, address originator, uint256 originatorFeeBps)',
];

const ERC20_ABI = [
  'function approve(address spender, uint256 amount) returns (bool)',
  'function balanceOf(address account) view returns (uint256)',
  'function allowance(address owner, address spender) view returns (uint256)',
];

const ERC1155_ABI = [
  'function setApprovalForAll(address operator, bool approved)',
  'function isApprovedForAll(address owner, address operator) view returns (bool)',
  'function balanceOf(address owner, uint256 id) view returns (uint256)',
];

// =============================================================================
// Amoy gas patch — RPC under-reports EIP-1559 fees (needs 25 gwei min tip)
// =============================================================================

function patchAmoyProvider(provider) {
  // Patch formatter to tolerate non-EIP-55 addresses in receipts
  if (provider.formatter && typeof provider.formatter.address === 'function') {
    const original = provider.formatter.address.bind(provider.formatter);
    provider.formatter.address = (value) => {
      try { return original(value); }
      catch { return ethers.utils.getAddress(value.toLowerCase()); }
    };
  }

  // Patch fee data — Amoy minimum is 25 gwei tip
  const originalGetFeeData = provider.getFeeData.bind(provider);
  provider.getFeeData = async () => {
    const data = await originalGetFeeData();
    const minTip = ethers.BigNumber.from('25000000000');  // 25 gwei
    const minFee = ethers.BigNumber.from('30000000000');  // 30 gwei
    if (data.maxPriorityFeePerGas && data.maxPriorityFeePerGas.lt(minTip)) {
      data.maxPriorityFeePerGas = minTip;
    }
    if (data.maxFeePerGas && data.maxFeePerGas.lt(minFee)) {
      data.maxFeePerGas = minFee;
    }
    return data;
  };

  return provider;
}

// =============================================================================
// Helpers
// =============================================================================

function die(msg) {
  console.error(`Error: ${msg}`);
  process.exit(1);
}

function formatUsdc(wei) {
  return (Number(wei) / 1_000_000).toFixed(2);
}

function formatPrice(price) {
  return (Number(price) / PRICE_RESOLUTION).toFixed(4);
}

function formatEth(wei) {
  return parseFloat(ethers.utils.formatEther(wei)).toFixed(4);
}

// =============================================================================
// Setup
// =============================================================================

function setup() {
  const privateKey = process.env.PRIVATE_KEY;
  if (!privateKey) die('PRIVATE_KEY env var is required');

  const conditionId = process.env.CONDITION_ID;
  if (!conditionId) die('CONDITION_ID env var is required');

  const provider = patchAmoyProvider(
    new ethers.providers.JsonRpcProvider(AMOY_RPC)
  );
  const wallet = new ethers.Wallet(privateKey, provider);

  const book = new ethers.Contract(ADDRESSES.prysmBook, PRYSM_BOOK_ABI, wallet);
  const usdc = new ethers.Contract(ADDRESSES.usdc, ERC20_ABI, wallet);
  const ctf  = new ethers.Contract(ADDRESSES.ctf, ERC1155_ABI, wallet);

  return { wallet, provider, book, usdc, ctf, conditionId };
}

// =============================================================================
// Auto-approve USDC + CTF if needed
// =============================================================================

async function ensureApprovals({ wallet, usdc, ctf }) {
  const address = wallet.address;
  const spender = ADDRESSES.prysmBook;

  // Check USDC allowance
  const allowance = await usdc.allowance(address, spender);
  if (allowance.lt(ethers.utils.parseUnits('1000000', 6))) {
    console.log('Setting USDC approval...');
    const tx = await usdc.approve(spender, ethers.constants.MaxUint256);
    await tx.wait();
    console.log('USDC approved.');
  }

  // Check CTF approval
  const approved = await ctf.isApprovedForAll(address, spender);
  if (!approved) {
    console.log('Setting CTF approval...');
    const tx = await ctf.setApprovalForAll(spender, true);
    await tx.wait();
    console.log('CTF approved.');
  }
}

// =============================================================================
// Commands
// =============================================================================

async function cmdPost({ book, conditionId }, sideStr, priceDecimal, sizeUsdc) {
  if (!['BUY', 'SELL'].includes(sideStr)) die('Side must be BUY or SELL');
  if (isNaN(priceDecimal) || priceDecimal <= 0 || priceDecimal >= 1) die('Price must be between 0 and 1 (exclusive)');
  if (isNaN(sizeUsdc) || sizeUsdc <= 0) die('Size must be positive');

  const side = sideStr === 'BUY' ? BookSide.BUY : BookSide.SELL;
  const price = Math.round(priceDecimal * PRICE_RESOLUTION);
  const size = Math.round(sizeUsdc * 1_000_000);
  const expiration = Math.floor(Date.now() / 1000) + 600; // 10 minutes

  console.log(`Posting ${sideStr} @ ${priceDecimal} for $${sizeUsdc} (expires in 10 min)...`);

  const tx = await book.postOrder(
    conditionId,
    side,
    BookMode.MINT,
    price,
    size,
    expiration,
    ethers.constants.AddressZero,
    0
  );
  const receipt = await tx.wait();

  // Parse orderId from OrderPosted event
  let orderId = null;
  for (const log of receipt.logs) {
    try {
      const parsed = book.interface.parseLog(log);
      if (parsed.name === 'OrderPosted') {
        orderId = parsed.args.orderId.toNumber();
        break;
      }
    } catch { /* skip non-matching logs */ }
  }

  if (orderId !== null) {
    console.log(`Order posted! ID: ${orderId}`);
  } else {
    console.log(`Order posted! tx: ${receipt.transactionHash}`);
  }
}

async function cmdTake({ book }, orderIdNum, amountUsdc) {
  if (isNaN(orderIdNum)) die('Order ID must be a number');

  // Read the order
  const order = await book.orders(orderIdNum);
  const remaining = await book.remainingSize(orderIdNum);

  const sideStr = order.side === BookSide.BUY ? 'BUY' : 'SELL';
  console.log(`Order #${orderIdNum}: ${sideStr} @ ${formatPrice(order.price)}, remaining $${formatUsdc(remaining)}, status ${BookStatus[order.status] || order.status}`);

  if (order.status !== 0) die(`Order is not OPEN (status: ${BookStatus[order.status] || order.status})`);

  const amount = amountUsdc
    ? Math.round(amountUsdc * 1_000_000)
    : remaining.toNumber();

  if (ethers.BigNumber.from(amount).gt(remaining)) {
    die(`Amount $${(amount / 1_000_000).toFixed(2)} exceeds remaining $${formatUsdc(remaining)}`);
  }

  console.log(`Taking order #${orderIdNum} for $${(amount / 1_000_000).toFixed(2)}...`);
  const tx = await book.takeOrder(orderIdNum, amount, 0);
  const receipt = await tx.wait();
  console.log(`Filled! tx: ${receipt.transactionHash}`);
}

async function cmdCancel({ book }, orderIdNum) {
  if (isNaN(orderIdNum)) die('Order ID must be a number');

  console.log(`Cancelling order #${orderIdNum}...`);
  const tx = await book.cancelOrder(orderIdNum);
  const receipt = await tx.wait();
  console.log(`Cancelled! tx: ${receipt.transactionHash}`);
}

async function cmdBook({ book, conditionId }) {
  const nextId = (await book.nextOrderId()).toNumber();
  console.log(`Scanning orders 1..${nextId - 1} for market ${conditionId.slice(0, 10)}...`);

  const buys = [];
  const sells = [];

  for (let id = 1; id < nextId; id++) {
    const order = await book.orders(id);
    if (order.status !== 0) continue; // not OPEN
    if (order.conditionId.toLowerCase() !== conditionId.toLowerCase()) continue;

    const remaining = await book.remainingSize(id);
    const entry = {
      id,
      price: formatPrice(order.price),
      priceNum: Number(order.price),
      size: formatUsdc(remaining),
      maker: order.maker.slice(0, 8) + '...',
    };

    if (order.side === BookSide.BUY) buys.push(entry);
    else sells.push(entry);
  }

  // Sort: buys high-to-low, sells low-to-high
  buys.sort((a, b) => b.priceNum - a.priceNum);
  sells.sort((a, b) => a.priceNum - b.priceNum);

  console.log('\n=== ORDER BOOK ===');
  console.log('\nSELLS (asks):');
  if (sells.length === 0) console.log('  (none)');
  for (const s of sells) console.log(`  #${s.id}  SELL @ ${s.price}  $${s.size}  [${s.maker}]`);

  console.log('  -------- spread --------');

  console.log('BUYS (bids):');
  if (buys.length === 0) console.log('  (none)');
  for (const b of buys) console.log(`  #${b.id}  BUY  @ ${b.price}  $${b.size}  [${b.maker}]`);

  console.log(`\n${buys.length} bids, ${sells.length} asks`);
}

async function cmdBalance({ wallet, provider, usdc, ctf, book, conditionId }) {
  const address = wallet.address;
  console.log(`Wallet: ${address}`);

  const [usdcBal, polBal, tokenIds] = await Promise.all([
    usdc.balanceOf(address),
    provider.getBalance(address),
    book.getTokenIds(conditionId),
  ]);

  const [yesBal, noBal] = await Promise.all([
    ctf.balanceOf(address, tokenIds.yesTokenId),
    ctf.balanceOf(address, tokenIds.noTokenId),
  ]);

  console.log(`USDC:      $${formatUsdc(usdcBal)}`);
  console.log(`POL:       ${formatEth(polBal)}`);
  console.log(`YES tokens: ${formatUsdc(yesBal)}`);
  console.log(`NO tokens:  ${formatUsdc(noBal)}`);
}

// =============================================================================
// Main
// =============================================================================

async function main() {
  const [action, ...args] = process.argv.slice(2);

  if (!action || action === 'help' || action === '--help') {
    console.log(`Prysm Trading CLI — Polygon Amoy Testnet

Usage:
  node trade.js post BUY 0.55 10       Post BUY order @ 55c for $10
  node trade.js post SELL 0.45 10      Post SELL order @ 45c for $10
  node trade.js take 123 5             Take order #123 for $5
  node trade.js take 123               Take order #123 full size
  node trade.js cancel 123             Cancel your order #123
  node trade.js book                   Show open orders for market
  node trade.js balance                Show your balances

Env vars (or .env file):
  PRIVATE_KEY    Your wallet private key (0x-prefixed)
  CONDITION_ID   The market conditionId (bytes32 hex)
  RPC_URL        (optional) Custom Amoy RPC URL`);
    return;
  }

  const ctx = setup();
  console.log(`Network: Polygon Amoy (chain ${CHAIN_ID})`);
  console.log(`Wallet:  ${ctx.wallet.address}`);
  console.log(`Market:  ${ctx.conditionId.slice(0, 10)}...`);
  console.log();

  // Auto-approve on write commands
  if (['post', 'take'].includes(action)) {
    await ensureApprovals(ctx);
  }

  switch (action) {
    case 'post':
      await cmdPost(ctx, (args[0] || '').toUpperCase(), parseFloat(args[1]), parseFloat(args[2]));
      break;
    case 'take':
      await cmdTake(ctx, parseInt(args[0], 10), args[1] ? parseFloat(args[1]) : null);
      break;
    case 'cancel':
      await cmdCancel(ctx, parseInt(args[0], 10));
      break;
    case 'book':
      await cmdBook(ctx);
      break;
    case 'balance':
      await cmdBalance(ctx);
      break;
    default:
      die(`Unknown command: ${action}. Run "node trade.js help" for usage.`);
  }
}

main().catch((err) => {
  console.error(`Fatal: ${err.message}`);
  process.exit(1);
});
