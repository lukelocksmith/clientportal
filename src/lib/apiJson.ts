/**
 * Bezpieczne czytanie ciała JSON. Popsuty JSON (zły content-type, obcięty
 * strumień) rzuca SyntaxError, który bez tego helpera umykał poza try/catch
 * trasy i kończył się gołym 500 zamiast czystego 400.
 *
 * Zwraca `null` przy porażce; schemat Zoda i tak odrzuci null, więc trasa nie
 * musi rozróżniać „nie sparsowano" od „nie przeszedł schematu".
 */
export async function readJson(request: Request): Promise<unknown> {
  try {
    return await request.json()
  } catch {
    return null
  }
}
