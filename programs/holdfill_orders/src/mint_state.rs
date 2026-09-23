use anchor_lang::prelude::*;
use anchor_spl::token_2022::spl_token_2022::{
    extension::{
        pausable::PausableConfig, transfer_fee::TransferFeeConfig, BaseStateWithExtensions,
        StateWithExtensions,
    },
    state::Mint,
};

/// Issuer-controlled state of a Token-2022 mint that decides whether an order may fill.
pub struct MintState {
    pub paused: bool,
    /// Transfer fee in force for `epoch`, 0 when the mint has no fee extension.
    pub fee_bps: u16,
}

/// Reads pause and transfer-fee state straight from the mint's extension data. Anchor's
/// `InterfaceAccount<Mint>` drops extensions, so the raw account is parsed here. A missing
/// extension means "not pausable" or "no fee".
pub fn read_mint_state(mint: &AccountInfo, epoch: u64) -> Result<MintState> {
    let data = mint.try_borrow_data()?;
    let state = StateWithExtensions::<Mint>::unpack(&data)?;
    let paused = state
        .get_extension::<PausableConfig>()
        .map(|c| bool::from(c.paused))
        .unwrap_or(false);
    let fee_bps = state
        .get_extension::<TransferFeeConfig>()
        .map(|c| u16::from(c.get_epoch_fee(epoch).transfer_fee_basis_points))
        .unwrap_or(0);
    Ok(MintState { paused, fee_bps })
}
