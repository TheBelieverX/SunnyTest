import React, { useEffect, useState } from 'react';
import { Mic, Sparkles } from 'lucide-react';

type Lang = 'ro-RO' | 'en-US';

interface Props {
  language: Lang;
}

type Phase = { kind: 'intro' | 'say' | 'paint' | 'scene'; ms: number; line: 0 | 1 };

// Total loop length is 26 seconds.
const PHASES: Phase[] = [
  { kind: 'intro', ms: 6000, line: 0 },
  { kind: 'say', ms: 5000, line: 0 },
  { kind: 'paint', ms: 2500, line: 0 },
  { kind: 'scene', ms: 4000, line: 0 },
  { kind: 'say', ms: 3500, line: 1 },
  { kind: 'paint', ms: 2000, line: 1 },
  { kind: 'scene', ms: 3000, line: 1 },
];

const LINES: Record<Lang, string[]> = {
  'ro-RO': [
    'Trei unicorni trăiesc într-o pădure magică.',
    'Într-o zi, găsesc un castel pe deal.',
  ],
  'en-US': [
    'Three unicorns live in a magic forest.',
    'One day, they find a castle on the hill.',
  ],
};

const COPY: Record<Lang, { title: string; steps: string[]; hint: string; intro: string; introAlt: string }> = {
  'ro-RO': {
    title: 'Cum funcționează',
    intro: 'Citiți cu voce tare dintr-o carte, lângă un ecran.',
    introAlt: 'Un tată citește cu voce tare unei fetițe, iar pe tabletă apare un castel pictat.',
    steps: ['1. Spune o poveste', '2. Aplicația o pictează', '3. Povestea continuă'],
    hint: 'Apasă butonul de jos și începe povestea ta.',
  },
  'en-US': {
    title: 'How it works',
    intro: 'Read a book aloud, next to a screen.',
    introAlt: 'A dad reads aloud to his daughter while a painted castle appears on the tablet.',
    steps: ['1. Tell a story', '2. The app paints it', '3. The story goes on'],
    hint: 'Tap the button below and start your story.',
  },
};

const TOTAL = PHASES.reduce((s, p) => s + p.ms, 0);

export const DemoPlayer: React.FC<Props> = ({ language }) => {
  const [t, setT] = useState(0);
  const reducedMotion =
    typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

  useEffect(() => {
    if (reducedMotion) return;
    const start = Date.now();
    const id = setInterval(() => setT((Date.now() - start) % TOTAL), 80);
    return () => clearInterval(id);
  }, [reducedMotion]);

  let phaseIndex = 0;
  let phaseStart = 0;
  if (reducedMotion) {
    phaseIndex = 0;
  } else {
    let acc = 0;
    for (let i = 0; i < PHASES.length; i++) {
      if (t < acc + PHASES[i].ms) {
        phaseIndex = i;
        phaseStart = acc;
        break;
      }
      acc += PHASES[i].ms;
    }
  }
  const phase = PHASES[phaseIndex];
  const elapsed = t - phaseStart;
  const text = LINES[language][phase.line];
  const typed =
    phase.kind === 'say' && !reducedMotion
      ? text.slice(0, Math.ceil((text.length * Math.min(1, elapsed / (phase.ms - 800)))))
      : text;
  const copy = COPY[language];
  const activeStep = phase.kind === 'intro' ? -1 : phase.line === 1 ? 2 : phase.kind === 'say' ? 0 : 1;

  return (
    <div className="absolute inset-0 flex flex-col bg-white" aria-label={copy.title}>
      <div className="flex-1 relative overflow-hidden">
        {phase.kind === 'intro' ? (
          <div className="absolute inset-0 flex flex-col items-center justify-center bg-magic-50 animate-fade-in">
            <img
              src="/demo-reading.jpg"
              alt={copy.introAlt}
              className="min-h-0 flex-1 w-full object-contain"
              decoding="async"
            />
            <p className="px-4 pb-3 text-center text-sm md:text-lg font-display font-bold text-magic-800">
              {copy.intro}
            </p>
          </div>
        ) : phase.kind === 'scene' ? (
          <div
            key={phaseIndex}
            className={`absolute inset-0 flex flex-col items-center justify-center animate-fade-in ${
              phase.line === 0
                ? 'bg-gradient-to-b from-sky-200 to-emerald-200'
                : 'bg-gradient-to-b from-purple-300 to-pink-200'
            }`}
          >
            {phase.line === 1 && <div className="text-6xl md:text-8xl mb-2">🏰</div>}
            <div className="text-4xl md:text-6xl tracking-widest">
              {phase.line === 0 ? '🌲🌲🦄🦄🦄🌲🌲' : '🦄🦄🦄'}
            </div>
            {phase.line === 0 && <div className="text-3xl mt-2">✨🌸✨</div>}
          </div>
        ) : (
          <div className="absolute inset-0 flex flex-col items-center justify-center p-6 text-center bg-magic-50">
            {phase.kind === 'say' ? (
              <>
                <div className="bg-magic-500 text-white p-4 rounded-full mb-4 animate-pulse">
                  <Mic className="w-8 h-8" />
                </div>
                <p className="text-lg md:text-2xl font-display text-magic-800 font-bold min-h-[3.5rem]">
                  “{typed}”
                </p>
              </>
            ) : (
              <div className="flex items-center gap-3 bg-white px-6 py-3 rounded-full shadow">
                <Sparkles className="w-5 h-5 text-magic-500 animate-spin" />
                <span className="font-display font-bold text-magic-800">
                  {language === 'ro-RO' ? 'Se pictează...' : 'Painting...'}
                </span>
              </div>
            )}
          </div>
        )}
      </div>

      <div className="bg-white px-4 py-3 border-t border-magic-100">
        <div className="flex justify-center gap-2 flex-wrap text-[11px] md:text-xs font-bold">
          {copy.steps.map((s, i) => (
            <span
              key={s}
              className={`px-2 py-1 rounded-full transition-colors ${
                i === activeStep ? 'bg-magic-500 text-white' : 'bg-magic-50 text-magic-600'
              }`}
            >
              {s}
            </span>
          ))}
        </div>
        <p className="text-center text-xs md:text-sm text-gray-500 mt-2">{copy.hint}</p>
      </div>
    </div>
  );
};
