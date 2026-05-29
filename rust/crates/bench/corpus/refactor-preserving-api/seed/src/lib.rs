fn compute(values: &[i32]) -> i32 {
    values.iter().sum()
}

/// Public API: sum a slice of integers. Signature and behavior must be preserved.
pub fn total(values: &[i32]) -> i32 {
    compute(values)
}

#[cfg(test)]
mod tests {
    use super::total;

    #[test]
    fn totals_values() {
        assert_eq!(total(&[1, 2, 3]), 6);
    }
}
