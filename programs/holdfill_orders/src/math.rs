use crate::constants::BPS;

/// Haircut in force at `now`: the holder's limit before the fallback date, then the fallback floor.
pub fn haircut_bps(now: i64, fallback_ts: i64, limit_bps: u16, fallback_floor_bps: u16) -> u64 {
    if now < fallback_ts {
        limit_bps as u64
    } else {
        BPS - fallback_floor_bps as u64
    }
}

/// Minimum output for `amount_in`:
/// `ceil(amount_in * num * (BPS - haircut) / (den * BPS))`, one division, rounded up so any
/// rounding favors the holder. Returns None on overflow or a zero denominator.
pub fn required_output(amount_in: u64, ratio_num: u64, ratio_den: u64, haircut_bps: u64) -> Option<u64> {
    if ratio_den == 0 || haircut_bps > BPS {
        return None;
    }
    let numerator = (amount_in as u128)
        .checked_mul(ratio_num as u128)?
        .checked_mul((BPS - haircut_bps) as u128)?;
    let denominator = (ratio_den as u128).checked_mul(BPS as u128)?;
    let q = numerator.checked_add(denominator - 1)? / denominator;
    u64::try_from(q).ok()
}

#[cfg(test)]
mod tests {
    use super::*;

    // SPACEX (9 decimals) to SPCXx (8 decimals) at 5 shares per raw token: num 1, den 2.
    const NUM: u64 = 1;
    const DEN: u64 = 2;

    #[test]
    fn full_entitlement_at_zero_haircut() {
        // 1 raw SPACEX = 1e9 base units -> 5 SPCXx = 5e8 base units.
        assert_eq!(required_output(1_000_000_000, NUM, DEN, 0), Some(500_000_000));
    }

    #[test]
    fn twenty_percent_limit() {
        // 0.1 raw SPACEX = 0.5 shares; at a 20% haircut the minimum is 0.4 SPCXx.
        assert_eq!(required_output(100_000_000, NUM, DEN, 2_000), Some(40_000_000));
    }

    #[test]
    fn rounds_up_for_the_holder() {
        // 3 * 1 * 8000 / (2 * 10000) = 1.2 -> 2
        assert_eq!(required_output(3, NUM, DEN, 2_000), Some(2));
        // 1 * 1 * 10000 / 20000 = 0.5 -> 1
        assert_eq!(required_output(1, NUM, DEN, 0), Some(1));
    }

    #[test]
    fn single_division_is_not_below_true_value() {
        // Double truncation would give floor(7/2)=3, then floor(3*7000/10000)=2.
        // True value 7 * 0.5 * 0.7 = 2.45, so the minimum must be 3.
        assert_eq!(required_output(7, NUM, DEN, 3_000), Some(3));
    }

    #[test]
    fn max_amount_does_not_overflow() {
        assert_eq!(required_output(u64::MAX, NUM, DEN, 0), Some(u64::MAX / 2 + 1));
    }

    #[test]
    fn rejects_bad_inputs() {
        assert_eq!(required_output(1, 1, 0, 0), None);
        assert_eq!(required_output(1, 1, 1, 10_001), None);
    }

    #[test]
    fn price_order_minimum_is_the_holders_price() {
        // $1,021 per whole token in USDC (6 decimals), input with 9 decimals, limit zero.
        // 0.5 token must return at least 510.5 USDC.
        assert_eq!(required_output(500_000_000, 1_021_000_000, 1_000_000_000, 0), Some(510_500_000));
        // Rounds up: 1 base unit of input at that price is 1.021 USDC base units -> 2.
        assert_eq!(required_output(1, 1_021_000_000, 1_000_000_000, 0), Some(2));
    }

    #[test]
    fn price_order_never_discounts() {
        // Price orders store limit 0, fallback at expiry, and a 100% floor: zero haircut throughout.
        assert_eq!(haircut_bps(99, 100, 0, 10_000), 0);
        assert_eq!(haircut_bps(100, 100, 0, 10_000), 0);
    }

    #[test]
    fn fallback_switches_to_floor() {
        assert_eq!(haircut_bps(99, 100, 2_000, 5_000), 2_000);
        assert_eq!(haircut_bps(100, 100, 2_000, 5_000), 5_000);
    }
}
