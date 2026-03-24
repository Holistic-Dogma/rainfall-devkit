/**
 * Edge Node Security Module
 * 
 * Provides:
 * - JWT token generation/validation for edge node authentication
 * - ACL enforcement for job routing (same-subscriber only)
 * - Libsodium-based encryption for job parameters
 * - Key pair generation for edge nodes
 */

import sodium from 'libsodium-wrappers-sumo';

// JWT types
export interface EdgeNodeJWT {
  sub: string;        // subscriber ID (edge node ID)
  iss: string;        // issuer (backend)
  iat: number;        // issued at
  exp: number;        // expiration
  jti: string;        // unique token ID
  scope: string[];    // allowed scopes
}

export interface JWTPayload {
  edgeNodeId: string;
  subscriberId: string;
  scopes: string[];
  expiresAt: number;
}

// ACL types
export interface ACLCheck {
  edgeNodeId: string;
  subscriberId: string;
  jobSubscriberId: string;
  action: 'claim' | 'submit' | 'queue' | 'heartbeat';
}

export interface ACLResult {
  allowed: boolean;
  reason?: string;
}

// Encryption types
export interface EncryptedPayload {
  ciphertext: string;      // base64
  nonce: string;           // base64
  ephemeralPublicKey: string; // base64
}

export interface KeyPair {
  publicKey: string;       // base64
  privateKey: string;      // base64
}

/**
 * Edge Node Security Manager
 */
export class EdgeNodeSecurity {
  private sodiumReady: Promise<void>;
  private backendSecret?: string;
  private keyPair?: KeyPair;

  constructor(options: { backendSecret?: string; keyPair?: KeyPair } = {}) {
    this.sodiumReady = sodium.ready;
    this.backendSecret = options.backendSecret;
    this.keyPair = options.keyPair;
  }

  /**
   * Initialize libsodium
   */
  async initialize(): Promise<void> {
    await this.sodiumReady;
  }

  // ============================================================================
  // JWT Token Management
  // ============================================================================

  /**
   * Generate a JWT token for an edge node
   * Note: In production, this is done by the backend. This is for testing.
   */
  generateJWT(
    edgeNodeId: string,
    subscriberId: string,
    expiresInDays: number = 30
  ): string {
    if (!this.backendSecret) {
      throw new Error('Backend secret not configured');
    }

    const now = Math.floor(Date.now() / 1000);
    const exp = now + expiresInDays * 24 * 60 * 60;
    const jti = this.generateTokenId();

    const payload: EdgeNodeJWT = {
      sub: edgeNodeId,
      iss: 'rainfall-backend',
      iat: now,
      exp,
      jti,
      scope: ['edge:heartbeat', 'edge:claim', 'edge:submit', 'edge:queue'],
    };

    // Simple JWT implementation (header.payload.signature)
    const header = { alg: 'HS256', typ: 'JWT' };
    const encodedHeader = this.base64UrlEncode(JSON.stringify(header));
    const encodedPayload = this.base64UrlEncode(JSON.stringify(payload));
    
    const signature = this.hmacSha256(
      `${encodedHeader}.${encodedPayload}`,
      this.backendSecret
    );
    const encodedSignature = this.base64UrlEncode(signature);

    return `${encodedHeader}.${encodedPayload}.${encodedSignature}`;
  }

  /**
   * Validate a JWT token
   */
  validateJWT(token: string): JWTPayload {
    const parts = token.split('.');
    if (parts.length !== 3) {
      throw new Error('Invalid JWT format');
    }

    const [encodedHeader, encodedPayload, encodedSignature] = parts;

    // Verify signature
    if (this.backendSecret) {
      const expectedSignature = this.hmacSha256(
        `${encodedHeader}.${encodedPayload}`,
        this.backendSecret
      );
      const expectedEncoded = this.base64UrlEncode(expectedSignature);
      
      if (!this.timingSafeEqual(encodedSignature, expectedEncoded)) {
        throw new Error('Invalid JWT signature');
      }
    }

    // Parse payload
    const payload: EdgeNodeJWT = JSON.parse(this.base64UrlDecode(encodedPayload));

    // Check expiration
    const now = Math.floor(Date.now() / 1000);
    if (payload.exp < now) {
      throw new Error('JWT token expired');
    }

    // Check issuer
    if (payload.iss !== 'rainfall-backend') {
      throw new Error('Invalid JWT issuer');
    }

    return {
      edgeNodeId: payload.sub,
      subscriberId: payload.sub, // Same as edge node ID for now
      scopes: payload.scope,
      expiresAt: payload.exp,
    };
  }

  /**
   * Extract bearer token from Authorization header
   */
  extractBearerToken(authHeader: string | undefined): string | null {
    if (!authHeader) return null;
    const match = authHeader.match(/^Bearer\s+(.+)$/i);
    return match ? match[1] : null;
  }

  // ============================================================================
  // ACL Enforcement
  // ============================================================================

  /**
   * Check if an edge node is allowed to perform an action on a job
   * Rule: Edge nodes can only access jobs for their own subscriber
   */
  checkACL(check: ACLCheck): ACLResult {
    // Edge node can only access jobs from the same subscriber
    if (check.subscriberId !== check.jobSubscriberId) {
      return {
        allowed: false,
        reason: `Edge node ${check.edgeNodeId} cannot access jobs from subscriber ${check.jobSubscriberId}`,
      };
    }

    // All actions require the edge node to be from the same subscriber
    const allowedActions = ['heartbeat', 'claim', 'submit', 'queue'];
    if (!allowedActions.includes(check.action)) {
      return {
        allowed: false,
        reason: `Unknown action: ${check.action}`,
      };
    }

    return { allowed: true };
  }

  /**
   * Middleware-style ACL check for job operations
   */
  requireSameSubscriber(
    edgeNodeSubscriberId: string,
    jobSubscriberId: string,
    operation: string
  ): void {
    const result = this.checkACL({
      edgeNodeId: edgeNodeSubscriberId,
      subscriberId: edgeNodeSubscriberId,
      jobSubscriberId,
      action: operation as ACLCheck['action'],
    });

    if (!result.allowed) {
      throw new Error(result.reason);
    }
  }

  // ============================================================================
  // Encryption (Libsodium)
  // ============================================================================

  /**
   * Generate a new Ed25519 key pair for an edge node
   */
  async generateKeyPair(): Promise<KeyPair> {
    await this.sodiumReady;
    
    const keyPair = sodium.crypto_box_keypair();
    
    return {
      publicKey: this.bytesToBase64(keyPair.publicKey),
      privateKey: this.bytesToBase64(keyPair.privateKey),
    };
  }

  /**
   * Encrypt job parameters for a target edge node using its public key
   */
  async encryptForEdgeNode(
    plaintext: string,
    targetPublicKeyBase64: string
  ): Promise<EncryptedPayload> {
    await this.sodiumReady;

    if (!this.keyPair) {
      throw new Error('Local key pair not configured');
    }

    const targetPublicKey = this.base64ToBytes(targetPublicKeyBase64);
    const ephemeralKeyPair = sodium.crypto_box_keypair();
    const nonce = sodium.randombytes_buf(sodium.crypto_box_NONCEBYTES);
    const message = new TextEncoder().encode(plaintext);

    // Encrypt using crypto_box (asymmetric encryption)
    const ciphertext = sodium.crypto_box_easy(
      message,
      nonce,
      targetPublicKey,
      ephemeralKeyPair.privateKey
    );

    return {
      ciphertext: this.bytesToBase64(ciphertext),
      nonce: this.bytesToBase64(nonce),
      ephemeralPublicKey: this.bytesToBase64(ephemeralKeyPair.publicKey),
    };
  }

  /**
   * Decrypt job parameters received from the backend
   */
  async decryptFromBackend(encrypted: EncryptedPayload): Promise<string> {
    await this.sodiumReady;

    if (!this.keyPair) {
      throw new Error('Local key pair not configured');
    }

    const privateKey = this.base64ToBytes(this.keyPair.privateKey);
    const ephemeralPublicKey = this.base64ToBytes(encrypted.ephemeralPublicKey);
    const nonce = this.base64ToBytes(encrypted.nonce);
    const ciphertext = this.base64ToBytes(encrypted.ciphertext);

    const decrypted = sodium.crypto_box_open_easy(
      ciphertext,
      nonce,
      ephemeralPublicKey,
      privateKey
    );

    if (!decrypted) {
      throw new Error('Decryption failed - invalid ciphertext or keys');
    }

    return new TextDecoder().decode(decrypted);
  }

  /**
   * Encrypt job parameters for local storage (using secretbox)
   */
  async encryptLocal(plaintext: string, key: string): Promise<{ ciphertext: string; nonce: string }> {
    await this.sodiumReady;

    const keyBytes = this.deriveKey(key);
    const nonce = sodium.randombytes_buf(sodium.crypto_secretbox_NONCEBYTES);
    const message = new TextEncoder().encode(plaintext);

    const ciphertext = sodium.crypto_secretbox_easy(message, nonce, keyBytes);

    return {
      ciphertext: this.bytesToBase64(ciphertext),
      nonce: this.bytesToBase64(nonce),
    };
  }

  /**
   * Decrypt locally stored job parameters
   */
  async decryptLocal(encrypted: { ciphertext: string; nonce: string }, key: string): Promise<string> {
    await this.sodiumReady;

    const keyBytes = this.deriveKey(key);
    const nonce = this.base64ToBytes(encrypted.nonce);
    const ciphertext = this.base64ToBytes(encrypted.ciphertext);

    const decrypted = sodium.crypto_secretbox_open_easy(ciphertext, nonce, keyBytes);

    if (!decrypted) {
      throw new Error('Local decryption failed');
    }

    return new TextDecoder().decode(decrypted);
  }

  // ============================================================================
  // Utility Methods
  // ============================================================================

  private generateTokenId(): string {
    return `${Date.now()}-${Math.random().toString(36).substring(2, 15)}`;
  }

  private base64UrlEncode(str: string): string {
    return btoa(str).replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
  }

  private base64UrlDecode(str: string): string {
    const padding = '='.repeat((4 - str.length % 4) % 4);
    const base64 = str.replace(/-/g, '+').replace(/_/g, '/') + padding;
    return atob(base64);
  }

  private hmacSha256(message: string, secret: string): string {
    // Simple HMAC-SHA256 using libsodium
    const key = new TextEncoder().encode(secret);
    const msg = new TextEncoder().encode(message);
    const hash = sodium.crypto_auth(msg, key);
    return this.bytesToBase64(hash);
  }

  private timingSafeEqual(a: string, b: string): boolean {
    if (a.length !== b.length) return false;
    let result = 0;
    for (let i = 0; i < a.length; i++) {
      result |= a.charCodeAt(i) ^ b.charCodeAt(i);
    }
    return result === 0;
  }

  private bytesToBase64(bytes: Uint8Array): string {
    const binString = Array.from(bytes, (b) => String.fromCharCode(b)).join('');
    return btoa(binString);
  }

  private base64ToBytes(base64: string): Uint8Array {
    const binString = atob(base64);
    return Uint8Array.from(binString, (m) => m.charCodeAt(0));
  }

  private deriveKey(password: string): Uint8Array {
    // Simple key derivation using libsodium's generichash
    const passwordBytes = new TextEncoder().encode(password);
    return sodium.crypto_generichash(32, passwordBytes, null);
  }
}

/**
 * Create security manager from environment or config
 */
export async function createEdgeNodeSecurity(
  options: { backendSecret?: string; keyPair?: KeyPair } = {}
): Promise<EdgeNodeSecurity> {
  const security = new EdgeNodeSecurity(options);
  await security.initialize();
  return security;
}
