use anchor_lang::prelude::*;

use crate::{constants::*, error::HoldfillError, state::Order};

/// Closes the order and returns its rent. The app revokes the token approval in the same
/// transaction, so nothing can fill afterwards.
#[derive(Accounts)]
pub struct CancelOrder<'info> {
    #[account(mut)]
    pub owner: Signer<'info>,
    #[account(
        mut,
        close = owner,
        has_one = owner @ HoldfillError::Unauthorized,
        seeds = [ORDER_SEED, owner.key().as_ref(), order.input_mint.as_ref()],
        bump = order.bump
    )]
    pub order: Account<'info, Order>,
}

#[event]
pub struct OrderCancelled {
    pub order: Pubkey,
    pub filled: u64,
    pub received: u64,
}

pub fn handle_cancel_order(ctx: Context<CancelOrder>) -> Result<()> {
    let order = &ctx.accounts.order;
    emit!(OrderCancelled { order: order.key(), filled: order.filled, received: order.received });
    Ok(())
}
