export interface Illustration {
  id: string;
  url: string;
  prompt: string;
  sourceText?: string;
  timestamp: number;
}

export interface IllustrationRequest {
  description: string;
}

export enum SessionStatus {
  IDLE = 'idle',
  CONNECTING = 'connecting',
  LISTENING = 'listening',
  ERROR = 'error',
}