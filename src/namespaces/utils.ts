/**
 * Utils namespace for Rainfall SDK
 * Mermaid diagrams, document conversion, regex, JSON extraction
 */

import { RainfallClient } from '../client.js';
import type { Utils } from '../types.js';

export function createUtils(client: RainfallClient): Utils.UtilsClient {
  return {
    mermaid: (params) => client.executeTool('mermaid-diagram-generator', { mermaid: params.diagram }),
    documentConvert: (params) => client.executeTool('document-format-converter', {
      base64: `data:${params.mimeType};base64,${Buffer.from(params.document).toString('base64')}`,
      format: params.format,
    }),
    regex: {
      match: (params) => client.executeTool('regex-match', params),
      replace: (params) => client.executeTool('regex-replace', params),
    },
    jsonExtract: (params) => client.executeTool('json-extract', params),
    digest: (params) => client.executeTool('digest-generator', { text: params.data }),
    monteCarlo: (params) => client.executeTool('monte-carlo-simulation', params),
  };
}
