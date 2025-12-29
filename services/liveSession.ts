import { GoogleGenAI, LiveServerMessage, Modality, FunctionDeclaration, Type } from '@google/genai';
import { createPcmBlob } from './audioUtils';

// Define the tool for the model to use
const illustrationTool: FunctionDeclaration = {
  name: 'generate_illustration',
  description: 'Call this function ONLY when you receive the specific signal "[GENERATE_SIGNAL]".',
  parameters: {
    type: Type.OBJECT,
    properties: {
      description: {
        type: Type.STRING,
        description: 'Visual description in English.',
      },
    },
    required: ['description'],
  },
};

export class LiveSessionManager {
  private ai: GoogleGenAI;
  private inputAudioContext: AudioContext | null = null;
  private stream: MediaStream | null = null;
  private processor: ScriptProcessorNode | null = null;
  private source: MediaStreamAudioSourceNode | null = null;
  private sessionPromise: Promise<any> | null = null;
  private analyzer: AnalyserNode | null = null;
  
  // Buffering and Logic
  private transcriptionBuffer: string = "";
  private isExpectingIllustration: boolean = false;
  private permissionTimeout: any = null;
  
  // Word Count Trigger Logic
  private wordCountSinceLastImage: number = 0;
  private readonly WORD_THRESHOLD = 70; // Trigger every 70 words
  
  public onIllustrationRequest: ((description: string, sourceText: string) => void) | null = null;
  public onStatusChange: ((status: string) => void) | null = null;
  public onVolumeChange: ((volume: number) => void) | null = null;
  public onTranscription: ((text: string) => void) | null = null;
  public onWordCountChange: ((count: number) => void) | null = null;
  public onError: ((error: Error) => void) | null = null;

  constructor() {
   if (!import.meta.env.VITE_API_KEY) throw new Error("API Key missing");
   this.ai = new GoogleGenAI({ apiKey: import.meta.env.VITE_API_KEY });
  }

  async start() {
    try {
      this.onStatusChange?.('connecting');
      this.isExpectingIllustration = false;
      this.transcriptionBuffer = "";
      this.wordCountSinceLastImage = 0;
      this.onWordCountChange?.(0);
      
      // Enforce 16kHz sample rate for Live API stability
      const AudioContextClass = window.AudioContext || (window as any).webkitAudioContext;
      this.inputAudioContext = new AudioContextClass({ sampleRate: 16000 });

      this.stream = await navigator.mediaDevices.getUserMedia({ 
        audio: {
          channelCount: 1,
          sampleRate: 16000
        } 
      });

      const config = {
        model: 'gemini-2.5-flash-native-audio-preview-09-2025',
        callbacks: {
          onopen: this.handleOpen.bind(this),
          onmessage: this.handleMessage.bind(this),
          onerror: (e: ErrorEvent) => {
            console.error("Live API Error:", e);
            // Don't overwrite status if we are just logging a transient error, 
            // but for network errors usually it's fatal.
            this.onError?.(new Error("Connection error (Network)"));
            this.onStatusChange?.('error');
          },
          onclose: () => {
            this.onStatusChange?.('idle');
          },
        },
        config: {
          responseModalities: [Modality.AUDIO], 
          inputAudioTranscription: {},
          
          // CRITICAL FIX: systemInstruction must be a Content object, not a string, to avoid protocol errors.
          systemInstruction: {
            parts: [{
              text: `
                You are a background process that listens to a Romanian story.
                
                CORE DIRECTIVES:
                1. SILENCE IS GOLDEN: You must NEVER speak. You must NEVER generate audio.
                2. IGNORE PAUSES: If the user stops speaking, DO NOT take a turn. Just wait.
                3. NO INITIATIVE: You must NEVER call the 'generate_illustration' tool unless explicitly told to.
                
                PROTOCOL:
                - Listen silently to the Romanian input.
                - Accumulate context in memory.
                - WAIT specifically for the text command "[GENERATE_SIGNAL]".
                
                ONLY when you receive "[GENERATE_SIGNAL]":
                - Create a visual description in English of the story segment heard so far.
                - Call the 'generate_illustration' tool immediately.
                
                If you have NOT received "[GENERATE_SIGNAL]", REMAIN SILENT.
              `
            }]
          },
          tools: [{ functionDeclarations: [illustrationTool] }],
        },
      };

      this.sessionPromise = this.ai.live.connect(config);
      await this.sessionPromise;
      
    } catch (err) {
      console.error("Failed to start session:", err);
      this.onError?.(err instanceof Error ? err : new Error("Failed to start"));
      this.onStatusChange?.('error');
      this.stop();
    }
  }

  private handleOpen() {
    this.onStatusChange?.('listening');
    if (!this.inputAudioContext || !this.stream) return;

    this.source = this.inputAudioContext.createMediaStreamSource(this.stream);
    // 4096 buffer size at 16kHz is ~256ms latency, which is good for chunks
    this.processor = this.inputAudioContext.createScriptProcessor(4096, 1, 1);
    
    this.analyzer = this.inputAudioContext.createAnalyser();
    this.analyzer.fftSize = 256;
    this.source.connect(this.analyzer);

    const dataArray = new Uint8Array(this.analyzer.frequencyBinCount);
    // Use the actual context sample rate (should be 16000 if supported, or fallback)
    const sampleRate = this.inputAudioContext.sampleRate;

    this.processor.onaudioprocess = (e) => {
      const inputData = e.inputBuffer.getChannelData(0);
      const pcmBlob = createPcmBlob(inputData, sampleRate);
      
      if (this.analyzer) {
        this.analyzer.getByteFrequencyData(dataArray);
        const average = dataArray.reduce((a, b) => a + b) / dataArray.length;
        if (this.onVolumeChange) {
          this.onVolumeChange(average);
        }
      }
      
      if (this.sessionPromise) {
          this.sessionPromise.then(session => {
              session.sendRealtimeInput({ media: pcmBlob });
          });
      }
    };

    this.source.connect(this.processor);
    this.processor.connect(this.inputAudioContext.destination);
  }

  private triggerGenerationSignal() {
    this.isExpectingIllustration = true; // Open the gate
    
    // SAFETY: Close the gate automatically after 15 seconds if the model doesn't respond.
    // Increased from 5s to 15s to handle slower network/model responses.
    if (this.permissionTimeout) clearTimeout(this.permissionTimeout);
    this.permissionTimeout = setTimeout(() => {
        if (this.isExpectingIllustration) {
            console.log("Permission timed out. Revoking generation rights.");
            this.isExpectingIllustration = false;
            
            // Notify UI via transcript for debugging
            if (this.onTranscription) {
                this.onTranscription(`[System: Generation window expired (Safety Timeout).]`);
            }
        }
    }, 15000);

    if (this.sessionPromise) {
      this.sessionPromise.then(session => {
        // Send a text signal to the model to force it to wake up and generate
        session.sendRealtimeInput({ 
          content: [
            { text: "[GENERATE_SIGNAL]" }
          ] 
        });
        if (this.onTranscription) {
            this.onTranscription(`[System: Word count limit (${this.WORD_THRESHOLD}) reached. Signal sent.]`);
        }
      });
    }
  }

  private async handleMessage(message: LiveServerMessage) {
    // Handle Transcriptions & Word Counting
    if (message.serverContent?.inputTranscription) {
      const text = message.serverContent.inputTranscription.text;
      if (text) {
        this.transcriptionBuffer += text;
        
        // Count words in this chunk (robust against empty strings)
        const words = text.trim().split(/\s+/).filter(w => w.length > 0).length;
        this.wordCountSinceLastImage += words;
        
        if (this.onWordCountChange) {
            this.onWordCountChange(this.wordCountSinceLastImage);
        }

        if (this.onTranscription) {
          this.onTranscription(`${text} (${this.wordCountSinceLastImage})`);
        }

        // Trigger logic
        if (this.wordCountSinceLastImage >= this.WORD_THRESHOLD) {
            this.triggerGenerationSignal();
            this.wordCountSinceLastImage = 0; // Reset counter immediately
            this.onWordCountChange?.(0);
        }
      }
    }

    // Handle Tool Calls
    if (message.toolCall) {
      for (const fc of message.toolCall.functionCalls) {
        if (fc.name === 'generate_illustration') {
          // Gatekeeper
          if (!this.isExpectingIllustration) {
            console.warn("Blocked unsolicited illustration request.");
            
            this.sessionPromise?.then(session => {
               session.sendToolResponse({
                  functionResponses: { 
                    id: fc.id, 
                    name: fc.name, 
                    response: { result: "User is still speaking. Continue listening." } 
                  }
               });
            });
            continue;
          }

          // Valid request
          this.isExpectingIllustration = false;
          if (this.permissionTimeout) clearTimeout(this.permissionTimeout);
          
          const desc = (fc.args as any).description;
          const sourceText = this.transcriptionBuffer;
          this.transcriptionBuffer = ""; // Clear buffer for next scene
          
          if (desc && this.onIllustrationRequest) {
            this.onIllustrationRequest(desc, sourceText);
          }
          
          if (this.sessionPromise) {
             this.sessionPromise.then(session => {
               session.sendToolResponse({
                  functionResponses: {
                    id: fc.id,
                    name: fc.name,
                    response: { result: "ok" }
                  }
               });
             });
          }
        }
      }
    }
  }

  stop() {
    if (this.permissionTimeout) clearTimeout(this.permissionTimeout);
    
    if (this.source) {
      this.source.disconnect();
      this.source = null;
    }
    if (this.processor) {
      this.processor.disconnect();
      this.processor = null;
    }
    if (this.analyzer) {
      this.analyzer.disconnect();
      this.analyzer = null;
    }
    if (this.stream) {
      this.stream.getTracks().forEach(t => t.stop());
      this.stream = null;
    }
    if (this.inputAudioContext) {
      this.inputAudioContext.close();
      this.inputAudioContext = null;
    }
    
    if (this.sessionPromise) {
      this.sessionPromise.then(session => {
          if (typeof session.close === 'function') {
              session.close();
          }
      });
      this.sessionPromise = null;
    }
    
    this.onStatusChange?.('idle');
  }
}