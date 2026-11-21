export const MAX_SAFE_CASH = 9_000_000_000_000_000n;

export function assertPositiveAmount(amount: bigint): void {
  if (amount <= 0n) throw new Error("Amount must be greater than zero");
  if (amount > MAX_SAFE_CASH) throw new Error("Amount exceeds the supported balance limit");
}

export function calculateNextBalance(current: bigint, direction: "CREDIT" | "DEBIT", amount: bigint): bigint {
  assertPositiveAmount(amount);
  if (current < 0n) throw new Error("Current balance cannot be negative");
  const next = direction === "CREDIT" ? current + amount : current - amount;
  if (next < 0n) throw new Error("Insufficient funds");
  if (next > MAX_SAFE_CASH) throw new Error("Balance limit exceeded");
  return next;
}

export function assertIdempotencyKey(key: string): void {
  if (!/^[A-Za-z0-9:_-]{12,128}$/.test(key)) throw new Error("Invalid idempotency key");
}
