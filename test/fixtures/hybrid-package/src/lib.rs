pub fn hello() -> &'static str {
    "Hello from hybrid-package-test"
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn it_works() {
        assert_eq!(hello(), "Hello from hybrid-package-test");
    }
} 