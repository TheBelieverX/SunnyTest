import React, { useState, useEffect, useRef, useCallback } from 'react';
import { Mic, MicOff, BookOpen, Clock, Terminal, X, Download } from 'lucide-react';
import { WebSpeechSTTManager } from './services/webSpeechSTT';
import { BufferManager, GenerationRequest } from './services/bufferManager';
import { generateIllustration } from './services/geminiService';
import { Illustration, SessionStatus } from './types';
import { MagicButton } from './components/MagicButton';
import { BookViewer } from './components/BookViewer';

export default function App() {
  const [status, setStatus] = useState<SessionStatus>(SessionStatus.IDLE);
  const [illustrations, setIllustrations] = useState<Illustration[]>([]);
  const [audioVolume, setAudioVolume] = useState(0);
  const [debugMode, setDebugMode] = useState(false);
  const [transcripts, setTranscripts] = useState<string[]>([]);
  const [currentWordCount, setCurrentWordCount] = useState(0);
  const [activeGenerations, setActiveGenerations] = useState<string[]>([]);
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

          // Step 2: Generate illustration with session context for consistency
          const imageUrl = await generateIllustration(request.sourceText, request.sessionContext);

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
          const errorLog = `❌ GENERATION FAILED: ${e instanceof Error ? e.message : 'Unknown error'}`;
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
                Povești Magice
              </h1>
              <p className="text-[10px] text-gray-500 font-bold tracking-widest uppercase">Story Reader</p>
            </div>
          </div>
          
          <div className="flex items-center gap-3">
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
            
            {/* Debug Toggle */}
            <button 
              onClick={() => setDebugMode(!debugMode)}
              className={`p-2 rounded-full transition-colors ${debugMode ? 'bg-gray-800 text-white' : 'bg-gray-100 text-gray-500 hover:bg-gray-200'}`}
              title="Toggle Debug Console"
            >
              <Terminal size={18} />
            </button>
          </div>
        </div>
      </header>

      <main className="flex-grow flex flex-col max-w-4xl mx-auto w-full px-4 pt-6 pb-24">
        <div className="w-full mb-8 relative z-10">
          <BookViewer 
            currentIllustration={illustrations[0] || null} 
            isGenerating={activeGenerations.length > 0} 
          />
        </div>

        {illustrations.length > 1 && (
          <div className="animate-fade-in">
            <div className="flex items-center gap-2 mb-4 text-gray-400 uppercase tracking-widest text-xs font-bold">
              <Clock size={12} />
              <span>Istoricul Poveștii (Timeline)</span>
            </div>
            <div className="flex gap-4 overflow-x-auto pb-4 px-2 snap-x scrollbar-hide">
              {illustrations.slice(1).map((ill) => (
                <div key={ill.id} className="flex-shrink-0 w-24 h-24 md:w-32 md:h-32 rounded-lg overflow-hidden border-2 border-white shadow-md opacity-60 hover:opacity-100 transition-opacity snap-start">
                  <img src={ill.url} alt="History" className="w-full h-full object-cover" />
                </div>
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
              <span>Words: <span className="text-white">{currentWordCount}</span> / 70</span>
              {activeGenerations.length > 0 && <span className="ml-2">| Generating: {activeGenerations.length}</span>}
            </span>
            <div className="flex items-center gap-2">
              <button 
                onClick={downloadLogs} 
                className="text-gray-400 hover:text-white p-1 hover:bg-gray-700 rounded transition-colors"
                title="Download Full Log"
              >
                <Download size={14} />
              </button>
              <button onClick={() => setDebugMode(false)} className="text-gray-400 hover:text-white p-1 hover:bg-gray-700 rounded transition-colors">
                <X size={14} />
              </button>
            </div>
          </div>
          <div className="p-3 h-48 overflow-y-auto space-y-2">
            {transcripts.length === 0 && <p className="text-gray-500 italic">Waiting for speech...</p>}
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
                <span>Pauză (Pause)</span>
              </div>
            ) : (
              <div className="flex items-center gap-2">
                {status === SessionStatus.CONNECTING ? (
                  <div className="w-6 h-6 border-2 border-white border-t-transparent rounded-full animate-spin" />
                ) : (
                  <Mic size={24} />
                )}
                <span>Începe Citirea (Start Reading)</span>
              </div>
            )}
          </MagicButton>
        </div>
      </div>
    </div>
  );
}