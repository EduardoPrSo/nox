export function projectMonthlyCost(
  spent: number,
  elapsedDays: number,
  daysInMonth: number,
): number {
  if (spent < 0 || elapsedDays <= 0 || daysInMonth < elapsedDays) return 0;
  return Number(((spent / elapsedDays) * daysInMonth).toFixed(2));
}

export function budgetProgress(spent: number, budget: number): number {
  if (budget <= 0) return 0;
  return Math.min(100, Math.max(0, (spent / budget) * 100));
}
