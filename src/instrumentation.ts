import type { Instrumentation } from 'next'

/**
 * PUNKT, W KTÓRYM PORTAL DOWIADUJE SIĘ O WŁASNYCH AWARIACH.
 *
 * `onRequestError` woła Next dla KAŻDEGO błędu serwera, który złapał: w trasie
 * API, w renderowaniu komponentu serwerowego, w akcji. Dzięki temu nie trzeba
 * o tym pamiętać przy dodawaniu nowej trasy, a to jest tutaj cała wartość:
 * rejestr, który trzeba pamiętać uzupełnić, po pewnym czasie kłamie przez
 * pominięcie.
 *
 * Do 14.09 portal nie zbierał tych błędów nigdzie. Klient dostawał kod 500,
 * my wpis w logu kontenera, do którego nikt nie zagląda bez powodu.
 *
 * Import modułu zapisu jest DYNAMICZNY i w środku funkcji, bo ten plik ładuje
 * się także w środowisku brzegowym, gdzie sterownika bazy nie ma. Statyczny
 * import wciągnąłby go do każdej paczki.
 */
export const onRequestError: Instrumentation.onRequestError = async (err, request, context) => {
  try {
    const { zapiszBladSerwera } = await import('@/lib/appErrors')
    await zapiszBladSerwera(err as Error & { digest?: string }, {
      path: request.path,
      method: request.method,
      routeType: context.routeType,
    })
  } catch (e) {
    // Obsługa błędu nie może rzucić błędem. Zostaje log, czyli to, co mieliśmy
    // przedtem, zamiast pętli awarii.
    console.error('[instrumentation] nie udało się obsłużyć błędu żądania:', e)
  }
}
