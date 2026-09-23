use anchor_lang::prelude::*;
use anchor_spl::token_2022;

use crate::{constants::*, error::HoldfillError, state::LifecycleEvent};

#[derive(AnchorSerialize, AnchorDeserialize, Clone)]
pub struct RegisterEventParams {
    pub output_mint: Pubkey,
    pub pool: Pubkey,
    pub ratio_num: u64,
    pub ratio_den: u64,
    pub expiry_ts: i64,
}

#[derive(Accounts)]
pub struct RegisterEvent<'info> {
    #[account(mut, address = EVENT_ADMIN @ HoldfillError::Unauthorized)]
    pub admin: Signer<'info>,
    /// CHECK: Token-2022 mint of the expiring token; only its key is stored.
    #[account(owner = token_2022::ID @ HoldfillError::WrongMint)]
    pub input_mint: UncheckedAccount<'info>,
    #[account(
        init,
        payer = admin,
        space = 8 + LifecycleEvent::INIT_SPACE,
        seeds = [EVENT_SEED, input_mint.key().as_ref()],
        bump
    )]
    pub event: Account<'info, LifecycleEvent>,
    pub system_program: Program<'info, System>,
}

pub fn handle_register_event(ctx: Context<RegisterEvent>, params: RegisterEventParams) -> Result<()> {
    let now = Clock::get()?.unix_timestamp;
    require!(params.ratio_num > 0 && params.ratio_den > 0, HoldfillError::InvalidEvent);
    require!(params.expiry_ts > now, HoldfillError::InvalidEvent);
    require_keys_neq!(params.output_mint, ctx.accounts.input_mint.key(), HoldfillError::InvalidEvent);

    let event = &mut ctx.accounts.event;
    event.input_mint = ctx.accounts.input_mint.key();
    event.output_mint = params.output_mint;
    event.pool = params.pool;
    event.ratio_num = params.ratio_num;
    event.ratio_den = params.ratio_den;
    event.expiry_ts = params.expiry_ts;
    event.bump = ctx.bumps.event;
    Ok(())
}
