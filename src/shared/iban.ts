// IBAN validation. Pure functions, no runtime imports: used inside the workflow sandbox
// (update validator) as well as by the mock bank.

const LENGTH_BY_COUNTRY: Record<string, number> = {
  NL: 18,
  BE: 16,
  DE: 22,
  FR: 27,
  LU: 20,
  GB: 22,
};

export const normalizeIban = (iban: string): string => iban.replace(/\s+/g, '').toUpperCase();

/** Returns an error message, or undefined when the IBAN is well-formed with a valid mod-97 checksum. */
export function ibanError(input: string | undefined): string | undefined {
  if (!input?.trim()) return 'IBAN is required';
  const iban = normalizeIban(input);
  if (!/^[A-Z]{2}\d{2}[A-Z0-9]+$/.test(iban)) return 'IBAN must start with a country code and 2 check digits';

  const expectedLength = LENGTH_BY_COUNTRY[iban.slice(0, 2)];
  if (expectedLength ? iban.length !== expectedLength : iban.length < 15 || iban.length > 34) {
    return `IBAN has the wrong length for ${iban.slice(0, 2)}${expectedLength ? ` (expected ${expectedLength})` : ''}`;
  }

  // Move the first 4 characters to the end, turn letters into numbers (A=10 ... Z=35), mod 97 must be 1.
  const rearranged = iban.slice(4) + iban.slice(0, 4);
  let remainder = 0;
  for (const char of rearranged) {
    const value = char >= 'A' ? (char.charCodeAt(0) - 55).toString() : char;
    for (const digit of value) remainder = (remainder * 10 + Number(digit)) % 97;
  }
  return remainder === 1 ? undefined : 'IBAN checksum is invalid (check for typos)';
}

/** Formats as groups of 4, e.g. "NL91 ABNA 0417 1643 00". */
export const formatIban = (iban: string): string => normalizeIban(iban).replace(/(.{4})(?=.)/g, '$1 ');
