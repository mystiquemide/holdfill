use anchor_lang::prelude::*;
use anchor_spl::{
    associated_token::get_associated_token_address_with_program_id, token_2022,
    token_interface::TokenAccount,
};

use crate::{
    constants::*,
    error::HoldfillError,
    mint_state::read_mint_state,
    state::{LifecycleEvent, Order, OrderStatus},
};

#[derive(AnchorSerialize, AnchorDeserialize, Clone)]
pub struct CreateOrderParams {
    pub size: u64,
    pub limit_bps: u16,
    pub fallback_ts: i64,
    pub fallback_floor_bps: u16,
}

#[derive(Accounts)]
pub struct CreateOrder<'info> {
    #[account(mut)]
    pub owner: Signer<'info>,
    #[account(
        seeds = [EVENT_SEED, input_mint.key().as_ref()],
        bump = event.bump,
        has_one = input_mint @ HoldfillError::WrongMint
    )]
    pub event: Account<'info, LifecycleEvent>,
    /// CHECK: Token-2022 mint, parsed raw for pause and fee extensions.
    #[account(owner = token_2022::ID @ HoldfillError::WrongMint)]
    pub input_mint: UncheckedAccount<'info>,
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
pub struct OrderCreated {
    pub order: Pubkey,
    pub owner: Pubkey,
    pub size: u64,
    pub limit_bps: u16,
    pub fallback_ts: i64,
    pub fallback_floor_bps: u16,
}

pub fn handle_create_order(ctx: Context<CreateOrder>, params: CreateOrderParams) -> Result<()> {
    let clock = Clock::get()?;
    let event = &ctx.accounts.event;
    let owner = ctx.accounts.owner.key();
    let input_mint = ctx.accounts.input_mint.key();

    let expected_ata = get_associated_token_address_with_program_id(&owner, &input_mint, &token_2022::ID);
    require_keys_eq!(ctx.accounts.owner_token_in.key(), expected_ata, HoldfillError::WrongOwnerAccount);

    require!(params.size > 0 && params.size <= ctx.accounts.owner_token_in.amount, HoldfillError::InvalidSize);
    require!(params.limit_bps <= MAX_LIMIT_BPS, HoldfillError::InvalidLimit);
    require!(
        (MIN_FALLBACK_FLOOR_BPS..=MAX_FALLBACK_FLOOR_BPS).contains(&params.fallback_floor_bps),
        HoldfillError::InvalidFallback
    );
    require!(
        clock.unix_timestamp < params.fallback_ts && params.fallback_ts < event.expiry_ts,
        HoldfillError::InvalidFallback
    );

    let mint = read_mint_state(&ctx.accounts.input_mint.to_account_info(), clock.epoch)?;
    require!(!mint.paused, HoldfillError::MintPaused);

    let order = &mut ctx.accounts.order;
    order.owner = owner;
    order.input_mint = input_mint;
    order.output_mint = event.output_mint;
    order.pool = event.pool;
    order.ratio_num = event.ratio_num;
    order.ratio_den = event.ratio_den;
    order.limit_bps = params.limit_bps;
    order.fallback_ts = params.fallback_ts;
    order.fallback_floor_bps = params.fallback_floor_bps;
    order.expiry_ts = event.expiry_ts;
    order.fee_bps = mint.fee_bps;
    order.size = params.size;
    order.filled = 0;
    order.received = 0;
    order.status = OrderStatus::Active;
    order.created_at = clock.unix_timestamp;
    order.bump = ctx.bumps.order;

    emit!(OrderCreated {
        order: order.key(),
        owner,
        size: params.size,
        limit_bps: params.limit_bps,
        fallback_ts: params.fallback_ts,
        fallback_floor_bps: params.fallback_floor_bps,
    });
    Ok(())
}
