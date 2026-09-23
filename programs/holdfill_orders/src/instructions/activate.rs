use anchor_lang::prelude::*;

use crate::{
    constants::*,
    error::HoldfillError,
    state::{LifecycleEvent, Order, OrderStatus},
};

/// Permissionless: once the issuer's event exists, anyone may copy its terms into an armed order.
/// The holder's limit, floor, size, and fee snapshot are unchanged.
#[derive(Accounts)]
pub struct Activate<'info> {
    #[account(
        mut,
        seeds = [ORDER_SEED, order.owner.as_ref(), order.input_mint.as_ref()],
        bump = order.bump
    )]
    pub order: Account<'info, Order>,
    #[account(seeds = [EVENT_SEED, order.input_mint.as_ref()], bump = event.bump)]
    pub event: Account<'info, LifecycleEvent>,
}

#[event]
pub struct OrderActivated {
    pub order: Pubkey,
    pub output_mint: Pubkey,
    pub expiry_ts: i64,
    pub fallback_ts: i64,
}

pub fn handle_activate(ctx: Context<Activate>) -> Result<()> {
    let now = Clock::get()?.unix_timestamp;
    let event = &ctx.accounts.event;
    let order = &mut ctx.accounts.order;
    require!(order.status == OrderStatus::Armed, HoldfillError::NotArmed);
    require!(now < event.expiry_ts, HoldfillError::IssuerDeadlinePassed);

    let offset = order.fallback_ts;
    order.output_mint = event.output_mint;
    order.pool = event.pool;
    order.ratio_num = event.ratio_num;
    order.ratio_den = event.ratio_den;
    order.expiry_ts = event.expiry_ts;
    // A late activation can land inside the fallback window; the floor then applies at once.
    order.fallback_ts = event.expiry_ts.checked_sub(offset).ok_or(HoldfillError::MathOverflow)?;
    order.status = OrderStatus::Active;

    emit!(OrderActivated {
        order: order.key(),
        output_mint: order.output_mint,
        expiry_ts: order.expiry_ts,
        fallback_ts: order.fallback_ts,
    });
    Ok(())
}
