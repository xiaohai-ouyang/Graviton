/**
 * 自适应网格列数：
 * - 单条（<= 1）时始终占满整行宽度（`grid-cols-1`）；
 * - 恰好 2 条且提供了 `twoColsClass` 时最多两列，避免 3 列网格右侧留白；
 * - 更多条时使用完整多列布局类名。
 *
 * 调用方需传入完整静态 Tailwind 类名，确保 Tailwind CSS v4 在构建期能静态扫描到。
 */
export function adaptiveGridCols(
  itemCount: number,
  multiColsClass: string,
  twoColsClass?: string
): string {
  if (itemCount <= 1) return 'grid-cols-1';
  if (itemCount === 2 && twoColsClass) return twoColsClass;
  return multiColsClass;
}
