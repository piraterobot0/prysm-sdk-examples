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
import { ethers, BigNumber } from 'ethers';
export interface PrysmSigner {
    getAddress(): Promise<string>;
    sendTransaction(tx: {
        to: string;
        data: string;
        value?: BigNumber;
    }): Promise<{
        hash: string;
        wait(): Promise<{
            status?: number;
        }>;
    }>;
}
export declare function createEOASigner(privateKey: string, provider: ethers.providers.Provider): PrysmSigner;
export declare enum BookSide {
    BUY = 0,
    SELL = 1
}
export declare enum BookMode {
    MINT = 0,
    TRANSFER = 1
}
export declare enum BookStatus {
    OPEN = 0,
    FILLED = 1,
    CANCELLED = 2,
    EXPIRED = 3
}
export interface Market {
    conditionId: string;
    yesTokenId: BigNumber;
    noTokenId: BigNumber;
}
export interface Order {
    orderId: number;
    maker: string;
    conditionId: string;
    side: BookSide;
    mode: BookMode;
    price: number;
    size: number;
    filled: number;
    remaining: number;
    expiration: number;
    status: BookStatus;
}
export interface OrderbookLevel {
    price: number;
    priceDecimal: number;
    size: number;
    orders: Order[];
}
export interface Orderbook {
    bids: OrderbookLevel[];
    asks: OrderbookLevel[];
    bestBid: number | null;
    bestAsk: number | null;
    spread: number | null;
    midPrice: number | null;
}
export interface Balances {
    usdc: BigNumber;
    pol: BigNumber;
    yesTokens: BigNumber;
    noTokens: BigNumber;
}
export interface Position {
    conditionId: string;
    yesTokens: BigNumber;
    noTokens: BigNumber;
    netExposure: 'LONG_YES' | 'LONG_NO' | 'FLAT';
}
export interface PriceSnapshot {
    conditionId: string;
    bestBid: number | null;
    bestAsk: number | null;
    midPrice: number | null;
    spread: number | null;
    timestamp: number;
}
export interface PostOrderParams {
    conditionId: string;
    side: BookSide;
    price: number;
    sizeUsdc: number;
    expirationSecs?: number;
    mode?: BookMode;
}
export interface AdapterConfig {
    rpcUrl?: string;
    chainId?: number;
    addresses?: {
        prysmBook: string;
        usdc: string;
        ctf: string;
    };
}
declare const AMOY_ADDRESSES: {
    prysmBook: string;
    usdc: string;
    ctf: string;
};
export declare class PrysmAdapter {
    readonly provider: ethers.providers.JsonRpcProvider;
    readonly signer: PrysmSigner;
    readonly addresses: typeof AMOY_ADDRESSES;
    readonly book: ethers.Contract;
    readonly usdc: ethers.Contract;
    readonly ctf: ethers.Contract;
    private _address;
    private _priceInterval;
    constructor(signer: PrysmSigner, config?: AdapterConfig);
    getAddress(): Promise<string>;
    getMarket(conditionId: string): Promise<Market>;
    getOrderbook(conditionId: string): Promise<Orderbook>;
    private _scanCandidateOrderIds;
    postOrder(params: PostOrderParams): Promise<number>;
    takeOrder(orderId: number, amountUsdc?: number): Promise<string>;
    cancelOrder(orderId: number): Promise<string>;
    getBalances(conditionId: string): Promise<Balances>;
    getOpenOrders(conditionId: string): Promise<Order[]>;
    getPositions(conditionId: string): Promise<Position>;
    subscribePrices(conditionId: string, callback: (snapshot: PriceSnapshot) => void, intervalMs?: number): {
        stop: () => void;
    };
    mintTestnetUsdc(amountUsdc: number): Promise<string>;
    ensureApprovals(): Promise<void>;
    /** Convert a decimal Polymarket condition ID to bytes32 hex */
    static decimalToConditionId(decimal: string): string;
    /** Format raw price (0-10000) to decimal (0.00-1.00) */
    static formatPrice(rawPrice: number): number;
    /** Format USDC amount (6 decimals) to dollar string */
    static formatUsdc(amount: BigNumber | number): string;
}
export {};
