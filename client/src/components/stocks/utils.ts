export function money(val: number | string, compact = false): string {
  const n = parseFloat(String(val));
  if (isNaN(n)) return '—';
  return '$' + n.toLocaleString('en-US', {
    minimumFractionDigits: compact ? 0 : 2,
    maximumFractionDigits: 2,
  });
}

export function sign(n: number): string { return n >= 0 ? '+' : ''; }
