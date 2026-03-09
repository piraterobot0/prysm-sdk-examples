"use strict";
/**
 * prysm-vincent-adapter — PrysmBookV1 adapter for Vincent strategy engines
 *
 * Wraps PrysmBookV1 on Polygon Amoy testnet in a clean interface that any
 * strategy engine (Vincent, OpenClaw, or raw EOA) can call.
 *
 * Design decisions:
 *   1. Generic Signer interface — works with raw EOA keys now, plugs into
 *      Vincent's smart wallet (PKP) later without rewriting the adapter.
 *   2. Orderbook strategy is swappable — event-scan for now, indexer endpoint later.
 *
 * Known gotchas:
 *   - conditionId is bytes32 hex (0x-prefixed, 66 chars). If you have a decimal
 *     condition ID from Polymarket, convert: '0x' + BigInt(decimal).toString(16).padStart(64, '0')
 *   - Amoy RPC under-reports EIP-1559 fees — the gas patch below is required
 *   - conditionId is NOT indexed in OrderPosted events — can't filter on-chain,
 *     must scan all events and filter in JS
 *
 * Test market (Amoy):
 *   conditionId: set via CONDITION_ID env var
 *   Agent wallet: set via PRIVATE_KEY env var
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.PrysmAdapter = exports.BookStatus = exports.BookMode = exports.BookSide = void 0;
exports.createEOASigner = createEOASigner;
exports.patchAmoyProvider = patchAmoyProvider;
const ethers_1 = require("ethers");
// Wrap an ethers.Wallet as a PrysmSigner (default path for EOA keys)
function createEOASigner(privateKey, provider) {
    const wallet = new ethers_1.ethers.Wallet(privateKey, provider);
    return {
        getAddress: () => Promise.resolve(wallet.address),
        sendTransaction: (tx) => wallet.sendTransaction(tx),
    };
}
// =============================================================================
// Types
// =============================================================================
var BookSide;
(function (BookSide) {
    BookSide[BookSide["BUY"] = 0] = "BUY";
    BookSide[BookSide["SELL"] = 1] = "SELL";
})(BookSide || (exports.BookSide = BookSide = {}));
var BookMode;
(function (BookMode) {
    BookMode[BookMode["MINT"] = 0] = "MINT";
    BookMode[BookMode["TRANSFER"] = 1] = "TRANSFER";
})(BookMode || (exports.BookMode = BookMode = {}));
var BookStatus;
(function (BookStatus) {
    BookStatus[BookStatus["OPEN"] = 0] = "OPEN";
    BookStatus[BookStatus["FILLED"] = 1] = "FILLED";
    BookStatus[BookStatus["CANCELLED"] = 2] = "CANCELLED";
    BookStatus[BookStatus["EXPIRED"] = 3] = "EXPIRED";
})(BookStatus || (exports.BookStatus = BookStatus = {}));
// =============================================================================
// Constants — Polygon Amoy testnet defaults
// =============================================================================
const AMOY_RPC = 'https://rpc-amoy.polygon.technology';
const AMOY_ADDRESSES = {
    prysmBook: '0x15622Dd913f199Ca467861BD530183B594d56C63',
    usdc: '0x1505F986436B1454BD163a7C2d70526a8Cf48692',
    ctf: '0x19769a54A1677BEd3A5457020F8D19DD8B0FB503',
};
const PRICE_RESOLUTION = 10000;
// =============================================================================
// ABIs
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
    'event OrderFilled(uint256 indexed orderId, address indexed taker, uint256 amount, uint256 price)',
];
const ERC20_ABI = [
    'function approve(address spender, uint256 amount) returns (bool)',
    'function balanceOf(address account) view returns (uint256)',
    'function allowance(address owner, address spender) view returns (uint256)',
    'function mint(address to, uint256 amount)',
];
const ERC1155_ABI = [
    'function setApprovalForAll(address operator, bool approved)',
    'function isApprovedForAll(address owner, address operator) view returns (bool)',
    'function balanceOf(address owner, uint256 id) view returns (uint256)',
];
// =============================================================================
// Amoy gas patch — required or transactions fail
// =============================================================================
function patchAmoyProvider(provider) {
    if (provider.formatter?.address) {
        const original = provider.formatter.address.bind(provider.formatter);
        provider.formatter.address = (value) => {
            try {
                return original(value);
            }
            catch {
                return ethers_1.ethers.utils.getAddress(value.toLowerCase());
            }
        };
    }
    const originalGetFeeData = provider.getFeeData.bind(provider);
    provider.getFeeData = async () => {
        const data = await originalGetFeeData();
        const minTip = ethers_1.BigNumber.from('25000000000'); // 25 gwei
        const minFee = ethers_1.BigNumber.from('30000000000'); // 30 gwei
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
// PrysmAdapter — main class
// =============================================================================
class PrysmAdapter {
    constructor(signer, config) {
        this._address = null;
        this._priceInterval = null;
        const rpcUrl = config?.rpcUrl ?? AMOY_RPC;
        this.addresses = config?.addresses ?? AMOY_ADDRESSES;
        this.signer = signer;
        this.provider = patchAmoyProvider(new ethers_1.ethers.providers.JsonRpcProvider(rpcUrl));
        // Read-only contracts (use provider). Write ops go through signer.
        this.book = new ethers_1.ethers.Contract(this.addresses.prysmBook, PRYSM_BOOK_ABI, this.provider);
        this.usdc = new ethers_1.ethers.Contract(this.addresses.usdc, ERC20_ABI, this.provider);
        this.ctf = new ethers_1.ethers.Contract(this.addresses.ctf, ERC1155_ABI, this.provider);
    }
    // Helper: get cached wallet address
    async getAddress() {
        if (!this._address) {
            this._address = await this.signer.getAddress();
        }
        return this._address;
    }
    // ---------------------------------------------------------------------------
    // Market resolution
    // ---------------------------------------------------------------------------
    async getMarket(conditionId) {
        const tokenIds = await this.book.getTokenIds(conditionId);
        return {
            conditionId,
            yesTokenId: tokenIds.yesTokenId,
            noTokenId: tokenIds.noTokenId,
        };
    }
    // ---------------------------------------------------------------------------
    // Orderbook — scan on-chain state (swappable for indexer later)
    // ---------------------------------------------------------------------------
    async getOrderbook(conditionId) {
        // Step 1: Scan OrderPosted events to find candidate order IDs for this market.
        // conditionId is NOT indexed, so we fetch all events and filter in JS.
        // This is much faster than fetching all order state individually.
        const candidateIds = await this._scanCandidateOrderIds(conditionId);
        // Step 2: Batch-fetch on-chain state for candidates (chunks of 50)
        const CHUNK_SIZE = 50;
        const orders = [];
        for (let i = 0; i < candidateIds.length; i += CHUNK_SIZE) {
            const chunk = candidateIds.slice(i, i + CHUNK_SIZE);
            const results = await Promise.all(chunk.map(async (id) => {
                const [raw, remaining] = await Promise.all([
                    this.book.orders(id),
                    this.book.remainingSize(id),
                ]);
                return { id, raw, remaining };
            }));
            for (const { id, raw, remaining } of results) {
                if (raw.status !== BookStatus.OPEN)
                    continue;
                orders.push({
                    orderId: id,
                    maker: raw.maker,
                    conditionId: raw.conditionId,
                    side: raw.side,
                    mode: raw.mode,
                    price: raw.price.toNumber(),
                    size: raw.size.toNumber(),
                    filled: raw.filled.toNumber(),
                    remaining: remaining.toNumber(),
                    expiration: raw.expiration.toNumber(),
                    status: raw.status,
                });
            }
        }
        // Aggregate into price levels
        const bidMap = new Map();
        const askMap = new Map();
        for (const order of orders) {
            const map = order.side === BookSide.BUY ? bidMap : askMap;
            const existing = map.get(order.price) ?? [];
            existing.push(order);
            map.set(order.price, existing);
        }
        const toLevels = (map) => Array.from(map.entries()).map(([price, orders]) => ({
            price,
            priceDecimal: price / PRICE_RESOLUTION,
            size: orders.reduce((sum, o) => sum + o.remaining, 0),
            orders,
        }));
        const bids = toLevels(bidMap).sort((a, b) => b.price - a.price);
        const asks = toLevels(askMap).sort((a, b) => a.price - b.price);
        const bestBid = bids.length > 0 ? bids[0].priceDecimal : null;
        const bestAsk = asks.length > 0 ? asks[0].priceDecimal : null;
        const spread = bestBid !== null && bestAsk !== null ? bestAsk - bestBid : null;
        const midPrice = bestBid !== null && bestAsk !== null ? (bestBid + bestAsk) / 2 : null;
        return { bids, asks, bestBid, bestAsk, spread, midPrice };
    }
    // ---------------------------------------------------------------------------
    // Event scan — find candidate order IDs for a conditionId
    // ---------------------------------------------------------------------------
    async _scanCandidateOrderIds(conditionId) {
        const iface = new ethers_1.ethers.utils.Interface(PRYSM_BOOK_ABI);
        const eventTopic = iface.getEventTopic('OrderPosted');
        const currentBlock = await this.provider.getBlockNumber();
        // Scan in block range chunks to avoid RPC limits (Amoy allows ~10k blocks per query)
        const BLOCK_RANGE = 10000;
        // Look back ~200k blocks (~5 days on Amoy). For older markets, increase this.
        const fromBlock = Math.max(0, currentBlock - 200000);
        const candidateIds = [];
        const conditionLower = conditionId.toLowerCase();
        for (let start = fromBlock; start <= currentBlock; start += BLOCK_RANGE) {
            const end = Math.min(start + BLOCK_RANGE - 1, currentBlock);
            const logs = await this.provider.getLogs({
                address: this.addresses.prysmBook,
                topics: [eventTopic],
                fromBlock: start,
                toBlock: end,
            });
            for (const log of logs) {
                const parsed = iface.parseLog(log);
                // conditionId is not indexed — it's in the data payload
                if (parsed.args.conditionId.toLowerCase() === conditionLower) {
                    candidateIds.push(parsed.args.orderId.toNumber());
                }
            }
        }
        return candidateIds;
    }
    // ---------------------------------------------------------------------------
    // Write operations
    // ---------------------------------------------------------------------------
    async postOrder(params) {
        await this.ensureApprovals();
        const price = Math.round(params.price * PRICE_RESOLUTION);
        const size = Math.round(params.sizeUsdc * 1000000);
        const expiration = Math.floor(Date.now() / 1000) + (params.expirationSecs ?? 600);
        const mode = params.mode ?? BookMode.MINT;
        const iface = new ethers_1.ethers.utils.Interface(PRYSM_BOOK_ABI);
        const data = iface.encodeFunctionData('postOrder', [
            params.conditionId,
            params.side,
            mode,
            price,
            size,
            expiration,
            ethers_1.ethers.constants.AddressZero,
            0,
        ]);
        const result = await this.signer.sendTransaction({
            to: this.addresses.prysmBook,
            data,
        });
        const receipt = await result.wait();
        // Parse orderId from OrderPosted event
        for (const log of receipt.logs ?? []) {
            try {
                const parsed = iface.parseLog(log);
                if (parsed.name === 'OrderPosted') {
                    return parsed.args.orderId.toNumber();
                }
            }
            catch { /* skip */ }
        }
        throw new Error(`postOrder tx succeeded (${result.hash}) but couldn't parse orderId from events`);
    }
    async takeOrder(orderId, amountUsdc) {
        await this.ensureApprovals();
        let amount;
        if (amountUsdc !== undefined) {
            amount = Math.round(amountUsdc * 1000000);
        }
        else {
            const remaining = await this.book.remainingSize(orderId);
            amount = remaining.toNumber();
        }
        const order = await this.book.orders(orderId);
        const expectedPrice = order.price.toNumber();
        const iface = new ethers_1.ethers.utils.Interface(PRYSM_BOOK_ABI);
        const data = iface.encodeFunctionData('takeOrder', [orderId, amount, expectedPrice]);
        const result = await this.signer.sendTransaction({
            to: this.addresses.prysmBook,
            data,
        });
        const receipt = await result.wait();
        return result.hash;
    }
    async cancelOrder(orderId) {
        const iface = new ethers_1.ethers.utils.Interface(PRYSM_BOOK_ABI);
        const data = iface.encodeFunctionData('cancelOrder', [orderId]);
        const result = await this.signer.sendTransaction({
            to: this.addresses.prysmBook,
            data,
        });
        await result.wait();
        return result.hash;
    }
    // ---------------------------------------------------------------------------
    // Account state
    // ---------------------------------------------------------------------------
    async getBalances(conditionId) {
        const address = await this.getAddress();
        const market = await this.getMarket(conditionId);
        const [usdc, pol, yesTokens, noTokens] = await Promise.all([
            this.usdc.balanceOf(address),
            this.provider.getBalance(address),
            this.ctf.balanceOf(address, market.yesTokenId),
            this.ctf.balanceOf(address, market.noTokenId),
        ]);
        return { usdc, pol, yesTokens, noTokens };
    }
    async getOpenOrders(conditionId) {
        const address = await this.getAddress();
        const book = await this.getOrderbook(conditionId);
        const allOrders = [
            ...book.bids.flatMap((l) => l.orders),
            ...book.asks.flatMap((l) => l.orders),
        ];
        return allOrders.filter((o) => o.maker.toLowerCase() === address.toLowerCase());
    }
    async getPositions(conditionId) {
        const address = await this.getAddress();
        const market = await this.getMarket(conditionId);
        const [yesTokens, noTokens] = await Promise.all([
            this.ctf.balanceOf(address, market.yesTokenId),
            this.ctf.balanceOf(address, market.noTokenId),
        ]);
        let netExposure = 'FLAT';
        if (yesTokens.gt(noTokens))
            netExposure = 'LONG_YES';
        else if (noTokens.gt(yesTokens))
            netExposure = 'LONG_NO';
        return { conditionId, yesTokens, noTokens, netExposure };
    }
    // ---------------------------------------------------------------------------
    // Price feed — polling (swappable for WebSocket/indexer later)
    // ---------------------------------------------------------------------------
    subscribePrices(conditionId, callback, intervalMs = 15000) {
        const poll = async () => {
            try {
                const book = await this.getOrderbook(conditionId);
                callback({
                    conditionId,
                    bestBid: book.bestBid,
                    bestAsk: book.bestAsk,
                    midPrice: book.midPrice,
                    spread: book.spread,
                    timestamp: Date.now(),
                });
            }
            catch (err) {
                // Swallow polling errors — strategy engine decides what to do
                console.error('[PrysmAdapter] price poll error:', err.message);
            }
        };
        // Fire immediately, then on interval
        poll();
        this._priceInterval = setInterval(poll, intervalMs);
        return {
            stop: () => {
                if (this._priceInterval) {
                    clearInterval(this._priceInterval);
                    this._priceInterval = null;
                }
            },
        };
    }
    // ---------------------------------------------------------------------------
    // Faucet — mint testnet USDC (unrestricted on Amoy)
    // ---------------------------------------------------------------------------
    async mintTestnetUsdc(amountUsdc) {
        const address = await this.getAddress();
        const amount = Math.round(amountUsdc * 1000000);
        const iface = new ethers_1.ethers.utils.Interface(ERC20_ABI);
        const data = iface.encodeFunctionData('mint', [address, amount]);
        const result = await this.signer.sendTransaction({
            to: this.addresses.usdc,
            data,
        });
        await result.wait();
        return result.hash;
    }
    // ---------------------------------------------------------------------------
    // Approvals (auto-called before trades)
    // ---------------------------------------------------------------------------
    async ensureApprovals() {
        const address = await this.getAddress();
        const spender = this.addresses.prysmBook;
        const allowance = await this.usdc.allowance(address, spender);
        if (allowance.lt(ethers_1.ethers.utils.parseUnits('1000000', 6))) {
            const iface = new ethers_1.ethers.utils.Interface(ERC20_ABI);
            const data = iface.encodeFunctionData('approve', [spender, ethers_1.ethers.constants.MaxUint256]);
            const tx = await this.signer.sendTransaction({ to: this.addresses.usdc, data });
            await tx.wait();
        }
        const approved = await this.ctf.isApprovedForAll(address, spender);
        if (!approved) {
            const iface = new ethers_1.ethers.utils.Interface(ERC1155_ABI);
            const data = iface.encodeFunctionData('setApprovalForAll', [spender, true]);
            const tx = await this.signer.sendTransaction({ to: this.addresses.ctf, data });
            await tx.wait();
        }
    }
    // ---------------------------------------------------------------------------
    // Utilities
    // ---------------------------------------------------------------------------
    /** Convert a decimal Polymarket condition ID to bytes32 hex */
    static decimalToConditionId(decimal) {
        return '0x' + BigInt(decimal).toString(16).padStart(64, '0');
    }
    /** Format raw price (0-10000) to decimal (0.00-1.00) */
    static formatPrice(rawPrice) {
        return rawPrice / PRICE_RESOLUTION;
    }
    /** Format USDC amount (6 decimals) to dollar string */
    static formatUsdc(amount) {
        return (Number(amount) / 1000000).toFixed(2);
    }
}
exports.PrysmAdapter = PrysmAdapter;
