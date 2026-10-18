// Pure helpers, no runtime imports (used inside the workflow sandbox).

const nameParts = (name: string) =>
  name
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z\s]/g, ' ')
    .split(/\s+/)
    .filter(Boolean);

/** "J. Jansen" matches "Jan Jansen": same surname and first initial, ignoring case, accents and punctuation. */
export function namesMatch(a: string, b: string): boolean {
  const [pa, pb] = [nameParts(a), nameParts(b)];
  return pa.length > 0 && pb.length > 0 && pa.at(-1) === pb.at(-1) && pa[0][0] === pb[0][0];
}
