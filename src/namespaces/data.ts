/**
 * Data namespace for Rainfall SDK
 * CSV processing, scripts, similarity search
 */

import { RainfallClient } from '../client.js';
import type { Data } from '../types.js';

export function createData(client: RainfallClient): Data.DataClient {
  return {
    csv: {
      query: (params) => client.executeTool('query-csv', params),
      convert: (params) => client.executeTool('csv-convert', params),
    },
    scripts: {
      create: (params) => client.executeTool('create-saved-script', params),
      execute: (params) => client.executeTool('execute-saved-script', params),
      list: () => client.executeTool('list-saved-scripts', {}),
      update: (params) => client.executeTool('update-saved-script', params),
      delete: (params) => client.executeTool('delete-saved-script', params),
    },
    similarity: {
      search: (params) => client.executeTool('duck-db-similarity-search', params),
      duckDbSearch: (params) => client.executeTool('duck-db-similarity-search', params),
    },
  };
}
