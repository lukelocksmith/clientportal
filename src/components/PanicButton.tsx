'use client'
import { useState, useEffect } from 'react'
import { AlertTriangle, X, Send, CheckCircle2 } from 'lucide-react'

interface Props {
  slug: string
}

type State = 'idle' | 'open' | 'sending' | 'sent'

export function PanicButton({ slug }: Props) {
  const [state, setState] = useState<State>('idle')
  const [message, setMessage] = useState('')
  const [alertId, setAlertId] = useState<string | null>(null)
  const [acknowledged, setAcknowledged] = useState(false)

  // Poll for acknowledgment after sending
  useEffect(() => {
    if (state !== 'sent' || !alertId || acknowledged) return
    const interval = setInterval(async () => {
      const res = await fetch(`/api/panic?alertId=${alertId}`)
      if (res.ok) {
        const data = await res.json()
        if (data.acknowledged) {
          setAcknowledged(true)
          clearInterval(interval)
        }
      }
    }, 5000)
    return () => clearInterval(interval)
  }, [state, alertId, acknowledged])

  async function handleSend() {
    if (!message.trim()) return
    setState('sending')
    try {
      const res = await fetch('/api/panic', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ slug, message }),
      })
      if (res.ok) {
        const data = await res.json()
        setAlertId(data.alertId)
        setState('sent')
      } else {
        setState('open')
      }
    } catch {
      setState('open')
    }
  }

  function reset() {
    setState('idle')
    setMessage('')
    setAlertId(null)
    setAcknowledged(false)
  }

  return (
    <>
      <button
        onClick={() => setState('open')}
        className="inline-flex items-center gap-1.5 rounded-md bg-red-600 px-3 py-1.5 text-sm font-medium text-white shadow hover:bg-red-700 transition-colors"
        title="Wyślij alarm do agencji"
      >
        <AlertTriangle className="h-4 w-4" />
        Alarm
      </button>

      {state !== 'idle' && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="bg-white rounded-xl shadow-2xl w-full max-w-md">
            {/* Header */}
            <div className="flex items-center justify-between px-5 py-4 border-b border-red-100 bg-red-50 rounded-t-xl">
              <div className="flex items-center gap-2">
                <AlertTriangle className="h-5 w-5 text-red-600" />
                <span className="font-semibold text-red-700">Alarm dla agencji</span>
              </div>
              <button onClick={reset} className="text-gray-400 hover:text-gray-600">
                <X className="h-5 w-5" />
              </button>
            </div>

            <div className="p-5">
              {(state === 'open' || state === 'sending') && (
                <>
                  <p className="text-sm text-gray-600 mb-3">
                    Opisz krótko co się dzieje — powiadomimy zespół natychmiast.
                  </p>
                  <textarea
                    value={message}
                    onChange={e => setMessage(e.target.value)}
                    placeholder="np. Strona główna przestała działać, nie można składać zamówień"
                    className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm resize-none focus:outline-none focus:ring-2 focus:ring-red-500"
                    rows={4}
                    autoFocus
                  />
                  <div className="flex gap-2 mt-3">
                    <button
                      onClick={reset}
                      className="flex-1 rounded-lg border border-gray-200 px-4 py-2 text-sm text-gray-600 hover:bg-gray-50"
                    >
                      Anuluj
                    </button>
                    <button
                      onClick={handleSend}
                      disabled={!message.trim() || state === 'sending'}
                      className="flex-1 inline-flex items-center justify-center gap-2 rounded-lg bg-red-600 px-4 py-2 text-sm font-medium text-white hover:bg-red-700 disabled:opacity-50"
                    >
                      <Send className="h-4 w-4" />
                      {state === 'sending' ? 'Wysyłanie...' : 'Wyślij alarm'}
                    </button>
                  </div>
                </>
              )}

              {state === 'sent' && (
                <div className="text-center py-4">
                  {acknowledged ? (
                    <>
                      <CheckCircle2 className="h-12 w-12 text-green-500 mx-auto mb-3" />
                      <p className="font-semibold text-gray-900">Zespół important reaguje!</p>
                      <p className="text-sm text-gray-500 mt-1 leading-relaxed">Ktoś z zespołu potwierdził że zajmuje się problemem. Skontaktują się z Tobą mailowo lub telefonicznie.</p>
                    </>
                  ) : (
                    <>
                      <CheckCircle2 className="h-12 w-12 text-green-500 mx-auto mb-3" />
                      <p className="font-semibold text-gray-900">Zgłoszenie wysłane!</p>
                      <p className="text-sm text-gray-500 mt-1 leading-relaxed">
                        Zespół important został poinformowany. Skontaktują się z Tobą mailowo lub telefonicznie.
                      </p>
                    </>
                  )}
                  <button
                    onClick={reset}
                    className="mt-4 text-sm text-gray-400 hover:text-gray-600 underline"
                  >
                    Zamknij
                  </button>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </>
  )
}
