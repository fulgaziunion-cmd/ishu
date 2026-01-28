
export interface ActionLog {
  id: string;
  type: string;
  timestamp: Date;
  description: string;
}

export interface Transcription {
  role: 'user' | 'ishu';
  text: string;
  timestamp: Date;
}

export enum NovaState {
  IDLE = 'IDLE',
  AUTH = 'AUTH',
  CONNECTING = 'CONNECTING',
  LISTENING = 'LISTENING',
  SPEAKING = 'SPEAKING',
  ERROR = 'ERROR'
}
