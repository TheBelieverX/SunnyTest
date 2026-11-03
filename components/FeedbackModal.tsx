import React, { useEffect, useRef, useState } from 'react';
import { X } from 'lucide-react';
import { authFetch } from '../services/api';

type Language = 'ro-RO' | 'en-US';
type Category = 'bug' | 'idea' | 'other';

const COPY = {
  'ro-RO': {
    title: 'Trimite feedback',
    close: 'Închide formularul de feedback',
    category: 'Tip de feedback',
    categories: { bug: 'Problemă', idea: 'Idee', other: 'Altceva' },
    message: 'Mesaj',
    placeholder: 'Spune-ne ce s-a întâmplat sau ce ai vrea să îmbunătățim.',
    rating: 'Cum a fost experiența? (opțional)',
    rate: (rating: number) => `Evaluează cu ${rating} din 5`,
    followUp: 'Sunt de acord să fiu contactat(ă) pentru detalii.',
    privacy: 'Nu atașăm audio, transcrieri, textul poveștii sau imagini.',
    submit: 'Trimite feedback',
    sending: 'Se trimite...',
    successTitle: 'Mulțumim pentru feedback!',
    success: 'Mesajul tău a fost trimis.',
    done: 'Gata',
    error: 'Feedbackul nu a putut fi trimis. Încearcă din nou.',
    rateLimited: 'Ai trimis prea multe mesaje. Încearcă din nou mai târziu.',
    required: 'Mesajul este obligatoriu.',
    tooLong: 'Mesajul trebuie să aibă cel mult 1000 de caractere.',
  },
  'en-US': {
    title: 'Send feedback',
    close: 'Close feedback form',
    category: 'Feedback type',
    categories: { bug: 'Bug', idea: 'Idea', other: 'Other' },
    message: 'Message',
    placeholder: 'Tell us what happened or what you would like us to improve.',
    rating: 'How was your experience? (optional)',
    rate: (rating: number) => `Rate ${rating} out of 5`,
    followUp: 'I agree to be contacted for more details.',
    privacy: 'We do not attach audio, transcripts, story text, or images.',
    submit: 'Send feedback',
    sending: 'Sending...',
    successTitle: 'Thanks for your feedback!',
    success: 'Your message has been sent.',
    done: 'Done',
    error: 'Feedback could not be sent. Please try again.',
    rateLimited: 'You have sent too many messages. Please try again later.',
    required: 'A message is required.',
    tooLong: 'The message must be 1000 characters or fewer.',
  },
} as const;

export function FeedbackModal({ language, onClose }: { language: Language; onClose: () => void }) {
  const t = COPY[language];
  const [category, setCategory] = useState<Category>('other');
  const [message, setMessage] = useState('');
  const [rating, setRating] = useState<number | null>(null);
  const [followUp, setFollowUp] = useState(false);
  const [busy, setBusy] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [error, setError] = useState('');
  const messageRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    const previousFocus = document.activeElement;
    messageRef.current?.focus();
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('keydown', handleKeyDown);
      if (previousFocus instanceof HTMLElement) previousFocus.focus();
    };
  }, [onClose]);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (busy) return;
    const trimmedMessage = message.trim();
    if (!trimmedMessage) {
      setError(t.required);
      return;
    }
    if (trimmedMessage.length > 1000) {
      setError(t.tooLong);
      return;
    }

    setBusy(true);
    setError('');
    try {
      const response = await authFetch(
        '/api/feedback',
        { category, message: trimmedMessage, rating, followUp },
        AbortSignal.timeout(15_000)
      );
      if (response.status === 429) setError(t.rateLimited);
      else if (!response.ok) setError(t.error);
      else setSubmitted(true);
    } catch {
      setError(t.error);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div
      className="fixed inset-0 flex items-end sm:items-center justify-center bg-black/50 p-0 sm:p-4"
      style={{ zIndex: 60 }}
    >
      <section
        role="dialog"
        aria-modal="true"
        aria-labelledby="feedback-title"
        className="w-full max-w-lg max-h-[90dvh] overflow-y-auto rounded-t-2xl sm:rounded-2xl bg-white p-5 sm:p-6 shadow-2xl"
      >
        <div className="mb-4 flex items-center justify-between gap-4">
          <h2 id="feedback-title" className="text-xl font-bold text-gray-800">
            {submitted ? t.successTitle : t.title}
          </h2>
          <button
            type="button"
            onClick={onClose}
            aria-label={t.close}
            className="rounded-full p-2 text-gray-500 hover:bg-gray-100"
          >
            <X size={20} />
          </button>
        </div>

        {submitted ? (
          <div className="space-y-5">
            <p role="status" className="text-gray-700">{t.success}</p>
            <button type="button" onClick={onClose} className="w-full rounded-xl bg-magic-600 p-3 font-semibold text-white hover:bg-magic-700">
              {t.done}
            </button>
          </div>
        ) : (
          <form onSubmit={submit} className="space-y-4">
            <label className="block space-y-1.5 text-sm font-medium text-gray-700">
              <span>{t.category}</span>
              <select
                aria-label={t.category}
                value={category}
                onChange={event => setCategory(event.target.value as Category)}
                className="w-full rounded-lg border border-gray-300 bg-white p-3 text-base"
              >
                {(Object.keys(t.categories) as Category[]).map(value => (
                  <option key={value} value={value}>{t.categories[value]}</option>
                ))}
              </select>
            </label>

            <label className="block space-y-1.5 text-sm font-medium text-gray-700">
              <span>{t.message}</span>
              <textarea
                ref={messageRef}
                required
                maxLength={1000}
                rows={4}
                value={message}
                onChange={event => setMessage(event.target.value)}
                placeholder={t.placeholder}
                className="w-full resize-y rounded-lg border border-gray-300 p-3 text-base"
              />
              <span className="block text-right text-xs font-normal text-gray-500">{message.length}/1000</span>
            </label>

            <fieldset>
              <legend className="mb-2 text-sm font-medium text-gray-700">{t.rating}</legend>
              <div className="flex gap-2">
                {[1, 2, 3, 4, 5].map(value => (
                  <button
                    key={value}
                    type="button"
                    aria-label={t.rate(value)}
                    aria-pressed={rating === value}
                    onClick={() => setRating(rating === value ? null : value)}
                    className={`min-h-11 min-w-11 rounded-lg border text-base font-semibold ${rating === value ? 'border-magic-600 bg-magic-100 text-magic-800' : 'border-gray-300 text-gray-700 hover:bg-gray-50'}`}
                  >
                    {value}
                  </button>
                ))}
              </div>
            </fieldset>

            <label className="flex min-h-11 items-center gap-3 text-sm text-gray-700">
              <input
                type="checkbox"
                checked={followUp}
                onChange={event => setFollowUp(event.target.checked)}
                className="h-5 w-5 accent-purple-600"
              />
              <span>{t.followUp}</span>
            </label>

            <p className="text-xs text-gray-500">{t.privacy}</p>
            {error && <p role="alert" className="text-sm text-red-700">{error}</p>}
            <button
              type="submit"
              disabled={busy}
              className="w-full rounded-xl bg-magic-600 p-3 font-semibold text-white hover:bg-magic-700 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {busy ? t.sending : t.submit}
            </button>
          </form>
        )}
      </section>
    </div>
  );
}
