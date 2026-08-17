import { budgetProgress, projectMonthlyCost } from './usage';

describe('usage projections', () => {
  it('projects monthly cost without pretending to know future usage', () => {
    expect(projectMonthlyCost(6.87, 16, 31)).toBe(13.31);
    expect(projectMonthlyCost(4, 0, 31)).toBe(0);
    expect(projectMonthlyCost(-1, 10, 31)).toBe(0);
  });

  it('clamps budget progress to a safe percentage', () => {
    expect(budgetProgress(6, 15)).toBe(40);
    expect(budgetProgress(20, 15)).toBe(100);
    expect(budgetProgress(-2, 15)).toBe(0);
    expect(budgetProgress(2, 0)).toBe(0);
  });
});
