// web/src/terminal/logical.ts
// 自动换行逻辑行的单元格拼接。纯函数，便于 Node 测试。
import { isPlainBlankCell, type ScreenCell } from '../../../shared/terminal/vt.ts';

export function firstContentCell(row: readonly ScreenCell[]): ScreenCell | undefined {
  for (const cell of row) if (cell.char !== '') return cell;
  return undefined;
}

export function trimTrailingPlainBlanks(row: readonly ScreenCell[]): readonly ScreenCell[] {
  let end = row.length;
  while (end > 0 && isPlainBlankCell(row[end - 1])) end--;
  return end === row.length ? row : row.slice(0, end);
}

/**
 * 把一条逻辑行覆盖的物理行拼成单元格数组。
 * 下一行以宽字符开头时，本行末尾的空格是“宽字符放不下”留下的占位，不是内容。
 */
export function joinLogicalCells(rows: readonly (readonly ScreenCell[])[]): ScreenCell[] {
  if (rows.length === 1) return rows[0] as ScreenCell[];
  const cells: ScreenCell[] = [];
  for (let index = 0; index < rows.length; index++) {
    const row = rows[index];
    const next = rows[index + 1];
    const nextStartsWide = !!next && firstContentCell(next)?.wide === true;
    for (const cell of nextStartsWide ? trimTrailingPlainBlanks(row) : row) cells.push(cell);
  }
  return cells;
}
