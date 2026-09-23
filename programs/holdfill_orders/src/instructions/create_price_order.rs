use anchor_lang::prelude::*;
use anchor_spl::{
    associated_token::get_associated_token_address_with_program_id, token, token_2022,
    token_interface::TokenAccount,
};

use crate::{
    constants::*,
    error::HoldfillError,
    mint_state::read_mint_state,
    state::{LifecycleEvent, Order, OrderStatus},
};

#[derive(AnchorSerialize, AnchorDeserialize, Clone)]
pub struct CreatePriceOrderParams {
    pub size: u64,
    /// Least output, in output base units, for one whole input token.
    pub min_out_per_token: u64,
    pub expiry_ts: i64,
}

/// A standing limit sell at a price the holder sets, for tokens with no issuer event (or before
/// one). It reuses the order account: the price is the ratio and the limit is zero, so `execute`
/// enforces it with the same minimum-output check as a conversion order.
#[derive(Accounts)]
pub struct CreatePriceOrder<'info> {
    #[account(mut)]
    pub owner: Signer<'info>,
    /// CHECK: Token-2022 mint, parsed raw for pause, fee, and decimals.
    #[account(owner = token_2022::ID @ HoldfillError::WrongMint)]
    pub input_mint: UncheckedAccount<'info>,
    /// CHECK: SPL Token or Token-2022 mint; only its key is stored.
    #[account(constraint = *output_mint.owner == token::ID || *output_mint.owner == token_2022::ID @ HoldfillError::WrongMint)]
    pub output_mint: UncheckedAccount<'info>,
    /// CHECK: Meteora DLMM pair; its mints are read and checked below.
    #[account(owner = DLMM_PROGRAM_ID @ HoldfillError::WrongPool)]
    pub pool: UncheckedAccount<'info>,
    /// CHECK: the input's lifecycle event PDA. When it exists, the order must expire before the
    /// issuer deadline.
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
pub struct PriceOrderCreated {
    pub order: Pubkey,
    pub owner: Pubkey,
    pub output_mint: Pubkey,
    pub size: u64,
    pub min_out_per_token: u64,
    pub expiry_ts: i64,
}

/// Reads token X and token Y from a DLMM `LbPair` account.
pub fn pool_mints(pool: &AccountInfo) -> Result<(Pubkey, Pubkey)> {
    let data = pool.try_borrow_data()?;
    require!(
        data.len() >= LB_PAIR_TOKEN_Y_OFFSET + 32 && data[..8] == LB_PAIR_DISCRIMINATOR,
        HoldfillError::WrongPoolMints
    );
    let key = |o: usize| Pubkey::try_from(&data[o..o + 32]).map_err(|_| error!(HoldfillError::WrongPoolMints));
    Ok((key(LB_PAIR_TOKEN_X_OFFSET)?, key(LB_PAIR_TOKEN_Y_OFFSET)?))
}

pub fn handle_create_price_order(ctx: Context<CreatePriceOrder>, params: CreatePriceOrderParams) -> Result<()> {
    let clock = Clock::get()?;
    let owner = ctx.accounts.owner.key();
    let input_mint = ctx.accounts.input_mint.key();
    let output_mint = ctx.accounts.output_mint.key();

    let expected_ata = get_associated_token_address_with_program_id(&owner, &input_mint, &token_2022::ID);
    require_keys_eq!(ctx.accounts.owner_token_in.key(), expected_ata, HoldfillError::WrongOwnerAccount);
    require!(params.size > 0 && params.size <= ctx.accounts.owner_token_in.amount, HoldfillError::InvalidSize);
    require!(params.min_out_per_token > 0, HoldfillError::InvalidPrice);
    require!(
        params.expiry_ts > clock.unix_timestamp && params.expiry_ts <= clock.unix_timestamp + MAX_PRICE_ORDER_SECS,
        HoldfillError::InvalidExpiry
    );

    let event = &ctx.accounts.event;
    if !event.data_is_empty() {
        require_keys_eq!(*event.owner, crate::ID, HoldfillError::InvalidExpiry);
        let terms = LifecycleEvent::try_deserialize(&mut &event.try_borrow_data()?[..])?;
        require!(params.expiry_ts <= terms.expiry_ts, HoldfillError::InvalidExpiry);
    }

    let (x, y) = pool_mints(&ctx.accounts.pool.to_account_info())?;
    require!(x == input_mint && y == output_mint, HoldfillError::WrongPoolMints);

    let mint = read_mint_state(&ctx.accounts.input_mint.to_account_info(), clock.epoch)?;
    require!(!mint.paused, HoldfillError::MintPaused);

    let order = &mut ctx.accounts.order;
    order.owner = owner;
    order.input_mint = input_mint;
    order.output_mint = output_mint;
    order.pool = ctx.accounts.pool.key();
    order.ratio_num = params.min_out_per_token;
    order.ratio_den = 10u64.checked_pow(mint.decimals as u32).ok_or(HoldfillError::MathOverflow)?;
    // Limit zero and a full floor: the minimum is the holder's price for the order's whole life.
    order.limit_bps = 0;
    order.fallback_ts = params.expiry_ts;
    order.fallback_floor_bps = BPS as u16;
    order.expiry_ts = params.expiry_ts;
    order.fee_bps = mint.fee_bps;
    order.size = params.size;
    order.filled = 0;
    order.received = 0;
    order.status = OrderStatus::Active;
    order.created_at = clock.unix_timestamp;
    order.bump = ctx.bumps.order;

    emit!(PriceOrderCreated {
        order: order.key(),
        owner,
        output_mint,
        size: params.size,
        min_out_per_token: params.min_out_per_token,
        expiry_ts: params.expiry_ts,
    });
    Ok(())
}
