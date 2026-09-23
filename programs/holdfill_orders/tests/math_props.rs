//! Property tests for the fill math. Each property runs 10,000 random cases (PROPTEST_CASES to change).
//! `parity_vectors` also writes seeded input/output vectors that keeper/parity.test.ts replays against
//! the keeper's TypeScript copy, so the program and the keeper must agree on every case.
use holdfill_orders::constants::{BPS, MAX_FALLBACK_FLOOR_BPS, MAX_LIMIT_BPS, MIN_FALLBACK_FLOOR_BPS};
use holdfill_orders::math::{haircut_bps, required_output};
use proptest::prelude::*;
use proptest::test_runner::{Config, RngAlgorithm, TestRng};
use std::io::Write;

fn cfg() -> Config {
    let cases = std::env::var("PROPTEST_CASES").ok().and_then(|v| v.parse().ok()).unwrap_or(10_000);
    Config { cases, ..Config::default() }
}

/// Exact target as a rational: amount * num * (BPS - haircut) / (den * BPS).
fn exact(amount: u64, num: u64, den: u64, haircut: u64) -> (u128, u128) {
    ((amount as u128) * (num as u128) * ((BPS - haircut) as u128), (den as u128) * (BPS as u128))
}

// Ratios as issuers and price orders use them: up to 1e12 on either side keeps the product in u128.
// Each generator mixes small values and edges with the full range so rounding paths are hit often.
fn ratio() -> impl Strategy<Value = u64> { prop_oneof![1u64..=100, Just(1_000_000_000_000u64), 1u64..=1_000_000_000_000] }
fn amount() -> impl Strategy<Value = u64> { prop_oneof![0u64..=1_000, Just(u64::MAX), any::<u64>()] }
fn half() -> impl Strategy<Value = u64> { prop_oneof![0u64..=1_000, 0u64..=u64::MAX / 2] }

proptest! {
    #![proptest_config(cfg())]

    /// The minimum is the smallest integer at or above the exact target: never below it (the holder
    /// never gets less than their terms) and never a whole unit above it (no over-demand).
    #[test]
    fn minimum_is_the_exact_ceiling(amount in amount(), num in ratio(), den in ratio(), haircut in 0..=BPS) {
        let (n, d) = exact(amount, num, den, haircut);
        match required_output(amount, num, den, haircut) {
            Some(r) => {
                let r = r as u128;
                prop_assert!(r * d >= n, "below target");
                prop_assert!(r == 0 || (r - 1) * d < n, "more than one unit above target");
            }
            None => prop_assert!((n + d - 1) / d > u64::MAX as u128, "None without overflow"),
        }
    }

    /// A larger haircut never raises the minimum.
    #[test]
    fn deeper_haircut_never_demands_more(amount in half(), num in ratio(), den in ratio(), a in 0..=BPS, b in 0..=BPS) {
        let (lo, hi) = if a <= b { (a, b) } else { (b, a) };
        if let (Some(x), Some(y)) = (required_output(amount, num, den, lo), required_output(amount, num, den, hi)) {
            prop_assert!(y <= x);
        }
    }

    /// Selling more never lowers the minimum, so the keeper's binary search over size is sound.
    #[test]
    fn minimum_grows_with_size(a in amount(), b in amount(), num in ratio(), den in ratio(), haircut in 0..=BPS) {
        let (lo, hi) = if a <= b { (a, b) } else { (b, a) };
        if let (Some(x), Some(y)) = (required_output(lo, num, den, haircut), required_output(hi, num, den, haircut)) {
            prop_assert!(x <= y);
        }
    }

    /// Two partial fills never demand less in total than one fill of the same size.
    #[test]
    fn splitting_never_lowers_the_total(a in half(), b in half(), num in ratio(), den in ratio(), haircut in 0..=BPS) {
        if let (Some(x), Some(y), Some(z)) = (
            required_output(a, num, den, haircut), required_output(b, num, den, haircut), required_output(a + b, num, den, haircut),
        ) {
            prop_assert!(x as u128 + y as u128 >= z as u128);
        }
    }

    /// A price order (haircut 0) demands at least the holder's price, for any amount.
    #[test]
    fn price_order_pays_at_least_the_price(amount in amount(), price in ratio(), den in ratio()) {
        if let Some(r) = required_output(amount, price, den, 0) {
            prop_assert!((r as u128) * (den as u128) >= (amount as u128) * (price as u128));
        }
    }

    /// Any nonzero sale below a 100% haircut demands at least one base unit.
    #[test]
    fn dust_is_never_free(amount in prop_oneof![1u64..=1_000, 1u64..=u64::MAX], num in ratio(), den in ratio(), haircut in 0..BPS) {
        if let Some(r) = required_output(amount, num, den, haircut) {
            prop_assert!(r >= 1);
        }
    }

    /// Invalid terms are refused instead of producing a number.
    #[test]
    fn bad_terms_are_refused(amount in any::<u64>(), num in any::<u64>(), haircut in (BPS + 1)..=u64::MAX) {
        prop_assert_eq!(required_output(amount, num, 0, 0), None);
        prop_assert_eq!(required_output(amount, num, 1, haircut), None);
    }

    /// Before the fallback date the holder's limit applies, from it on the floor, and the haircut in
    /// force always stays within the bounds create_order accepts.
    #[test]
    fn haircut_follows_the_schedule(now in any::<i64>(), fallback in any::<i64>(), limit in 0..=MAX_LIMIT_BPS, floor in MIN_FALLBACK_FLOOR_BPS..=MAX_FALLBACK_FLOOR_BPS) {
        let h = haircut_bps(now, fallback, limit, floor);
        if now < fallback { prop_assert_eq!(h, limit as u64) } else { prop_assert_eq!(h, BPS - floor as u64) }
        prop_assert!(h <= BPS);
        prop_assert!(required_output(1, 1, 1, h).is_some());
    }
}

/// Writes seeded vectors for keeper/parity.test.ts: amount, num, den, haircut, expected ("none" on overflow).
#[test]
fn parity_vectors() {
    let cases: usize = std::env::var("PARITY_CASES").ok().and_then(|v| v.parse().ok()).unwrap_or(10_000);
    let mut rng = TestRng::from_seed(RngAlgorithm::ChaCha, &[7u8; 32]);
    let pick = |rng: &mut TestRng, max: u64| -> u64 {
        // Mix edge values with full-range and small values so rounding and overflow paths are both hit.
        match rng.next_u32() % 6 {
            0 => [0, 1, 2, max - 1, max][(rng.next_u32() % 5) as usize],
            1 => rng.next_u64() % 1_000,
            _ => rng.next_u64() % max + 1,
        }
    };
    let out = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("../../target/parity/math-vectors.txt");
    std::fs::create_dir_all(out.parent().unwrap()).unwrap();
    let mut f = std::io::BufWriter::new(std::fs::File::create(&out).unwrap());
    for _ in 0..cases {
        let amount = pick(&mut rng, u64::MAX);
        let num = pick(&mut rng, 1_000_000_000_000).max(1);
        let den = pick(&mut rng, 1_000_000_000_000).max(1);
        let haircut = pick(&mut rng, BPS);
        let r = required_output(amount, num, den, haircut).map_or("none".into(), |v| v.to_string());
        writeln!(f, "{amount} {num} {den} {haircut} {r}").unwrap();
        let (now, fb) = (rng.next_u64() as i64, rng.next_u64() as i64);
        let (limit, floor) = ((rng.next_u32() % (MAX_LIMIT_BPS as u32 + 1)) as u16, (MIN_FALLBACK_FLOOR_BPS as u32 + rng.next_u32() % 9_001) as u16);
        writeln!(f, "h {now} {fb} {limit} {floor} {}", haircut_bps(now, fb, limit, floor)).unwrap();
    }
}
