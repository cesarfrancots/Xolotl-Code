pub const MAX: i32 = 10;

pub fn cap(value: i32) -> i32 {
    value.min(MAX)
}
