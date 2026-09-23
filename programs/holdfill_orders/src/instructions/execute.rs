use anchor_lang::prelude::*;
use anchor_lang::solana_program::{
    instruction::{AccountMeta, Instruction},
    program::invoke_signed,
};
use anchor_spl::{
    associated_token::get_associated_token_address_with_program_id, token_2022,
    token_interface::TokenAccount,
};

use crate::{
    constants::*,
    error::HoldfillError,
    math::{haircut_bps, required_output},
    mint_state::read_mint_state,
    state::{Order, OrderStatus},
};

/// Mirrors DLMM's `RemainingAccountsInfo` so transfer-hook slices can be forwarded unchanged.
#[derive(AnchorSerialize, AnchorDeserialize, Clone, Debug)]
pub enum DlmmAccountsType {
    TransferHookX,
    TransferHookY,
    TransferHookReward,
    TransferHookMultiReward(u8),
    TransferHookReferral,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Debug)]
pub struct DlmmRemainingAccountsSlice {
    pub accounts_type: DlmmAccountsType,
    pub length: u8,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Debug)]
pub struct DlmmRemainingAccountsInfo {
    pub slices: Vec<DlmmRemainingAccountsSlice>,
}

/// Permissionless: anyone may crank a fill. The program derives every DLMM account it can,
/// enforces the holder's minimum, and measures what the holder actually received.
#[derive(Accounts)]
pub struct Execute<'info> {
    pub keeper: Signer<'info>,
    #[account(
        mut,
        seeds = [ORDER_SEED, order.owner.as_ref(), order.input_mint.as_ref()],
        bump = order.bump
    )]
    pub order: Account<'info, Order>,
    #[account(mut)]
    pub user_token_in: InterfaceAccount<'info, TokenAccount>,
    #[account(mut)]
    pub user_token_out: InterfaceAccount<'info, TokenAccount>,
    /// CHECK: must equal the order's pinned pool.
    #[account(mut, address = order.pool @ HoldfillError::WrongPool)]
    pub lb_pair: UncheckedAccount<'info>,
    /// CHECK: the pool's bitmap extension PDA, or the DLMM program id as the "none" placeholder.
    pub bin_array_bitmap_extension: UncheckedAccount<'info>,
    /// CHECK: compared against the PDA derived from the pool and input mint.
    #[account(mut)]
    pub reserve_x: UncheckedAccount<'info>,
    /// CHECK: compared against the PDA derived from the pool and output mint.
    #[account(mut)]
    pub reserve_y: UncheckedAccount<'info>,
    /// CHECK: must be the order's input mint; parsed raw for pause and fee state.
    #[account(address = order.input_mint @ HoldfillError::WrongMint)]
    pub token_x_mint: UncheckedAccount<'info>,
    /// CHECK: must be the order's output mint.
    #[account(address = order.output_mint @ HoldfillError::WrongMint)]
    pub token_y_mint: UncheckedAccount<'info>,
    /// CHECK: compared against the pool's oracle PDA.
    #[account(mut)]
    pub oracle: UncheckedAccount<'info>,
    /// CHECK: host fees are not allowed; only the "none" placeholder is accepted.
    #[account(address = DLMM_PROGRAM_ID @ HoldfillError::HostFeeNotAllowed)]
    pub host_fee_in: UncheckedAccount<'info>,
    /// CHECK: pinned to Token-2022.
    #[account(address = token_2022::ID @ HoldfillError::WrongTokenProgram)]
    pub token_x_program: UncheckedAccount<'info>,
    /// CHECK: pinned to Token-2022.
    #[account(address = token_2022::ID @ HoldfillError::WrongTokenProgram)]
    pub token_y_program: UncheckedAccount<'info>,
    /// CHECK: SPL Memo, required by swap2.
    #[account(address = MEMO_PROGRAM_ID)]
    pub memo_program: UncheckedAccount<'info>,
    /// CHECK: compared against DLMM's event authority PDA.
    pub event_authority: UncheckedAccount<'info>,
    /// CHECK: Meteora DLMM.
    #[account(address = DLMM_PROGRAM_ID)]
    pub dlmm_program: UncheckedAccount<'info>,
    // remaining_accounts: transfer-hook accounts (per `remaining_accounts_info`) then bin arrays.
}

#[event]
pub struct OrderFilled {
    pub order: Pubkey,
    pub keeper: Pubkey,
    pub amount_in: u64,
    pub amount_out: u64,
    pub required: u64,
    pub haircut_bps: u64,
    pub filled: u64,
    pub status: OrderStatus,
}

fn dlmm_pda(seeds: &[&[u8]]) -> Pubkey {
    Pubkey::find_program_address(seeds, &DLMM_PROGRAM_ID).0
}

pub fn handle_execute<'info>(
    ctx: Context<'info, Execute<'info>>,
    amount_in: u64,
    keeper_min_out: u64,
    remaining_accounts_info: DlmmRemainingAccountsInfo,
) -> Result<()> {
    let clock = Clock::get()?;
    let a = &ctx.accounts;
    let order = &a.order;

    // Order state and deadline.
    require!(order.status == OrderStatus::Active, HoldfillError::OrderNotActive);
    require!(clock.unix_timestamp < order.expiry_ts, HoldfillError::IssuerDeadlinePassed);
    let remaining = order.size.checked_sub(order.filled).ok_or(HoldfillError::MathOverflow)?;
    require!(amount_in > 0 && amount_in <= remaining, HoldfillError::AmountExceedsRemaining);

    // Issuer controls: pause and fee must be as they were when the holder signed.
    let mint = read_mint_state(&a.token_x_mint.to_account_info(), clock.epoch)?;
    require!(!mint.paused, HoldfillError::MintPaused);
    require!(mint.fee_bps == order.fee_bps, HoldfillError::FeeChanged);

    // Holder accounts: the owner's ATAs, with this order approved as delegate.
    let in_ata = get_associated_token_address_with_program_id(&order.owner, &order.input_mint, &token_2022::ID);
    let out_ata = get_associated_token_address_with_program_id(&order.owner, &order.output_mint, &token_2022::ID);
    require_keys_eq!(a.user_token_in.key(), in_ata, HoldfillError::WrongOwnerAccount);
    require_keys_eq!(a.user_token_out.key(), out_ata, HoldfillError::WrongOwnerAccount);
    require!(
        Option::<Pubkey>::from(a.user_token_in.delegate) == Some(order.key()),
        HoldfillError::DelegateMismatch
    );
    require!(a.user_token_in.delegated_amount >= amount_in, HoldfillError::InsufficientAllowance);

    // Pool accounts derived here instead of trusting the caller.
    let pair = a.lb_pair.key();
    require_keys_eq!(a.reserve_x.key(), dlmm_pda(&[pair.as_ref(), order.input_mint.as_ref()]), HoldfillError::WrongPoolAccount);
    require_keys_eq!(a.reserve_y.key(), dlmm_pda(&[pair.as_ref(), order.output_mint.as_ref()]), HoldfillError::WrongPoolAccount);
    require_keys_eq!(a.oracle.key(), dlmm_pda(&[DLMM_ORACLE_SEED, pair.as_ref()]), HoldfillError::WrongPoolAccount);
    require_keys_eq!(a.event_authority.key(), dlmm_pda(&[DLMM_EVENT_AUTHORITY_SEED]), HoldfillError::WrongPoolAccount);
    let bitmap = a.bin_array_bitmap_extension.key();
    require!(
        bitmap == DLMM_PROGRAM_ID || bitmap == dlmm_pda(&[DLMM_BITMAP_SEED, pair.as_ref()]),
        HoldfillError::WrongPoolAccount
    );

    // The holder's minimum, computed from stored terms only.
    let haircut = haircut_bps(clock.unix_timestamp, order.fallback_ts, order.limit_bps, order.fallback_floor_bps);
    let required = required_output(amount_in, order.ratio_num, order.ratio_den, haircut)
        .ok_or(HoldfillError::MathOverflow)?;
    let min_out = required.max(keeper_min_out);
    let before = a.user_token_out.amount;

    // CPI: DLMM swap2 with the order PDA signing as the holder's token delegate.
    let mut data = SWAP2_DISCRIMINATOR.to_vec();
    data.extend_from_slice(&amount_in.to_le_bytes());
    data.extend_from_slice(&min_out.to_le_bytes());
    remaining_accounts_info.serialize(&mut data)?;

    let order_key = order.key();
    let mut metas = vec![
        AccountMeta::new(pair, false),
        if a.bin_array_bitmap_extension.is_writable {
            AccountMeta::new(bitmap, false)
        } else {
            AccountMeta::new_readonly(bitmap, false)
        },
        AccountMeta::new(a.reserve_x.key(), false),
        AccountMeta::new(a.reserve_y.key(), false),
        AccountMeta::new(a.user_token_in.key(), false),
        AccountMeta::new(a.user_token_out.key(), false),
        AccountMeta::new_readonly(a.token_x_mint.key(), false),
        AccountMeta::new_readonly(a.token_y_mint.key(), false),
        AccountMeta::new(a.oracle.key(), false),
        AccountMeta::new_readonly(a.host_fee_in.key(), false),
        AccountMeta::new_readonly(order_key, true),
        AccountMeta::new_readonly(a.token_x_program.key(), false),
        AccountMeta::new_readonly(a.token_y_program.key(), false),
        AccountMeta::new_readonly(a.memo_program.key(), false),
        AccountMeta::new_readonly(a.event_authority.key(), false),
        AccountMeta::new_readonly(DLMM_PROGRAM_ID, false),
    ];
    let mut infos = vec![
        a.lb_pair.to_account_info(),
        a.bin_array_bitmap_extension.to_account_info(),
        a.reserve_x.to_account_info(),
        a.reserve_y.to_account_info(),
        a.user_token_in.to_account_info(),
        a.user_token_out.to_account_info(),
        a.token_x_mint.to_account_info(),
        a.token_y_mint.to_account_info(),
        a.oracle.to_account_info(),
        a.host_fee_in.to_account_info(),
        a.order.to_account_info(),
        a.token_x_program.to_account_info(),
        a.token_y_program.to_account_info(),
        a.memo_program.to_account_info(),
        a.event_authority.to_account_info(),
        a.dlmm_program.to_account_info(),
    ];
    for acc in ctx.remaining_accounts.iter() {
        metas.push(if acc.is_writable {
            AccountMeta::new(acc.key(), false)
        } else {
            AccountMeta::new_readonly(acc.key(), false)
        });
        infos.push(acc.clone());
    }

    let owner = order.owner;
    let input_mint = order.input_mint;
    let bump = [order.bump];
    let signer_seeds: &[&[&[u8]]] = &[&[ORDER_SEED, owner.as_ref(), input_mint.as_ref(), &bump]];
    invoke_signed(
        &Instruction { program_id: DLMM_PROGRAM_ID, accounts: metas, data },
        &infos,
        signer_seeds,
    )?;

    // Measure what the holder actually received.
    ctx.accounts.user_token_out.reload()?;
    let delta = ctx
        .accounts
        .user_token_out
        .amount
        .checked_sub(before)
        .ok_or(HoldfillError::InsufficientOutput)?;
    require!(delta >= required, HoldfillError::InsufficientOutput);

    let order = &mut ctx.accounts.order;
    order.filled = order.filled.checked_add(amount_in).ok_or(HoldfillError::MathOverflow)?;
    order.received = order.received.checked_add(delta).ok_or(HoldfillError::MathOverflow)?;
    if order.filled == order.size {
        order.status = OrderStatus::Filled;
    }

    emit!(OrderFilled {
        order: order.key(),
        keeper: ctx.accounts.keeper.key(),
        amount_in,
        amount_out: delta,
        required,
        haircut_bps: haircut,
        filled: order.filled,
        status: order.status,
    });
    Ok(())
}
