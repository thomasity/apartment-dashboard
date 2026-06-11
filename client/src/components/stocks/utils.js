export function money(val, compact = false) {
  const n = parseFloat(val);
  if (isNaN(n)) return '—';
  return '$' + n.toLocaleString('en-US', {
    minimumFractionDigits: compact ? 0 : 2,
    maximumFractionDigits: 2,
  });
}

export function sign(n) { return n >= 0 ? '+' : ''; }
