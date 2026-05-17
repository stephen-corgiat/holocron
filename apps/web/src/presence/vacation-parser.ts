/**
 * Frontend vacation-block parser — pure module, no side effects.
 * Mirrors apps/api/src/presence/presence-vacation-parser.ts.
 *
 * Format: one entry per line  →  M/D/YY - M/D/YY: Label
 */

export interface VacationEntry {
  start: string; // ISO YYYY-MM-DD
  end: string;   // ISO YYYY-MM-DD
  label: string;
}

export interface ParseError {
  line: number;
  text: string;
  message: string;
}

export interface ParseResult {
  entries: VacationEntry[];
  errors: ParseError[];
}

const DATE_RE = /^(\d{1,2})\/(\d{1,2})\/(\d{2})$/;
const LINE_RE = /^(.+?) - (.+?): (.+)$/;

function parseDate(token: string): string | null {
  const m = DATE_RE.exec(token.trim());
  if (!m) return null;
  const month = Number(m[1]);
  const day = Number(m[2]);
  const year = 2000 + Number(m[3]);
  if (month < 1 || month > 12) return null;
  if (day < 1 || day > 31) return null;
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

export function parseVacationsBlock(text: string): ParseResult {
  const entries: VacationEntry[] = [];
  const errors: ParseError[] = [];

  const lines = text.split('\n');
  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i];
    const trimmed = raw?.trim() ?? '';
    if (trimmed === '') continue;

    const lineNum = i + 1;
    const match = LINE_RE.exec(trimmed);
    if (!match) {
      errors.push({
        line: lineNum,
        text: trimmed,
        message: `expected "M/D/YY - M/D/YY: Label" — couldn't find separator " - " or colon-label`,
      });
      continue;
    }

    const [, startToken, endToken, label] = match;

    const start = parseDate(startToken ?? '');
    if (!start) {
      errors.push({
        line: lineNum,
        text: trimmed,
        message: `start date "${startToken}" is not a valid M/D/YY date`,
      });
      continue;
    }

    const end = parseDate(endToken ?? '');
    if (!end) {
      errors.push({
        line: lineNum,
        text: trimmed,
        message: `end date "${endToken}" is not a valid M/D/YY date`,
      });
      continue;
    }

    if (start > end) {
      errors.push({
        line: lineNum,
        text: trimmed,
        message: `start date ${start} is after end date ${end}`,
      });
      continue;
    }

    entries.push({ start, end, label: (label ?? '').trim() });
  }

  return { entries, errors };
}
