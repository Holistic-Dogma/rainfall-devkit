/**
 * Secure Edge Node Client
 * 
 * Handles secure communication with the Rainfall backend:
 * - JWT authentication on all requests
 * - ACL validation
 * - Job parameter encryption/decryption
 */

import { RainfallClient } from '../client.js';
import { EdgeNodeSecurity, JWTPayload, EncryptedPayload, KeyPair } from './edge-node.js';
import { readFileSync, existsSync } from 'fs';
import { join } from 'path';

export interface SecureEdgeConfig {
  /** Rainfall client instance */
  client: RainfallClient;
  /** Edge node ID from backend registration */
  edgeNodeId: string;
  /** JWT secret from backend */
  edgeNodeSecret: string;
  /** Path to key directory (contains edge-node.pub and edge-node.key) */
  keysPath: string;
  /** Backend secret for JWT validation (optional, for testing) */
  backendSecret?: string;
}

export interface SecureJob {
  id: string;
  subscriberId: string;
  type: string;
  params?: string; // Encrypted params
  encrypted?: boolean;
}

export interface JobResult {
  jobId: string;
  success: boolean;
  output?: string; // Encrypted output
  error?: string;
}

/**
 * Secure Edge Node Client
 * 
 * Wraps the Rainfall Client with security features for edge node operation.
 */
export class SecureEdgeClient {
  private client: RainfallClient;
  private security: EdgeNodeSecurity;
  private edgeNodeId: string;
  private edgeNodeSecret: string;
  private keysPath: string;
  private jwtPayload?: JWTPayload;
  private keyPair?: KeyPair;

  constructor(config: SecureEdgeConfig) {
    this.client = config.client;
    this.edgeNodeId = config.edgeNodeId;
    this.edgeNodeSecret = config.edgeNodeSecret;
    this.keysPath = config.keysPath;
    this.security = new EdgeNodeSecurity({
      backendSecret: config.backendSecret,
    });
  }

  /**
   * Initialize the secure client
   */
  async initialize(): Promise<void> {
    await this.security.initialize();

    // Load key pair
    await this.loadKeyPair();

    // Validate JWT
    this.jwtPayload = this.security.validateJWT(this.edgeNodeSecret);

    // Verify edge node ID matches
    if (this.jwtPayload.edgeNodeId !== this.edgeNodeId) {
      throw new Error('JWT edge node ID mismatch');
    }
  }

  /**
   * Load key pair from disk
   */
  private async loadKeyPair(): Promise<void> {
    const publicKeyPath = join(this.keysPath, 'edge-node.pub');
    const privateKeyPath = join(this.keysPath, 'edge-node.key');

    if (!existsSync(publicKeyPath) || !existsSync(privateKeyPath)) {
      throw new Error('Key pair not found. Run: rainfall edge generate-keys');
    }

    this.keyPair = {
      publicKey: readFileSync(publicKeyPath, 'utf-8'),
      privateKey: readFileSync(privateKeyPath, 'utf-8'),
    };
  }

  /**
   * Get public key for sharing with backend
   */
  getPublicKey(): string {
    if (!this.keyPair) {
      throw new Error('Key pair not loaded');
    }
    return this.keyPair.publicKey;
  }

  /**
   * Send heartbeat with authentication
   */
  async heartbeat(): Promise<{ status: string; timestamp: number }> {
    this.requireAuth();

    // Include JWT in Authorization header
    return this.client.request('/edge/heartbeat', {
      method: 'POST',
      body: {
        edgeNodeId: this.edgeNodeId,
        timestamp: Date.now(),
      },
      headers: {
        'Authorization': `Bearer ${this.edgeNodeSecret}`,
      },
    });
  }

  /**
   * Claim a job from the queue
   */
  async claimJob(): Promise<SecureJob | null> {
    this.requireAuth();

    const job = await this.client.request<SecureJob | null>('/edge/claim-job', {
      method: 'POST',
      body: {
        edgeNodeId: this.edgeNodeId,
        subscriberId: this.jwtPayload!.subscriberId,
      },
      headers: {
        'Authorization': `Bearer ${this.edgeNodeSecret}`,
      },
    });

    if (job && job.encrypted && job.params) {
      // Decrypt job params
      const decrypted = await this.decryptJobParams(job.params);
      return { ...job, params: decrypted };
    }

    return job;
  }

  /**
   * Submit job result
   */
  async submitJobResult(result: JobResult): Promise<void> {
    this.requireAuth();

    // Encrypt output if present
    let encryptedOutput: string | undefined;
    if (result.output) {
      encryptedOutput = await this.encryptJobResult(result.output);
    }

    await this.client.request('/edge/submit-job-result', {
      method: 'POST',
      body: {
        edgeNodeId: this.edgeNodeId,
        subscriberId: this.jwtPayload!.subscriberId,
        result: {
          ...result,
          output: encryptedOutput,
          encrypted: !!encryptedOutput,
        },
      },
      headers: {
        'Authorization': `Bearer ${this.edgeNodeSecret}`,
      },
    });
  }

  /**
   * Queue a job for processing
   */
  async queueJob(
    type: string,
    params: Record<string, unknown>,
    targetPublicKey?: string
  ): Promise<{ jobId: string }> {
    this.requireAuth();

    // Encrypt params for target edge node if key provided
    let encryptedParams: string | undefined;
    let encrypted = false;

    if (targetPublicKey) {
      encryptedParams = await this.encryptJobParamsForTarget(
        JSON.stringify(params),
        targetPublicKey
      );
      encrypted = true;
    }

    return this.client.request('/edge/queue-job', {
      method: 'POST',
      body: {
        edgeNodeId: this.edgeNodeId,
        subscriberId: this.jwtPayload!.subscriberId,
        job: {
          type,
          params: encryptedParams || JSON.stringify(params),
          encrypted,
        },
      },
      headers: {
        'Authorization': `Bearer ${this.edgeNodeSecret}`,
      },
    });
  }

  /**
   * Decrypt job params received from backend
   */
  private async decryptJobParams(encryptedParams: string): Promise<string> {
    const encrypted: EncryptedPayload = JSON.parse(encryptedParams);
    return this.security.decryptFromBackend(encrypted);
  }

  /**
   * Encrypt job result for sending to backend
   */
  private async encryptJobResult(output: string): Promise<string> {
    // For results, we encrypt with our own key for the backend to decrypt
    // In practice, the backend would have our public key
    const encrypted = await this.security.encryptLocal(output, this.keyPair!.privateKey);
    return JSON.stringify(encrypted);
  }

  /**
   * Encrypt job params for a specific target edge node
   */
  private async encryptJobParamsForTarget(
    params: string,
    targetPublicKey: string
  ): Promise<string> {
    const encrypted = await this.security.encryptForEdgeNode(params, targetPublicKey);
    return JSON.stringify(encrypted);
  }

  /**
   * Check if client is authenticated
   */
  private requireAuth(): void {
    if (!this.jwtPayload) {
      throw new Error('Client not authenticated. Call initialize() first.');
    }

    // Check token expiration
    const now = Math.floor(Date.now() / 1000);
    if (this.jwtPayload.expiresAt < now) {
      throw new Error('JWT token expired. Re-register edge node.');
    }
  }

  /**
   * Get current authentication status
   */
  getAuthStatus(): {
    authenticated: boolean;
    edgeNodeId?: string;
    subscriberId?: string;
    expiresAt?: number;
    scopes?: string[];
  } {
    if (!this.jwtPayload) {
      return { authenticated: false };
    }

    const now = Math.floor(Date.now() / 1000);
    return {
      authenticated: this.jwtPayload.expiresAt > now,
      edgeNodeId: this.jwtPayload.edgeNodeId,
      subscriberId: this.jwtPayload.subscriberId,
      expiresAt: this.jwtPayload.expiresAt,
      scopes: this.jwtPayload.scopes,
    };
  }
}

/**
 * Factory function to create secure edge client from config
 */
export async function createSecureEdgeClient(
  client: RainfallClient,
  options: {
    edgeNodeId: string;
    edgeNodeSecret: string;
    keysPath: string;
    backendSecret?: string;
  }
): Promise<SecureEdgeClient> {
  const secureClient = new SecureEdgeClient({
    client,
    ...options,
  });

  await secureClient.initialize();
  return secureClient;
}
