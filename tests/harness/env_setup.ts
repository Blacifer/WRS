/**
 * Browser Environment Polyfill & Mock Setup for Node.js E2E Testing
 * Indian Railways WRS Raipur (Phase 3 Hardware API Simulations)
 *
 * Injects MockSpeechRecognition, MockAudioContext, and MockMediaDevices into globalThis.
 */

import { MockSpeechRecognition } from './speech_mock.ts';
import { MockAudioContext, MockAnalyserNode } from './audio_mock.ts';
import { MockMediaDevices, MockMediaStream } from './camera_mock.ts';

const originalGlobals = {
  window: (globalThis as any).window,
  navigator: (globalThis as any).navigator,
  AudioContext: (globalThis as any).AudioContext,
  webkitAudioContext: (globalThis as any).webkitAudioContext,
  SpeechRecognition: (globalThis as any).SpeechRecognition,
  webkitSpeechRecognition: (globalThis as any).webkitSpeechRecognition,
  MediaStream: (globalThis as any).MediaStream
};

export function setupBrowserMocks(): void {
  const mockMediaDevices = new MockMediaDevices();

  const mockNavigator = {
    mediaDevices: mockMediaDevices,
    userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36 WRS-Raipur/3.0',
    language: 'en-IN',
    languages: ['en-IN', 'hi-IN', 'en']
  };

  const mockWindow: any = {
    AudioContext: MockAudioContext,
    webkitAudioContext: MockAudioContext,
    SpeechRecognition: MockSpeechRecognition,
    webkitSpeechRecognition: MockSpeechRecognition,
    MediaStream: MockMediaStream,
    navigator: mockNavigator,
    addEventListener: () => {},
    removeEventListener: () => {},
    dispatchEvent: () => true
  };

  (globalThis as any).window = mockWindow;
  (globalThis as any).navigator = mockNavigator;
  (globalThis as any).AudioContext = MockAudioContext;
  (globalThis as any).webkitAudioContext = MockAudioContext;
  (globalThis as any).SpeechRecognition = MockSpeechRecognition;
  (globalThis as any).webkitSpeechRecognition = MockSpeechRecognition;
  (globalThis as any).MediaStream = MockMediaStream;
}

export function resetBrowserMocks(): void {
  (globalThis as any).window = originalGlobals.window;
  (globalThis as any).navigator = originalGlobals.navigator;
  (globalThis as any).AudioContext = originalGlobals.AudioContext;
  (globalThis as any).webkitAudioContext = originalGlobals.webkitAudioContext;
  (globalThis as any).SpeechRecognition = originalGlobals.SpeechRecognition;
  (globalThis as any).webkitSpeechRecognition = originalGlobals.webkitSpeechRecognition;
  (globalThis as any).MediaStream = originalGlobals.MediaStream;
}
