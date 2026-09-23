use anchor_lang::prelude::*;
use anchor_spl::{
    associated_token::get_associated_token_address_with_program_id, token_2022,
    token_interface::TokenAccount,
};

use crate::{
    constants::*,
    error::HoldfillError,
    mint_state::read_mint_state,
    state::{Order, OrderStatus},
};

#[derive(AnchorSerialize, AnchorDeserialize, Clone)]
pub struct ArmOrderParams {
    pub size: u64,
    pub limit_bps: u16,
    /// The fallback floor applies this many days before the deadline the issuer will name.
    pub fallback_days_before: u16,
    pub fallback_floor_bps: u16,
}

/// Arms an order for a token whose issuer has not named a successor yet. The holder sets terms
/// relative to the future entitlement now; `activate` copies in the issuer's terms later.
#[derive(Accounts)]
pub struct ArmOrder<'info> {
    #[account(mut)]
    pub owner: Signer<'info>,
    /// CHECK: Token-2022 mint, parsed raw for pause and fee extensions.
    #[account(owner = token_2022::ID @ HoldfillError::WrongMint)]
    pub input_mint: UncheckedAccount<'info>,
    /// CHECK: must not exist yet; with an event in place, `create_order` applies instead.
    #[account(seeds = [EVENT_SEED, input_mint.key().as_ref()], bump)]
    pub event: UncheckedAccount<'info>,
    pub owner_token_in: InterfaceAccount<'info, TokenAccount>,
    #[account(
        init,
        payer = owner,
        space = 8 + Order::INIT_SPACE,
        seeds = [ORDER_SEED, owner.key().as_ref(), input_mint.key().as_ref()],
        bump
    )]
    pub order: Account<'info, Order>,
    pub system_program: Program<'info, System>,
}

#[event]
pub struct OrderArmed {
    pub order: Pubkey,
    pub owner: Pubkey,
    pub size: u64,
    pub limit_bps: u16,
    pub fallback_days_before: u16,
    pub fallback_floor_bps: u16,
}

pub fn handle_arm_order(ctx: Context<ArmOrder>, params: ArmOrderParams) -> Result<()> {
    let clock = Clock::get()?;
    let owner = ctx.accounts.owner.key();
    let input_mint = ctx.accounts.input_mint.key();

    require!(ctx.accounts.event.data_is_empty(), HoldfillError::EventAlreadyRegistered);
    let expected_ata = get_associated_token_address_with_program_id(&owner, &input_mint, &token_2022::ID);
    require_keys_eq!(ctx.accounts.owner_token_in.key(), expected_ata, HoldfillError::WrongOwnerAccount);
    require!(params.size > 0 && params.size <= ctx.accounts.owner_token_in.amount, HoldfillError::InvalidSize);
    require!(params.limit_bps <= MAX_LIMIT_BPS, HoldfillError::InvalidLimit);
    require!(
        (MIN_FALLBACK_FLOOR_BPS..=MAX_FALLBACK_FLOOR_BPS).contains(&params.fallback_floor_bps)
            && (1..=MAX_FALLBACK_DAYS).contains(&params.fallback_days_before),
        HoldfillError::InvalidFallback
    );

    let mint = read_mint_state(&ctx.accounts.input_mint.to_account_info(), clock.epoch)?;
    require!(!mint.paused, HoldfillError::MintPaused);

    let order = &mut ctx.accounts.order;
    order.owner = owner;
    order.input_mint = input_mint;
    // Output, pool, ratio, and deadline stay empty until `activate`; `execute` requires Active.
    order.output_mint = Pubkey::default();
    order.pool = Pubkey::default();
    order.ratio_num = 0;
    order.ratio_den = 0;
    order.limit_bps = params.limit_bps;
    // While armed, this holds the offset before the deadline, in seconds.
    order.fallback_ts = params.fallback_days_before as i64 * 86_400;
    order.fallback_floor_bps = params.fallback_floor_bps;
    order.expiry_ts = 0;
    order.fee_bps = mint.fee_bps;
    order.size = params.size;
    order.filled = 0;
    order.received = 0;
    order.status = OrderStatus::Armed;
    order.created_at = clock.unix_timestamp;
    order.bump = ctx.bumps.order;

    emit!(OrderArmed {
        order: order.key(),
        owner,
        size: params.size,
        limit_bps: params.limit_bps,
        fallback_days_before: params.fallback_days_before,
        fallback_floor_bps: params.fallback_floor_bps,
    });
    Ok(())
}
