const EPSILON = 1e-9;
const OPS_MATH = ["+", "-", "*", "/"];
const OPS_DISPLAY = ["+", "−", "×", "÷"];

function applyOp(a, b, op) {
  if (op === "+") return a + b;
  if (op === "-") return a - b;
  if (op === "*") return a * b;
  if (op === "/") return Math.abs(b) < EPSILON ? null : a / b;
}

function isTarget(n) { return n !== null && Math.abs(n - 24) < EPSILON; }

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
  for (const [a, b, c, d] of permutations(numbers)) {
    for (const op1 of OPS_MATH) for (const op2 of OPS_MATH) for (const op3 of OPS_MATH) {
      if (isTarget(applyOp(applyOp(applyOp(a,b,op1),c,op2),d,op3))) return true;
      if (isTarget(applyOp(applyOp(a,applyOp(b,c,op2),op1),d,op3))) return true;
      if (isTarget(applyOp(applyOp(a,b,op1),applyOp(c,d,op3),op2))) return true;
      if (isTarget(applyOp(a,applyOp(applyOp(b,c,op2),d,op3),op1))) return true;
      if (isTarget(applyOp(a,applyOp(b,applyOp(c,d,op3),op2),op1))) return true;
    }
  }
  return false;
}

// Returns a human-readable solution string, or null
export function findSolution(numbers) {
  const sym = { "+":"+", "-":"−", "*":"×", "/":"÷" };
  for (const [a, b, c, d] of permutations(numbers)) {
    for (const o1 of OPS_MATH) for (const o2 of OPS_MATH) for (const o3 of OPS_MATH) {
      // ((a o1 b) o2 c) o3 d
      if (isTarget(applyOp(applyOp(applyOp(a,b,o1),c,o2),d,o3)))
        return `((${a} ${sym[o1]} ${b}) ${sym[o2]} ${c}) ${sym[o3]} ${d}`;
      // (a o1 (b o2 c)) o3 d
      if (isTarget(applyOp(applyOp(a,applyOp(b,c,o2),o1),d,o3)))
        return `(${a} ${sym[o1]} (${b} ${sym[o2]} ${c})) ${sym[o3]} ${d}`;
      // (a o1 b) o2 (c o3 d)
      if (isTarget(applyOp(applyOp(a,b,o1),applyOp(c,d,o3),o2)))
        return `(${a} ${sym[o1]} ${b}) ${sym[o2]} (${c} ${sym[o3]} ${d})`;
      // a o1 ((b o2 c) o3 d)
      if (isTarget(applyOp(a,applyOp(applyOp(b,c,o2),d,o3),o1)))
        return `${a} ${sym[o1]} ((${b} ${sym[o2]} ${c}) ${sym[o3]} ${d})`;
      // a o1 (b o2 (c o3 d))
      if (isTarget(applyOp(a,applyOp(b,applyOp(c,d,o3),o2),o1)))
        return `${a} ${sym[o1]} (${b} ${sym[o2]} (${c} ${sym[o3]} ${d}))`;
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