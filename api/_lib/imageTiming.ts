import { performance } from 'node:perf_hooks';
import type { VercelResponse } from '@vercel/node';

type Stage = 'auth' | 'quota' | 'story_model' | 'image_model';

export class ImageTiming {
  private readonly start = performance.now();
  private readonly durations: Partial<Record<Stage, number>> = {};
  private readonly attempts = { story_model: 0, image_model: 0 };
  private logged = false;
  private active = 0;
  private pendingFinish: (() => void) | null = null;
  hasReference: boolean | null = null;
  storyFallback = false;
  responseStatus: number | null = null;

  constructor(res: VercelResponse) {
    const log = (completion: 'finish' | 'close') => {
      if (this.logged) return;
      this.logged = true;
      const total = Math.round(performance.now() - this.start);
      const status = this.responseStatus ?? res.statusCode;
      const emit = () => {
        console.info(JSON.stringify({
          event: 'image_generation_timing',
          version: 1,
          completion,
          status,
          total_ms: total,
          auth_ms: this.durations.auth ?? null,
          quota_ms: this.durations.quota ?? null,
          story_model_ms: this.durations.story_model ?? null,
          image_model_ms: this.durations.image_model ?? null,
          story_model_attempts: this.attempts.story_model,
          image_model_attempts: this.attempts.image_model,
          story_fallback: this.storyFallback,
          has_reference: this.hasReference,
        }));
      };
      if (completion === 'finish' && this.active) this.pendingFinish = emit;
      else emit();
    };
    res.once('finish', () => log('finish'));
    res.once('close', () => log('close'));
  }

  async measure<T>(stage: Stage, action: () => PromiseLike<T>): Promise<T> {
    const start = performance.now();
    this.active++;
    try {
      return await action();
    } finally {
      this.durations[stage] = Math.round(performance.now() - start);
      this.active--;
      if (!this.active && this.pendingFinish) {
        this.pendingFinish();
        this.pendingFinish = null;
      }
    }
  }

  attempt(stage: 'story_model' | 'image_model') {
    this.attempts[stage]++;
  }
}
