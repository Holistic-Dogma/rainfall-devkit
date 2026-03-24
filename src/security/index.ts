/**
 * Security module exports
 */

export {
  EdgeNodeSecurity,
  createEdgeNodeSecurity,
  type EdgeNodeJWT,
  type JWTPayload,
  type ACLCheck,
  type ACLResult,
  type EncryptedPayload,
  type KeyPair,
} from './edge-node.js';

export {
  SecureEdgeClient,
  createSecureEdgeClient,
  type SecureJob,
  type JobResult,
  type SecureEdgeConfig,
} from './edge-client.js';

// Re-export client for convenience
export { RainfallClient } from '../client.js';
