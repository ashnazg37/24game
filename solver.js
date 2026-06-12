const EPSILON = 1e-9;

function applyOp(a, b, op) {
  if (op === "+") return a + b;
  if (op === "-") return a - b;
  if (op === "*") return a * b;
  if (op === "/") return Math.abs(b) < EPSILON ? null : a / b;
}

function isTarget(n) {
  return n !== null && Math.abs(n - 24) < EPSILON;
}

function permutations(arr) {
  if (arr.length <= 1) return [[...arr]];
  const result = [];
  for (let i = 0; i < arr.length; i++) {
    const rest = arr.filter((_, j) => j !== i);
    for (const perm of permutations(rest)) result.push([arr[i], ...perm]);
  }
  return result;
}

export function isSolvable(numbers) {
  const ops = ["+", "-", "*", "/"];
  for (const [a, b, c, d] of permutations(numbers)) {
    for (const op1 of ops) {
      for (const op2 of ops) {
        for (const op3 of ops) {
          // All 5 ways to parenthesise 4 numbers with 3 operators
          if (isTarget(applyOp(applyOp(applyOp(a,b,op1),c,op2),d,op3))) return true;
          if (isTarget(applyOp(applyOp(a,applyOp(b,c,op2),op1),d,op3))) return true;
          if (isTarget(applyOp(applyOp(a,b,op1),applyOp(c,d,op3),op2))) return true;
          if (isTarget(applyOp(a,applyOp(applyOp(b,c,op2),d,op3),op1))) return true;
          if (isTarget(applyOp(a,applyOp(b,applyOp(c,d,op3),op2),op1))) return true;
        }
      }
    }
  }
  return false;
}

function formatExpr(expr) {
  return expr.replace(/\*/g, "×").replace(/\//g, "÷");
}

export function getSolution(numbers) {
  const ops = ["+", "-", "*", "/"];

  for (const [a, b, c, d] of permutations(numbers)) {
    for (const op1 of ops) {
      for (const op2 of ops) {
        for (const op3 of ops) {
          const r1 = applyOp(a, b, op1);
          if (r1 === null) continue;
          const e1 = `(${a} ${op1} ${b})`;

          const r2 = applyOp(r1, c, op2);
          if (r2 !== null) {
            const e2 = `(${e1} ${op2} ${c})`;
            const r3 = applyOp(r2, d, op3);
            if (isTarget(r3)) return formatExpr(`(${e2} ${op3} ${d})`);
          }

          const r3b = applyOp(b, c, op2);
          if (r3b !== null) {
            const e3b = `(${b} ${op2} ${c})`;
            const r2b = applyOp(a, r3b, op1);
            if (r2b !== null) {
              const e2b = `(${a} ${op1} ${e3b})`;
              const r3 = applyOp(r2b, d, op3);
              if (isTarget(r3)) return formatExpr(`(${e2b} ${op3} ${d})`);
            }
          }

          const r4 = applyOp(c, d, op3);
          if (r4 !== null) {
            const e4 = `(${c} ${op3} ${d})`;
            const r2c = applyOp(a, b, op1);
            if (r2c !== null) {
              const e2c = `(${a} ${op1} ${b})`;
              const r3 = applyOp(r2c, r4, op2);
              if (isTarget(r3)) return formatExpr(`(${e2c} ${op2} ${e4})`);
            }
          }

          if (r3b !== null) {
            const e3b = `(${b} ${op2} ${c})`;
            const r4b = applyOp(r3b, d, op3);
            if (r4b !== null) {
              const e4b = `(${e3b} ${op3} ${d})`;
              const r3 = applyOp(a, r4b, op1);
              if (isTarget(r3)) return formatExpr(`(${a} ${op1} ${e4b})`);
            }
          }

          if (r4 !== null) {
            const e4 = `(${c} ${op3} ${d})`;
            const r5 = applyOp(b, r4, op2);
            if (r5 !== null) {
              const e5 = `(${b} ${op2} ${e4})`;
              const r3 = applyOp(a, r5, op1);
              if (isTarget(r3)) return formatExpr(`(${a} ${op1} ${e5})`);
            }
          }
        }
      }
    }
  }
  return null;
}

export function getRandomSolvablePuzzle() {
  let numbers;
  do {
    numbers = Array.from({ length: 4 }, () => Math.floor(Math.random() * 13) + 1);
  } while (!isSolvable(numbers));
  return numbers;
}