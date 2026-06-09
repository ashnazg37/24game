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

export function getRandomSolvablePuzzle() {
  let numbers;
  do {
    numbers = Array.from({ length: 4 }, () => Math.floor(Math.random() * 13) + 1);
  } while (!isSolvable(numbers));
  return numbers;
}