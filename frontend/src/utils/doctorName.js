// Doctor names are stored with their title ("Dr. Anil"). These helpers keep the title from being doubled or cut wrongly.

// A leading "Dr" counts as the title only when a dot or a space follows it: "Dr. Anil", "Dr.Anil", "dr anil" match; "Drishti" does not.
export const DOCTOR_PREFIX_RE = /^dr(\.\s*|\s+)/i;

// "Anil" -> "Dr. Anil"; a name that already starts with the title is returned as it is; empty or non-text input gives ''.
export function withDoctorPrefix(name) {
  if (typeof name !== 'string') return '';
  const text = name.trim();
  if (!text) return '';
  return DOCTOR_PREFIX_RE.test(text) ? name : `Dr. ${text}`;
}

// The first letter of the name without its title: "Dr. Radhakrishnan" -> "R", "Dr Anil" -> "A", "Drishti" -> "D". '' for empty input.
export function doctorInitial(name) {
  if (typeof name !== 'string' || !name) return '';
  return name.replace(DOCTOR_PREFIX_RE, '').charAt(0);
}
