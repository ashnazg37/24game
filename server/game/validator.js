// CommonJS copy of root validator.js for server-side use.
// Keep logic in sync with the browser version at /validator.js

function validateExpression(expression, givenNumbers) {
  const expr = expression.trim();

  if (!expr) return { valid: false, message: "Type an expression first." };

  // Only allow digits, operators, parentheses, spaces
  if (!/^[\d+\-*/() ]+$/.test(expr))
    return { valid: false, message: "Only use digits and + − * / ( )" };

  // Extract all numbers used
  const used = (expr.match(/\d+/g) || []).map(Number);

  if (used.length !== 4)
    return { valid: false, message: `Use all 4 numbers — you used ${used.length}` };

  // Compare sorted arrays (multiset check)
  const sortedUsed  = [...used].sort((a, b) => a - b);
  const sortedGiven = [...givenNumbers].sort((a, b) => a - b);
  if (!sortedUsed.every((n, i) => n === sortedGiven[i]))
    return { valid: false, message: `Use exactly: ${givenNumbers.join(", ")} — you used: ${used.join(", ")}` };

  // Evaluate — safe because we already verified only math characters exist
  let result;
  try {
    // eslint-disable-next-line no-eval
    result = eval(expr);
  } catch {
    return { valid: false, message: "Invalid expression — check your brackets" };
  }

  if (typeof result !== "number" || !isFinite(result))
    return { valid: false, message: "Expression doesn't produce a valid number" };

  if (Math.abs(result - 24) > 1e-9)
    return { valid: false, message: `That equals ${parseFloat(result.toFixed(4))}, not 24` };

  return { valid: true, message: "Correct!" };
}

module.exports = { validateExpression };
