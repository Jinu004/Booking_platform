// "1 patient", "2 patients": the count followed by the singular or plural noun.
// Pass the plural form as the third argument when it is not just the noun plus "s" (for example 'staff member' -> 'staff members' works with the default).
export function plural(count, singular, pluralForm) {
  const n = Number(count) || 0;
  return `${n} ${n === 1 ? singular : (pluralForm || `${singular}s`)}`;
}

// 10 -> "10 am", 19 -> "7 pm", 0 -> "12 am", 12 -> "12 pm"
export function hourLabel(hour24) {
  const h = Number(hour24);
  if (!Number.isInteger(h) || h < 0 || h > 23) return '';
  const suffix = h >= 12 ? 'pm' : 'am';
  return `${h % 12 === 0 ? 12 : h % 12} ${suffix}`;
}
