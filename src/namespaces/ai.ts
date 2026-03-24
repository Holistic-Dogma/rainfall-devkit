/**
 * AI namespace for Rainfall SDK
 * Embeddings, image generation, OCR, vision, chat
 */

import { RainfallClient } from '../client.js';
import type { AI } from '../types.js';

export function createAI(client: RainfallClient): AI.AIClient {
  return {
    embeddings: {
      document: (params) => client.executeTool('jina-document-embedding', params),
      query: (params) => client.executeTool('jina-query-embedding', params),
      image: (params) => client.executeTool('jina-image-embedding', { image: params.imageBase64 }),
    },
    image: {
      generate: (params) => client.executeTool('image-generation', params),
    },
    ocr: (params) => client.executeTool('ocr-text-extraction', { image: params.imageBase64 }),
    vision: (params) => client.executeTool('llama-scout-vision', { image: params.imageBase64, prompt: params.prompt }),
    chat: (params) => client.executeTool('xai-chat-completions', params),
    complete: (params) => client.executeTool('fim', params),
    classify: (params) => client.executeTool('jina-document-classifier', params),
    segment: (params) => client.executeTool('jina-text-segmenter', params),
    
    /**
     * OpenAI-compatible chat completions with full tool support
     * This is the recommended method for multi-turn conversations with tools
     */
    chatCompletions: (params) => client.chatCompletions(params),
  };
}
