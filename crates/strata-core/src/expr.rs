//! Safe arithmetic expression evaluator (Pratt parser).
//!
//! Mirrors `@strata/scene/expr.ts` — same grammar, same tests, same semantics.
//!
//! Grammar:
//!   expr     -> term (('+' | '-') term)*
//!   term     -> factor (('*' | '/') factor)*
//!   factor   -> NUMBER | ALIAS | '(' expr ')'
//!
//! Aliases: `{name}` resolved via a lookup map.
//! No unsafe code, no dynamic dispatch beyond the op table.
//!
//! Research basis: Pratt parsing (Vaughan Pratt 1973), same TS→Rust mirror
//! strategy as `strata-core::component`.

use std::collections::HashMap;

#[derive(Debug, Clone, PartialEq)]
enum Token {
    Number(f64),
    Alias(String),
    Op(char),
    Paren(char),
}

fn tokenize(input: &str) -> Result<Vec<Token>, String> {
    let mut tokens = Vec::new();
    let mut chars = input.chars().peekable();

    while let Some(&ch) = chars.peek() {
        if ch.is_whitespace() {
            chars.next();
            continue;
        }
        if ch == '{' {
            chars.next();
            let mut name = String::new();
            loop {
                match chars.next() {
                    None => return Err("Unclosed alias".into()),
                    Some('}') => break,
                    Some(c) => name.push(c),
                }
            }
            tokens.push(Token::Alias(name));
            continue;
        }
        if ch.is_ascii_digit() {
            let mut num = String::new();
            while let Some(&c) = chars.peek() {
                if c.is_ascii_digit() || c == '.' {
                    num.push(c);
                    chars.next();
                } else {
                    break;
                }
            }
            let val: f64 = num.parse().map_err(|_| format!("Invalid number: {num}"))?;
            tokens.push(Token::Number(val));
            continue;
        }
        if "+-*/".contains(ch) {
            chars.next();
            tokens.push(Token::Op(ch));
            continue;
        }
        if ch == '(' || ch == ')' {
            chars.next();
            tokens.push(Token::Paren(ch));
            continue;
        }
        return Err(format!("Unexpected character: '{ch}'"));
    }

    Ok(tokens)
}

fn precedence(op: char) -> u8 {
    match op {
        '+' | '-' => 1,
        '*' | '/' => 2,
        _ => 0,
    }
}

fn apply_op(op: char, a: f64, b: f64) -> Result<f64, String> {
    match op {
        '+' => Ok(a + b),
        '-' => Ok(a - b),
        '*' => Ok(a * b),
        '/' => {
            if b == 0.0 {
                Err("Division by zero".into())
            } else {
                Ok(a / b)
            }
        }
        _ => Err(format!("Unknown operator: '{op}'")),
    }
}

/// Evaluate an arithmetic expression string with alias resolution.
///
/// `aliases` provides resolved numeric values for `{name}` references.
/// Returns `Err` on syntax errors, unknown aliases, or division by zero.
pub fn evaluate(input: &str, aliases: &HashMap<String, f64>) -> Result<f64, String> {
    let tokens = tokenize(input)?;
    let mut pos = 0;
    let result = parse_expr(&tokens, &mut pos, 0, aliases)?;
    if pos < tokens.len() {
        return Err("Unexpected trailing tokens".to_string());
    }
    Ok(result)
}

fn parse_expr(
    tokens: &[Token],
    pos: &mut usize,
    min_prec: u8,
    aliases: &HashMap<String, f64>,
) -> Result<f64, String> {
    let mut left = parse_factor(tokens, pos, aliases)?;

    while let Some(Token::Op(c)) = tokens.get(*pos) {
        let op = *c;
        let prec = precedence(op);
        if prec < min_prec {
            break;
        }
        *pos += 1;
        let right = parse_expr(tokens, pos, prec + 1, aliases)?;
        left = apply_op(op, left, right)?;
    }

    Ok(left)
}

fn parse_factor(
    tokens: &[Token],
    pos: &mut usize,
    aliases: &HashMap<String, f64>,
) -> Result<f64, String> {
    let t = tokens
        .get(*pos)
        .ok_or_else(|| "Unexpected end of expression".to_string())?;
    *pos += 1;

    match t {
        Token::Number(n) => Ok(*n),
        Token::Alias(name) => aliases
            .get(name)
            .copied()
            .ok_or_else(|| format!("Unknown alias: {name}")),
        Token::Paren('(') => {
            let val = parse_expr(tokens, pos, 0, aliases)?;
            match tokens.get(*pos) {
                Some(Token::Paren(')')) => {
                    *pos += 1;
                    Ok(val)
                }
                _ => Err("Mismatched parentheses".into()),
            }
        }
        _ => Err(format!("Unexpected token: {t:?}")),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn aliases(pairs: &[(&str, f64)]) -> HashMap<String, f64> {
        pairs.iter().map(|(k, v)| (k.to_string(), *v)).collect()
    }

    #[test]
    fn evaluates_simple_number() {
        assert_eq!(evaluate("3", &HashMap::new()), Ok(3.0));
    }

    #[test]
    fn evaluates_addition() {
        assert_eq!(evaluate("1 + 2", &HashMap::new()), Ok(3.0));
    }

    #[test]
    fn evaluates_subtraction() {
        assert_eq!(evaluate("5 - 3", &HashMap::new()), Ok(2.0));
    }

    #[test]
    fn evaluates_multiplication() {
        assert_eq!(evaluate("3 * 4", &HashMap::new()), Ok(12.0));
    }

    #[test]
    fn evaluates_division() {
        assert_eq!(evaluate("10 / 2", &HashMap::new()), Ok(5.0));
    }

    #[test]
    fn respects_precedence() {
        assert_eq!(evaluate("2 + 3 * 4", &HashMap::new()), Ok(14.0));
    }

    #[test]
    fn respects_parentheses() {
        assert_eq!(evaluate("(2 + 3) * 4", &HashMap::new()), Ok(20.0));
    }

    #[test]
    fn chained_division_left_to_right() {
        assert_eq!(evaluate("8 / 4 / 2", &HashMap::new()), Ok(1.0));
    }

    #[test]
    fn chained_subtraction_left_to_right() {
        assert_eq!(evaluate("10 - 3 - 2", &HashMap::new()), Ok(5.0));
    }

    #[test]
    fn evaluates_alias_lookup() {
        let a = aliases(&[("base", 10.0)]);
        assert_eq!(evaluate("{base}", &a), Ok(10.0));
    }

    #[test]
    fn evaluates_alias_in_expression() {
        let a = aliases(&[("base", 10.0)]);
        assert_eq!(evaluate("{base} * 1.5", &a), Ok(15.0));
    }

    #[test]
    fn evaluates_alias_with_hyphen() {
        let a = aliases(&[("space-2", 8.0)]);
        assert_eq!(evaluate("{space-2} + 4", &a), Ok(12.0));
    }

    #[test]
    fn unknown_alias_returns_error() {
        let result = evaluate("{unknown}", &HashMap::new());
        assert!(result.is_err());
        assert!(result.unwrap_err().contains("Unknown alias"));
    }

    #[test]
    fn division_by_zero_returns_error() {
        let result = evaluate("1 / 0", &HashMap::new());
        assert!(result.is_err());
        assert!(result.unwrap_err().contains("Division by zero"));
    }

    #[test]
    fn malformed_expression_returns_error() {
        let result = evaluate("1 +", &HashMap::new());
        assert!(result.is_err());
    }

    #[test]
    fn mismatched_parentheses_returns_error() {
        let result = evaluate("(1 + 2", &HashMap::new());
        assert!(result.is_err());
    }

    #[test]
    fn invalid_character_returns_error() {
        let result = evaluate("2 @ 3", &HashMap::new());
        assert!(result.is_err());
    }
}
