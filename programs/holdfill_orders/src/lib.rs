pub mod constants;
pub mod error;
pub mod instructions;
pub mod math;
pub mod mint_state;
pub mod state;

use anchor_lang::prelude::*;

pub use constants::*;
pub use instructions::*;
pub use state::*;

declare_id!("A6UhawZdBQiMwpDYzFXKzTJD5voF29rLmrViUT6WaSGV");

/// Holdfill: standing hold-then-convert orders for pre-IPO tokens.
/// The holder approves an order PDA as delegate for a capped amount; anyone can crank a fill,
/// and the program only lets the swap through at or above the holder's minimum.
#[program]
pub mod holdfill_orders {
    use super::*;

    pub fn register_event(ctx: Context<RegisterEvent>, params: RegisterEventParams) -> Result<()> {
        crate::instructions::register_event::handle_register_event(ctx, params)
    }

    pub fn create_order(ctx: Context<CreateOrder>, params: CreateOrderParams) -> Result<()> {
        crate::instructions::create_order::handle_create_order(ctx, params)
    }

    pub fn execute<'info>(
        ctx: Context<'info, Execute<'info>>,
        amount_in: u64,
        keeper_min_out: u64,
        remaining_accounts_info: DlmmRemainingAccountsInfo,
    ) -> Result<()> {
        crate::instructions::execute::handle_execute(ctx, amount_in, keeper_min_out, remaining_accounts_info)
    }

    pub fn cancel_order(ctx: Context<CancelOrder>) -> Result<()> {
        crate::instructions::cancel_order::handle_cancel_order(ctx)
    }

    pub fn create_price_order(ctx: Context<CreatePriceOrder>, params: CreatePriceOrderParams) -> Result<()> {
        crate::instructions::create_price_order::handle_create_price_order(ctx, params)
    }

    pub fn arm_order(ctx: Context<ArmOrder>, params: ArmOrderParams) -> Result<()> {
        crate::instructions::arm_order::handle_arm_order(ctx, params)
    }

    pub fn activate(ctx: Context<Activate>) -> Result<()> {
        crate::instructions::activate::handle_activate(ctx)
    }
}
