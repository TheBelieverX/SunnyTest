import { MAX_NARRATION_CHARS } from '../generationLimits';

export interface GenerationRequest {
  id: string;
  sourceText: string;
  timestamp: number;
  status: 'pending' | 'generating' | 'completed' | 'failed';
  sessionContext?: string;
}

interface InterimResult {
  text: string;
  committedWords: string[];
  boundaryWarned: boolean;
}

const words = (text: string) => text.trim().split(/\s+/).filter(Boolean);

export class BufferManager {
  private readonly wordThreshold = 70;
  private readonly interimFallbackMs: number;
  private wordBuffer = '';
  private interim = new Map<string, InterimResult>();
  private fallbackTimer: ReturnType<typeof setTimeout> | undefined;
  private generationQueue: GenerationRequest[] = [];
  private activeGenerations = new Set<string>();
  private nextId = 0;

  public onWordCountChange: ((count: number) => void) | null = null;
  public onGenerationRequest: ((request: GenerationRequest) => void) | null = null;
  public onGenerationComplete: ((id: string) => void) | null = null;
  public onWarning: ((message: string) => void) | null = null;

  constructor(interimFallbackMs = 2000) {
    this.interimFallbackMs = interimFallbackMs;
  }

  private unsentWords(result: InterimResult): string[] {
    const current = words(result.text);
    const previous = result.committedWords;
    if (!previous.length) return current;

    // Anchor the previously emitted boundary to tolerate revisions before it.
    const normalize = (word: string) => word.toLocaleLowerCase().replace(/[.,!?;:"“”„()]+/g, '');
    const anchorLength = Math.min(5, previous.length);
    const anchor = previous.slice(-anchorLength).map(normalize);
    let best = -1;
    let distance = Infinity;
    for (let i = 0; i <= current.length - anchorLength; i++) {
      if (anchor.every((word, j) => word === normalize(current[i + j]))) {
        const boundary = i + anchorLength;
        const delta = Math.abs(boundary - previous.length);
        if (delta < distance) { best = boundary; distance = delta; }
      }
    }
    if (best >= 0) {
      result.boundaryWarned = false;
      return current.slice(best);
    }
    if (!result.boundaryWarned) {
      result.boundaryWarned = true;
      this.onWarning?.('Speech revision changed the already-used passage; continuing from the previous word boundary.');
    }
    return current.slice(Math.min(previous.length, current.length));
  }

  addText(text: string, resultId: string, isFinal: boolean) {
    const result = this.interim.get(resultId) ?? { text: '', committedWords: [], boundaryWarned: false };
    result.text = text;
    if (isFinal) {
      this.appendWords(this.unsentWords(result));
      this.interim.delete(resultId);
      this.flushIfReady();
    } else {
      this.interim.set(resultId, result);
    }
    this.updateFallback();
  }

  private appendWords(newWords: string[]) {
    if (newWords.length) this.wordBuffer = [this.wordBuffer, ...newWords].filter(Boolean).join(' ');
  }

  private commitInterim() {
    for (const result of this.interim.values()) {
      this.appendWords(this.unsentWords(result));
      result.committedWords = words(result.text);
    }
  }

  finishRecognition() {
    this.clearFallback();
    this.commitInterim();
    this.interim.clear();
    this.flushIfReady();
    this.updateFallback();
  }

  private updateFallback() {
    const interimWords = Array.from(this.interim.values()).reduce((count, result) => count + this.unsentWords(result).length, 0);
    const count = words(this.wordBuffer).length + interimWords;
    this.onWordCountChange?.(count);
    if (count < this.wordThreshold || interimWords === 0) {
      this.clearFallback();
    } else if (this.fallbackTimer === undefined) {
      this.fallbackTimer = setTimeout(() => {
        this.fallbackTimer = undefined;
        this.commitInterim();
        this.flushIfReady();
        this.updateFallback();
      }, this.interimFallbackMs);
    }
  }

  private clearFallback() {
    if (this.fallbackTimer !== undefined) clearTimeout(this.fallbackTimer);
    this.fallbackTimer = undefined;
  }

  private flushIfReady() {
    if (words(this.wordBuffer).length < this.wordThreshold && this.wordBuffer.length <= MAX_NARRATION_CHARS) return;
    let remaining = this.wordBuffer.trim();
    this.wordBuffer = '';
    while (remaining) {
      let end = Math.min(remaining.length, MAX_NARRATION_CHARS);
      if (end < remaining.length) {
        const boundary = remaining.lastIndexOf(' ', end);
        if (boundary > 0) end = boundary;
        else if (end > 0 && /[\uD800-\uDBFF]/.test(remaining[end - 1])) end--;
      }
      const chunk = remaining.slice(0, end);
      remaining = remaining.slice(end).trimStart();
      const pending = this.generationQueue[this.generationQueue.length - 1];
      if (pending && pending.sourceText.length + 1 + chunk.length <= MAX_NARRATION_CHARS) {
        pending.sourceText += ` ${chunk}`;
      } else {
        this.generationQueue.push({
          id: `${Date.now()}-${++this.nextId}`,
          sourceText: chunk,
          timestamp: Date.now(),
          status: 'pending',
        });
      }
    }
    this.onWordCountChange?.(0);
    this.processQueue();
  }

  private processQueue() {
    if (this.activeGenerations.size || !this.generationQueue.length) return;
    const request = this.generationQueue.shift()!;
    request.status = 'generating';
    this.activeGenerations.add(request.id);
    this.onGenerationRequest?.(request);
  }

  completeGeneration(id: string) {
    this.activeGenerations.delete(id);
    this.onGenerationComplete?.(id);
    this.processQueue();
  }

  failGeneration(id: string) {
    this.activeGenerations.delete(id);
    this.processQueue();
  }

  getQueueStatus() {
    return { queued: this.generationQueue.length, active: this.activeGenerations.size, wordCount: words(this.wordBuffer).length };
  }

  reset() {
    this.clearFallback();
    this.wordBuffer = '';
    this.interim.clear();
    this.generationQueue = [];
    this.activeGenerations.clear();
    this.onWordCountChange?.(0);
  }
}
