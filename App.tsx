import React, { useState, useEffect, useRef, useCallback } from 'react';
import { Mic, MicOff, BookOpen, Clock, Terminal, X, Download, MessageSquare } from 'lucide-react';
import { WebSpeechSTTManager } from './services/webSpeechSTT';
import { BufferManager, GenerationRequest } from './services/bufferManager';
import { generateImageViaApi, downscaleImage, StoryBible, track, QuotaExceededError } from './services/api';
import { supabase } from './services/supabase';
import { Illustration, SessionStatus } from './types';
import { MagicButton } from './components/MagicButton';
import { BookViewer } from './components/BookViewer';
import { FeedbackModal } from './components/FeedbackModal';

const STRINGS = {
  'ro-RO': {
    title: 'Povești Magice',
    subtitle: 'Vizualizator de Povești',
    langTitle: 'Limba de citire',
    langLocked: 'Pune sesiunea pe pauză pentru a schimba limba',
    newStory: 'Poveste nouă',
    signOut: 'Deconectare',
    feedback: 'Trimite feedback',
    debugToggle: 'Arată/ascunde consola de depanare',
    timeline: 'Istoricul Poveștii',
    historyAlt: 'Istoric',
    words: 'Cuvinte',
    generating: 'Se generează',
    downloadLog: 'Descarcă jurnalul complet',
    waiting: 'Se așteaptă vorbirea...',
    pause: 'Pauză',
    start: 'Începe Citirea',
  },
  'en-US': {
    title: 'Magic Stories',
    subtitle: 'Story Visualizer',
    langTitle: 'Reading language',
    langLocked: 'Pause the session to change language',
    newStory: 'New story',
    signOut: 'Sign out',
    feedback: 'Send feedback',
    debugToggle: 'Toggle Debug Console',
    timeline: 'Story Timeline',
    historyAlt: 'History',
    words: 'Words',
    generating: 'Generating',
    downloadLog: 'Download Full Log',
    waiting: 'Waiting for speech...',
    pause: 'Pause',
    start: 'Start Reading',
  },
} as const;

export default function App() {
  const [status, setStatus] = useState<SessionStatus>(SessionStatus.IDLE);
  const [illustrations, setIllustrations] = useState<Illustration[]>([]);
  const [audioVolume, setAudioVolume] = useState(0);
  const [debugMode, setDebugMode] = useState(false);
  const [feedbackOpen, setFeedbackOpen] = useState(false);
  const closeFeedback = useCallback(() => setFeedbackOpen(false), []);
  const [transcripts, setTranscripts] = useState<string[]>([]);
  const [currentWordCount, setCurrentWordCount] = useState(0);
  const [activeGenerations, setActiveGenerations] = useState<string[]>([]);
  const storyBibleRef = useRef<StoryBible | null>(null);
  const lastImageRef = useRef<string | null>(null);
  const [language, setLanguage] = useState<'ro-RO' | 'en-US'>(
    () => (localStorage.getItem('storyLang') === 'en-US' ? 'en-US' : 'ro-RO')
  );
  const inSession = status === SessionStatus.LISTENING || status === SessionStatus.CONNECTING;
  const t = STRINGS[language];
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const displayed = illustrations.find(i => i.id === selectedId) ?? illustrations[0] ?? null;

  // A newly generated image takes over the main view again
  useEffect(() => { setSelectedId(null); }, [illustrations[0]?.id]);
  const transcriptsEndRef = useRef<HTMLDivElement>(null);
  const fullLogsRef = useRef<string[]>([]);
  
  const sttManagerRef = useRef<WebSpeechSTTManager | null>(null);
  const bufferManagerRef = useRef<BufferManager | null>(null);
  const generationMapRef = useRef<Map<string, GenerationRequest>>(new Map());

  // Initialize managers
  useEffect(() => {
    sttManagerRef.current = new WebSpeechSTTManager();
    bufferManagerRef.current = new BufferManager();
    

    // STT callbacks
    sttManagerRef.current.onStatusChange = (newStatus) => {
      if (newStatus === 'listening') setStatus(SessionStatus.LISTENING);
      else if (newStatus === 'connecting') setStatus(SessionStatus.CONNECTING);
      else if (newStatus === 'error') setStatus(SessionStatus.ERROR);
      else setStatus(SessionStatus.IDLE);
    };

    sttManagerRef.current.onTranscription = (text) => {
      const logLine = `[${new Date().toLocaleTimeString()}] 🎤 ${text}`;
      fullLogsRef.current.push(logLine);
      setTranscripts(prev => [...prev.slice(-49), logLine]);
      
      // Add to buffer and trigger generation if threshold hit
      bufferManagerRef.current?.addText(text);
    };

    sttManagerRef.current.onError = (err) => {
      const errorLog = `❌ STT ERROR: ${err.message}`;
      fullLogsRef.current.push(`[${new Date().toLocaleTimeString()}] ${errorLog}`);
      setTranscripts(prev => [...prev, errorLog]);
    };

    // Buffer Manager callbacks
    bufferManagerRef.current.onWordCountChange = (count) => {
      setCurrentWordCount(count);
    };

    bufferManagerRef.current.onGenerationRequest = (request) => {
      generationMapRef.current.set(request.id, request);
      setActiveGenerations(prev => [...prev, request.id]);

      const logLine = `📖 SOURCE: "${request.sourceText}..."`;
      fullLogsRef.current.push(`[${new Date().toLocaleTimeString()}] ${logLine}`);
      setTranscripts(prev => [...prev, logLine]);

      // Run generation asynchronously without blocking the callback
      (async () => {
        try {
          const genLog = `🎨 GENERATING...`;
          fullLogsRef.current.push(`[${new Date().toLocaleTimeString()}] ${genLog}`);
          setTranscripts(prev => [...prev, genLog]);

          // Log the description being sent to AI
          const descLog = `📝 DESCRIPTION: "${request.sourceText}"`;
          fullLogsRef.current.push(`[${new Date().toLocaleTimeString()}] ${descLog}`);
          setTranscripts(prev => [...prev, descLog]);

          // Step 2: Generate with the persistent story bible + previous picture for consistency
          const prevImage = lastImageRef.current ? await downscaleImage(lastImageRef.current) : null;
          const result = await generateImageViaApi(request.sourceText, storyBibleRef.current, prevImage);
          const imageUrl = result.image;
          storyBibleRef.current = result.storyBible;
          lastImageRef.current = imageUrl;

          const newIll: Illustration = {
            id: request.id,
            url: imageUrl,
            prompt: request.sourceText,
            sourceText: request.sourceText,
            timestamp: request.timestamp,
          };

          setIllustrations(prev => [newIll, ...prev]);
          fullLogsRef.current.push(`[${new Date().toLocaleTimeString()}] ✅ Image generated`);
          bufferManagerRef.current?.completeGeneration(request.id);
        } catch (e) {
          console.error("Generation failed:", e);
          const errorLog = e instanceof QuotaExceededError
            ? `🚫 Image limit reached. You have used all your images.`
            : `❌ GENERATION FAILED: ${e instanceof Error ? e.message : 'Unknown error'}`;
          fullLogsRef.current.push(`[${new Date().toLocaleTimeString()}] ${errorLog}`);
          setTranscripts(prev => [...prev, errorLog]);
          bufferManagerRef.current?.failGeneration(request.id);
        } finally {
          setActiveGenerations(prev => prev.filter(id => id !== request.id));
        }
      })();
    };

    return () => {
      sttManagerRef.current?.stop();
    };
  }, []);

  // Language can only change while no session is running
  useEffect(() => {
    if (inSession) return;
    sttManagerRef.current?.setLanguage(language);
    localStorage.setItem('storyLang', language);
  }, [language, inSession]);

  const startNewStory = () => {
    storyBibleRef.current = null;
    lastImageRef.current = null;
    setIllustrations([]);
    setSelectedId(null);
  };

  // Reading time: heartbeat every 30s while listening and the tab is visible
  useEffect(() => {
    if (status !== SessionStatus.LISTENING) return;
    track('listening_start');
    const id = setInterval(() => {
      if (document.visibilityState === 'visible') track('reading_heartbeat', { seconds: 30 });
    }, 30000);
    return () => { clearInterval(id); track('listening_stop'); };
  }, [status]);

  // Auto-scroll transcripts
  useEffect(() => {
    if (transcriptsEndRef.current) {
      transcriptsEndRef.current.scrollIntoView({ behavior: 'smooth' });
    }
  }, [transcripts]);

  const toggleListening = useCallback(async () => {
    if (status === SessionStatus.IDLE || status === SessionStatus.ERROR) {
      setTranscripts([]);
      setCurrentWordCount(0);
      setActiveGenerations([]);
      fullLogsRef.current = [];
      bufferManagerRef.current?.reset();
      fullLogsRef.current.push(`--- Session Started at ${new Date().toLocaleString()} ---`);
      await sttManagerRef.current?.start();
    } else {
      sttManagerRef.current?.stop();
      setAudioVolume(0);
    }
  }, [status]);

  const downloadLogs = () => {
    const element = document.createElement("a");
    const file = new Blob([fullLogsRef.current.join('\n')], {type: 'text/plain'});
    element.href = URL.createObjectURL(file);
    element.download = "debug_log.txt";
    document.body.appendChild(element);
    element.click();
    document.body.removeChild(element);
  };

  return (
    <div className="min-h-screen bg-magic-50 text-gray-800 font-sans selection:bg-magic-200 flex flex-col">
      {/* Header */}
      <header className="sticky top-0 z-50 bg-white/80 backdrop-blur-md border-b border-magic-100 shadow-sm transition-all duration-300">
        <div className="max-w-4xl mx-auto px-4 py-3 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="bg-magic-100 p-2 rounded-xl text-magic-600">
              <BookOpen size={24} strokeWidth={2.5} />
            </div>
            <div>
              <h1 className="text-xl font-display font-bold bg-gradient-to-r from-magic-600 to-purple-600 bg-clip-text text-transparent leading-none mb-1">
                {t.title}
              </h1>
              <p className="text-[10px] text-gray-500 font-bold tracking-widest uppercase">{t.subtitle}</p>
            </div>
          </div>
          
          <div className="flex items-center gap-3">
            {/* Language slider (locked during a session) */}
            <button
              type="button"
              role="switch"
              aria-checked={language === 'en-US'}
              disabled={inSession}
              onClick={() => setLanguage(language === 'ro-RO' ? 'en-US' : 'ro-RO')}
              title={inSession ? t.langLocked : t.langTitle}
              className={`relative flex items-center w-20 h-8 rounded-full bg-magic-100 border border-magic-200 transition-opacity ${inSession ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer'}`}
            >
              <span className={`absolute top-0.5 left-0.5 w-9 h-6 rounded-full bg-magic-500 shadow transition-transform duration-200 ${language === 'en-US' ? 'translate-x-10' : ''}`} />
              <span className={`relative z-10 w-1/2 text-center text-[11px] font-bold ${language === 'ro-RO' ? 'text-white' : 'text-magic-700'}`}>RO</span>
              <span className={`relative z-10 w-1/2 text-center text-[11px] font-bold ${language === 'en-US' ? 'text-white' : 'text-magic-700'}`}>EN</span>
            </button>

            {illustrations.length > 0 && !inSession && (
              <button onClick={startNewStory} className="text-xs text-gray-500 hover:text-gray-800 underline">
                {t.newStory}
              </button>
            )}
             {/* Audio Visualizer */}
            {status === SessionStatus.LISTENING && (
              <div className="flex items-center gap-1 h-8 px-3 bg-magic-50 rounded-full border border-magic-100">
                {[1, 2, 3, 4].map(i => (
                  <div 
                    key={i}
                    className="w-1 bg-magic-400 rounded-full transition-all duration-75"
                    style={{ 
                      height: `${Math.max(4, Math.min(24, audioVolume * (i * 0.5)))}px`,
                      opacity: audioVolume > 5 ? 1 : 0.3
                    }}
                  />
                ))}
              </div>
            )}
            
            {/* Parallel Generation Indicator */}
            {activeGenerations.length > 0 && (
              <div className="text-xs font-bold text-magic-600 bg-magic-100 px-2 py-1 rounded-full">
                {activeGenerations.length} 🎨
              </div>
            )}

            <button
              onClick={() => supabase.auth.signOut()}
              className="text-xs text-gray-500 hover:text-gray-800 underline"
            >
              {t.signOut}
            </button>

            <button
              type="button"
              onClick={() => setFeedbackOpen(true)}
              className="hidden sm:inline-flex items-center gap-1.5 rounded-lg border border-magic-200 px-2.5 py-2 text-xs font-semibold text-magic-700 hover:bg-magic-50"
            >
              <MessageSquare size={16} />
              {t.feedback}
            </button>

            {/* Debug Toggle */}
            <button 
              onClick={() => setDebugMode(!debugMode)}
              className={`p-2 rounded-full transition-colors ${debugMode ? 'bg-gray-800 text-white' : 'bg-gray-100 text-gray-500 hover:bg-gray-200'}`}
              title={t.debugToggle}
            >
              <Terminal size={18} />
            </button>
          </div>
        </div>
        <div className="max-w-4xl mx-auto flex justify-end px-4 pb-2 sm:hidden">
          <button
            type="button"
            onClick={() => setFeedbackOpen(true)}
            className="inline-flex min-h-11 items-center gap-2 rounded-lg border border-magic-200 bg-white px-3 text-sm font-semibold text-magic-700 shadow-sm hover:bg-magic-50"
          >
            <MessageSquare size={16} />
            {t.feedback}
          </button>
        </div>
      </header>

      <main className="flex-grow flex flex-col max-w-4xl mx-auto w-full px-4 pt-6 pb-24">
        <div className="w-full mb-8 relative z-10">
          <BookViewer 
            currentIllustration={displayed} 
            isGenerating={activeGenerations.length > 0} 
            language={language}
            inSession={inSession}
          />
        </div>

        {illustrations.length > 1 && (
          <div className="animate-fade-in">
            <div className="flex items-center gap-2 mb-4 text-gray-400 uppercase tracking-widest text-xs font-bold">
              <Clock size={12} />
              <span>{t.timeline}</span>
            </div>
            <div className="flex gap-4 overflow-x-auto pb-4 px-2 snap-x scrollbar-hide">
              {illustrations.filter(ill => ill.id !== displayed?.id).map((ill) => (
                <button
                  key={ill.id}
                  type="button"
                  onClick={() => setSelectedId(ill.id)}
                  className="flex-shrink-0 w-24 h-24 md:w-32 md:h-32 rounded-lg overflow-hidden border-2 border-white shadow-md opacity-60 hover:opacity-100 transition-opacity snap-start cursor-pointer"
                >
                  <img src={ill.url} alt={t.historyAlt} className="w-full h-full object-cover" />
                </button>
              ))}
            </div>
          </div>
        )}
      </main>

      {/* Debug Console */}
      {debugMode && (
        <div className="fixed bottom-28 left-4 right-4 md:left-auto md:right-4 md:w-96 z-40 bg-gray-900/90 backdrop-blur text-green-400 font-mono text-xs rounded-lg shadow-xl overflow-hidden border border-gray-700 animate-fade-in">
          <div className="flex items-center justify-between px-3 py-2 bg-gray-800/50 border-b border-gray-700">
            <span className="font-bold flex items-center gap-2">
              <Terminal size={12} /> 
              <span>{t.words}: <span className="text-white">{currentWordCount}</span> / 70</span>
                            {activeGenerations.length > 0 && <span className="ml-2">| {t.generating}: {activeGenerations.length}</span>}
            </span>
            <div className="flex items-center gap-2">
              <button 
                onClick={downloadLogs} 
                className="text-gray-400 hover:text-white p-1 hover:bg-gray-700 rounded transition-colors"
                title={t.downloadLog}
              >
                <Download size={14} />
              </button>
              <button onClick={() => setDebugMode(false)} className="text-gray-400 hover:text-white p-1 hover:bg-gray-700 rounded transition-colors">
                <X size={14} />
              </button>
            </div>
          </div>
          <div className="p-3 h-48 overflow-y-auto space-y-2">
            {transcripts.length === 0 && <p className="text-gray-500 italic">{t.waiting}</p>}
            {transcripts.map((t, i) => (
              <div key={i} className="break-words border-b border-gray-800 pb-1 last:border-0">
                <span className="text-gray-500 mr-2 text-[10px]">[{new Date().toLocaleTimeString().split(' ')[0]}]</span>
                {t}
              </div>
            ))}
            <div ref={transcriptsEndRef} />
          </div>
        </div>
      )}

      {/* Floating Action Bar */}
      <div className="fixed bottom-0 left-0 right-0 p-6 bg-gradient-to-t from-white via-white/95 to-transparent pointer-events-none flex justify-center z-40">
        <div className="pointer-events-auto shadow-2xl rounded-full">
          <MagicButton 
            onClick={toggleListening} 
            active={status === SessionStatus.LISTENING}
            disabled={status === SessionStatus.CONNECTING}
          >
            {status === SessionStatus.LISTENING ? (
              <div className="flex items-center gap-2">
                <MicOff size={24} />
                <span>{t.pause}</span>
              </div>
            ) : (
              <div className="flex items-center gap-2">
                {status === SessionStatus.CONNECTING ? (
                  <div className="w-6 h-6 border-2 border-white border-t-transparent rounded-full animate-spin" />
                ) : (
                  <Mic size={24} />
                )}
                <span>{t.start}</span>
              </div>
            )}
          </MagicButton>
        </div>
      </div>
      {feedbackOpen && <FeedbackModal language={language} onClose={closeFeedback} />}
    </div>
  );
}