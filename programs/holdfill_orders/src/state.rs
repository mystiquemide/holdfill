use anchor_lang::prelude::*;

/// Issuer-stated conversion terms for one pre-IPO token, e.g. SPACEX into SPCXx at 5 shares per
/// token before 12 March 2027. Orders copy these terms at creation so the holder never types them.
#[account]
#[derive(InitSpace)]
pub struct LifecycleEvent {
    pub input_mint: Pubkey,
    pub output_mint: Pubkey,
    /// The only DLMM pair orders for this event may trade on.
    pub pool: Pubkey,
    /// Entitlement in base units: output = input * ratio_num / ratio_den.
    pub ratio_num: u64,
    pub ratio_den: u64,
    /// Issuer deadline. No fills at or after this time.
    pub expiry_ts: i64,
    pub bump: u8,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, PartialEq, Eq, InitSpace, Debug)]
pub enum OrderStatus {
    Active,
    Filled,
    /// Terms set before the issuer names a successor; `activate` copies the event in.
    /// Appended last so existing accounts keep their encoding.
    Armed,
}

#[account]
#[derive(InitSpace)]
pub struct Order {
    pub owner: Pubkey,
    pub input_mint: Pubkey,
    pub output_mint: Pubkey,
    pub pool: Pubkey,
    pub ratio_num: u64,
    pub ratio_den: u64,
    /// Maximum haircut accepted before the fallback date.
    pub limit_bps: u16,
    /// From this time the fallback floor applies.
    pub fallback_ts: i64,
    /// Minimum output as a share of entitlement after `fallback_ts`.
    pub fallback_floor_bps: u16,
    pub expiry_ts: i64,
    /// Input mint transfer fee in force at creation.
    pub fee_bps: u16,
    /// Maximum input to convert. Equals the delegate approval.
    pub size: u64,
    pub filled: u64,
    pub received: u64,
    pub status: OrderStatus,
    pub created_at: i64,
    pub bump: u8,
}
