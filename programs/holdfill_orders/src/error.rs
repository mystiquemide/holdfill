use anchor_lang::prelude::*;

#[error_code]
pub enum HoldfillError {
    #[msg("Only the event admin can register lifecycle events")]
    Unauthorized,
    #[msg("Lifecycle event terms are invalid")]
    InvalidEvent,
    #[msg("Order is not active")]
    OrderNotActive,
    #[msg("The issuer deadline has passed")]
    IssuerDeadlinePassed,
    #[msg("Amount exceeds the order's remaining size")]
    AmountExceedsRemaining,
    #[msg("Order size must be positive and within the holder's balance")]
    InvalidSize,
    #[msg("Limit must be between 0% and 60%")]
    InvalidLimit,
    #[msg("Fallback date and floor are invalid")]
    InvalidFallback,
    #[msg("Pool does not match the order")]
    WrongPool,
    #[msg("Mint does not match the order")]
    WrongMint,
    #[msg("Pool account does not match the derived DLMM address")]
    WrongPoolAccount,
    #[msg("Token program must be Token-2022")]
    WrongTokenProgram,
    #[msg("A host fee account is not allowed")]
    HostFeeNotAllowed,
    #[msg("Token account is not the owner's associated account")]
    WrongOwnerAccount,
    #[msg("Order program is not the approved delegate")]
    DelegateMismatch,
    #[msg("Approved amount is lower than the fill")]
    InsufficientAllowance,
    #[msg("The issuer paused this token")]
    MintPaused,
    #[msg("The issuer changed the transfer fee since the order was created")]
    FeeChanged,
    #[msg("Swap output is below the holder's minimum")]
    InsufficientOutput,
    #[msg("Arithmetic overflow")]
    MathOverflow,
}
