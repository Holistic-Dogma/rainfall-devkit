/**
 * Memory namespace for Rainfall SDK
 * Semantic memory storage and retrieval
 */

import { RainfallClient } from '../client.js';
import type { Memory } from '../types.js';

export function createMemory(client: RainfallClient): Memory.MemoryClient {
  return {
    create: (params) => client.executeTool('memory-create', params),
    get: (params) => client.executeTool('memory-get', { memoryId: params.memoryId }),
    recall: (params) => client.executeTool('memory-recall', params),
    list: (params) => client.executeTool('memory-list', params ?? {}),
    update: (params) => client.executeTool('memory-update', params),
    delete: (params) => client.executeTool('memory-delete', { memoryId: params.memoryId }),
  };
}
