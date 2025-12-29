/**
 * Buffer and Generation Queue Manager
 * Handles word counting, buffering, and parallel image generation with session context
 */

export interface GenerationRequest {
  id: string;
  sourceText: string;
  timestamp: number;
  status: 'pending' | 'generating' | 'completed' | 'failed';
  sessionContext?: string; // Session history for consistency
}

export class BufferManager {
  private wordBuffer: string = ''; // Final results buffer
  private interimBuffer: string = ''; // Current interim result (replaced each time, not accumulated)
  private wordCount = 0;
  private maxWordCount = 0; // Tracks maximum word count to filter out backwards jumps
  private readonly WORD_THRESHOLD = 70;
  private generationQueue: GenerationRequest[] = [];
  private activeGenerations = new Set<string>();
  private maxParallelGenerations = 2; // Allow 2 parallel generations
  
  // Session context tracking for consistency
  private sessionHistory: string[] = [];
  private establishedAttributes: string[] = []; // Key attributes established in the story
  
  // Optimization: cache word count results to avoid recalculating
  private cachedFinalWordCount = 0;
  private cachedInterimWordCount = 0;
  private lastFinalBuffer = '';
  private lastInterimBuffer = '';

  public onWordCountChange: ((count: number) => void) | null = null;
  public onGenerationRequest: ((request: GenerationRequest) => void) | null = null;
  public onGenerationComplete: ((id: string) => void) | null = null;

  /**
   * Helper: Count words in text (cached for performance)
   */
  private countWords(text: string): number {
    if (!text || text.trim().length === 0) return 0;
    return text.trim().split(/\s+/).length;
  }

  /**
   * Add transcribed text and check if we've hit the threshold
   * OPTIMIZED: Reduces redundant string operations and logging
   */
  addText(text: string) {
    // Remove [interim] prefix if present
    let cleanText = text.replace(/^\[interim\]\s*/, '');
    
    if (cleanText.trim().length === 0) return;

    const isInterim = text.startsWith('[interim]');
    
    if (isInterim) {
      // INTERIM: Replace the interim buffer (don't accumulate previous interims)
      this.interimBuffer = cleanText;
    } else {
      // FINAL: Add to permanent buffer, clear interim buffer
      this.wordBuffer += ' ' + cleanText;
      this.interimBuffer = ''; // Clear interim when we get final result
    }

    // Only recount if buffers changed
    let finalWords = this.cachedFinalWordCount;
    let interimWords = this.cachedInterimWordCount;
    
    if (this.wordBuffer !== this.lastFinalBuffer) {
      finalWords = this.countWords(this.wordBuffer);
      this.cachedFinalWordCount = finalWords;
      this.lastFinalBuffer = this.wordBuffer;
    }
    
    if (this.interimBuffer !== this.lastInterimBuffer) {
      interimWords = this.countWords(this.interimBuffer);
      this.cachedInterimWordCount = interimWords;
      this.lastInterimBuffer = this.interimBuffer;
    }
    
    this.wordCount = finalWords + interimWords;

    // Update max counter: only goes up or stays the same, never backwards
    if (this.wordCount > this.maxWordCount) {
      this.maxWordCount = this.wordCount;
    }

    // Only notify UI if value changed (reduce React re-renders)
    this.onWordCountChange?.(this.maxWordCount);

    // Check if we've hit the threshold using the max counter
    if (this.maxWordCount >= this.WORD_THRESHOLD) {
      this.triggerGeneration();
    }
  }

  /**
   * Trigger image generation for accumulated text
   */
  private triggerGeneration() {
    if (this.wordBuffer.trim().length === 0) return;

    // Build session context from history
    const sessionContext = this.buildSessionContext();
    
    const request: GenerationRequest = {
      id: Date.now().toString(),
      sourceText: this.wordBuffer.trim(), // Only final results for generation
      timestamp: Date.now(),
      status: 'pending',
      sessionContext: sessionContext,
    };

    // Add current text to session history for future context
    this.sessionHistory.push(this.wordBuffer.trim());
    this.extractAttributes(this.wordBuffer.trim());

    this.generationQueue.push(request);
    this.wordBuffer = ''; // Clear final buffer
    this.interimBuffer = ''; // Clear interim buffer
    this.wordCount = 0;
    this.maxWordCount = 0; // Reset max counter for next batch
    this.onWordCountChange?.(0);

    // Process queue
    this.processQueue();
  }

  /**
   * Extract and track key attributes from the text for consistency
   * OPTIMIZED: Only extract from final results, not interim (interim changes too frequently)
   */
  private extractAttributes(text: string) {
    const lowerText = text.toLowerCase();
    
    // Optimized patterns - cache these as static
    const attributePatterns = [
      /(\w+)\s+(hair|păr)/gi,
      /(\w+)\s+(eyes|ochi)/gi,
      /(\w+)\s+(dress|rochie|robe)/gi,
      /(\w+)\s+(cloak|cape|manta)/gi,
      /prince|princess|king|queen|regina|prinț|prințesă/gi,
      /castle|fort|tower|palace|palat|castel/gi,
      /forest|woods|copac|pădure/gi,
      /magical|magic|enchanted|vrăji/gi,
    ];

    // Only process if we don't already have many attributes (avoid re-extracting)
    if (this.establishedAttributes.length > 50) return;

    for (const pattern of attributePatterns) {
      const matches = text.match(pattern);
      if (matches) {
        for (const match of matches) {
          if (!this.establishedAttributes.includes(match)) {
            this.establishedAttributes.push(match);
          }
        }
      }
    }
  }

  /**
   * Build session context string from history
   */
  private buildSessionContext(): string {
    if (this.sessionHistory.length === 0) {
      return '';
    }

    // Combine recent history and established attributes
    const recentHistory = this.sessionHistory.slice(-3).join(' '); // Last 3 pieces of text
    const attributes = this.establishedAttributes.slice(-10).join(', '); // Last 10 attributes
    
    return `
STORY CONTEXT FROM THIS SESSION:
${recentHistory}

ESTABLISHED CHARACTER/SETTING DETAILS (maintain consistency):
${attributes}
    `.trim();
  }

  /**
   * Process generation queue with parallel limit
   */
  private processQueue() {
    while (
      this.generationQueue.length > 0 &&
      this.activeGenerations.size < this.maxParallelGenerations
    ) {
      const request = this.generationQueue.shift();
      if (request) {
        request.status = 'generating';
        this.activeGenerations.add(request.id);
        this.onGenerationRequest?.(request);
      }
    }
  }

  /**
   * Mark generation as complete and process next in queue
   */
  completeGeneration(id: string) {
    this.activeGenerations.delete(id);
    this.onGenerationComplete?.(id);
    this.processQueue(); // Process next item if available
  }

  /**
   * Mark generation as failed and continue with queue
   */
  failGeneration(id: string) {
    this.activeGenerations.delete(id);
    this.processQueue(); // Process next item
  }

  /**
   * Get current queue status
   */
  getQueueStatus() {
    return {
      queued: this.generationQueue.length,
      active: this.activeGenerations.size,
      wordCount: this.wordCount,
    };
  }

  /**
   * Reset buffer and queue
   */
  reset() {
    this.wordBuffer = '';
    this.interimBuffer = '';
    this.wordCount = 0;
    this.maxWordCount = 0;
    this.cachedFinalWordCount = 0;
    this.cachedInterimWordCount = 0;
    this.lastFinalBuffer = '';
    this.lastInterimBuffer = '';
    this.generationQueue = [];
    this.activeGenerations.clear();
    this.sessionHistory = [];
    this.establishedAttributes = [];
    this.onWordCountChange?.(0);
  }
}
