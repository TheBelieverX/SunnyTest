/**
 * Web Speech API STT Manager
 * Uses browser's native Speech Recognition for Romanian language
 */

declare global {
  interface Window {
    webkitSpeechRecognition: any;
    SpeechRecognition: any;
  }
}

const SpeechRecognition = window.webkitSpeechRecognition || window.SpeechRecognition;

export class WebSpeechSTTManager {
  private recognition: any;
  private isListening = false;
  private silenceTimer: NodeJS.Timeout | null = null;
  private lastSpeechTime = 0;
  private readonly SILENCE_THRESHOLD = 6000; // 6 seconds of silence to stop
  private shouldRestart = false;

  public onStatusChange: ((status: 'idle' | 'listening' | 'connecting' | 'error') => void) | null = null;
  public onTranscription: ((text: string) => void) | null = null;
  public onError: ((error: Error) => void) | null = null;

  constructor() {
    if (!SpeechRecognition) {
      throw new Error("Web Speech API not supported in this browser");
    }

    this.recognition = new SpeechRecognition();
    this.setupRecognition();
  }

  private setupRecognition() {
    // Set to Romanian language
    this.recognition.lang = 'ro-RO';
    this.recognition.continuous = true;
    this.recognition.interimResults = true;
    this.recognition.maxAlternatives = 1;

    this.recognition.onstart = () => {
      this.isListening = true;
      this.onStatusChange?.('listening');
      console.log('Speech recognition started');
    };

    this.recognition.onresult = (event: any) => {
      for (let i = event.resultIndex; i < event.results.length; i++) {
        const transcript = event.results[i][0].transcript;
        const wordCount = transcript.trim().split(/\s+/).filter((w) => w.length > 0).length;

        if (event.results[i].isFinal) {
          // Final result - emit it
          console.log('Final transcript:', transcript, `(${wordCount} words)`);
          this.onTranscription?.(transcript);
        } else {
          // Interim result - emit to UI with [interim] prefix for real-time feedback
          console.log('Interim transcript:', transcript, `(${wordCount} words)`);
          this.onTranscription?.(`[interim] ${transcript}`);
        }
      }

      // Update silence timer on ANY speech activity (interim or final)
      this.lastSpeechTime = Date.now();
      if (this.silenceTimer) clearTimeout(this.silenceTimer);
      this.resetSilenceTimer();
    };

    this.recognition.onerror = (event: any) => {
      console.error('Speech recognition error:', event.error);
      const errorMessage = `Speech recognition error: ${event.error}`;
      this.onError?.(new Error(errorMessage));
      this.onStatusChange?.('error');
    };

    this.recognition.onend = () => {
      console.log('Speech recognition ended, shouldRestart:', this.shouldRestart);
      this.isListening = false;
      
      // If the user hasn't manually stopped, restart recognition
      if (this.shouldRestart) {
        console.log('Restarting recognition...');
        try {
          this.recognition.start();
        } catch (error) {
          console.log('Could not restart, already starting');
        }
      } else {
        this.onStatusChange?.('idle');
      }
    };
  }

  private resetSilenceTimer() {
    if (this.silenceTimer) clearTimeout(this.silenceTimer);

    this.silenceTimer = setTimeout(() => {
      console.log('Silence threshold reached, restarting...');
      if (this.isListening && this.shouldRestart) {
        try {
          this.recognition.stop();
          // Restart automatically after a brief delay
          setTimeout(() => {
            if (this.shouldRestart) {
              console.log('Auto-restarting speech recognition...');
              this.recognition.start();
            }
          }, 100);
        } catch (error) {
          console.log('Error restarting recognition:', error);
        }
      }
    }, this.SILENCE_THRESHOLD);
  }

  start() {
    try {
      this.shouldRestart = true;
      this.lastSpeechTime = Date.now();
      this.onStatusChange?.('connecting');
      this.recognition.start();
      this.resetSilenceTimer();
      console.log('Started recognition');
    } catch (error) {
      // If already running, just continue
      if ((error as Error).message.includes('already started')) {
        this.isListening = true;
        this.shouldRestart = true;
        this.onStatusChange?.('listening');
      } else {
        this.onError?.(error as Error);
      }
    }
  }

  stop() {
    try {
      this.shouldRestart = false;
      if (this.silenceTimer) clearTimeout(this.silenceTimer);
      this.recognition.stop();
      this.isListening = false;
      console.log('Stopped recognition');
    } catch (error) {
      console.error('Error stopping recognition:', error);
    }
  }
}
