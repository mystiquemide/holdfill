use anchor_lang::prelude::*;

#[constant]
pub const ORDER_SEED: &[u8] = b"order";

#[constant]
pub const EVENT_SEED: &[u8] = b"event";

/// Basis points denominator.
pub const BPS: u64 = 10_000;

/// Largest haircut a holder may set as a limit (60%).
pub const MAX_LIMIT_BPS: u16 = 6_000;

/// Fallback floor bounds, as a share of entitlement.
pub const MIN_FALLBACK_FLOOR_BPS: u16 = 1_000;
pub const MAX_FALLBACK_FLOOR_BPS: u16 = 10_000;

/// Price orders may stand for at most this long.
pub const MAX_PRICE_ORDER_SECS: i64 = 400 * 86_400;

/// Armed orders set their fallback between 1 and 365 days before the issuer deadline.
pub const MAX_FALLBACK_DAYS: u16 = 365;

/// Key allowed to register issuer lifecycle events (conversion target, ratio, deadline).
pub const EVENT_ADMIN: Pubkey = pubkey!("12fN9mtc7x93AyTCpwzLUDPdu2k5h5YswfNigayAYzDg");

/// Meteora DLMM program (same id on mainnet and devnet).
pub const DLMM_PROGRAM_ID: Pubkey = pubkey!("LBUZKhRxPF3XUpBCjp4YzTKgLccjZhTSDM9YuVaPwxo");

/// SPL Memo v2, required by DLMM swap2.
pub const MEMO_PROGRAM_ID: Pubkey = pubkey!("MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr");

/// Anchor discriminator of DLMM `swap2`.
pub const SWAP2_DISCRIMINATOR: [u8; 8] = [65, 75, 63, 76, 235, 91, 91, 136];

/// DLMM `LbPair` account: discriminator and the offsets of its token X and token Y mints.
pub const LB_PAIR_DISCRIMINATOR: [u8; 8] = [33, 11, 49, 98, 181, 101, 177, 13];
pub const LB_PAIR_TOKEN_X_OFFSET: usize = 88;
pub const LB_PAIR_TOKEN_Y_OFFSET: usize = 120;

/// DLMM PDA seeds.
pub const DLMM_ORACLE_SEED: &[u8] = b"oracle";
pub const DLMM_BITMAP_SEED: &[u8] = b"bitmap";
pub const DLMM_EVENT_AUTHORITY_SEED: &[u8] = b"__event_authority";
