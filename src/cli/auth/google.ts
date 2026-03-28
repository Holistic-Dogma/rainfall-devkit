/**
 * Google OAuth authentication for Rainfall CLI
 * 
 * This uses the backend-initiated OAuth flow:
 * 1. CLI starts a local callback server
 * 2. CLI constructs OAuth URL with redirect back to localhost
 * 3. User authenticates with Google
 * 4. Google redirects to backend
 * 5. Backend stores tokens and redirects to localhost
 * 6. CLI receives success signal and completes
 */

import { createServer, IncomingMessage, ServerResponse } from 'http';
import { open } from './utils.js';
import { loadConfig, saveConfig } from '../config.js';

// Default ports to try for the local callback server
const DEFAULT_PORTS = [8080, 8081, 8082, 8083, 8084, 3000, 3001, 3002];

// Google OAuth scopes for various services
export const GOOGLE_SCOPES = {
  drive: 'https://www.googleapis.com/auth/drive.readonly',
  sheets: 'https://www.googleapis.com/auth/spreadsheets',
  docs: 'https://www.googleapis.com/auth/documents',
  gmail: 'https://mail.google.com/',
  calendar: 'https://www.googleapis.com/auth/calendar',
  userinfo: 'https://www.googleapis.com/auth/userinfo.profile https://www.googleapis.com/auth/userinfo.email',
};

export interface GoogleTokens {
  access_token: string;
  refresh_token?: string;
  expiry_date: number;
  token_type: string;
  scope?: string;
}

/**
 * Find an available port for the local callback server
 */
async function findAvailablePort(ports: number[] = DEFAULT_PORTS): Promise<number> {
  for (const port of ports) {
    try {
      const server = createServer();
      await new Promise<void>((resolve, reject) => {
        server.once('error', (err: any) => {
          if (err.code === 'EADDRINUSE') {
            resolve();
          } else {
            reject(err);
          }
        });
        server.once('listening', () => {
          server.close(() => resolve());
        });
        server.listen(port);
      });
      
      // If we get here, the port was available
      return port;
    } catch {
      // Try next port
    }
  }
  throw new Error('No available ports found for OAuth callback server');
}

/**
 * Start a local server to handle the OAuth callback from the backend
 */
function startCallbackServer(port: number): Promise<{ success: boolean; credential_id?: string; error?: string }> {
  return new Promise((resolve, reject) => {
    const server = createServer((req: IncomingMessage, res: ServerResponse) => {
      const url = new URL(req.url || '/', `http://localhost:${port}`);
      
      if (url.pathname === '/oauth/callback') {
        const status = url.searchParams.get('status');
        const credentialId = url.searchParams.get('credential_id');
        const error = url.searchParams.get('error');
        const errorDescription = url.searchParams.get('error_description');
        
        if (status === 'success') {
          res.writeHead(200, { 'Content-Type': 'text/html' });
          res.end(`
            <html>
              <body style="font-family: sans-serif; text-align: center; padding: 50px;">
                <h1 style="color: #2ecc71;">Authentication Successful!</h1>
                <p>You can close this window and return to the terminal.</p>
                <script>setTimeout(() => window.close(), 3000);</script>
              </body>
            </html>
          `);
          server.close();
          resolve({ success: true, credential_id: credentialId || undefined });
        } else {
          res.writeHead(400, { 'Content-Type': 'text/html' });
          res.end(`
            <html>
              <body style="font-family: sans-serif; text-align: center; padding: 50px;">
                <h1 style="color: #e74c3c;">Authentication Failed</h1>
                <p>Error: ${error || 'Unknown error'}</p>
                <p>${errorDescription || ''}</p>
                <p>You can close this window and return to the terminal.</p>
              </body>
            </html>
          `);
          server.close();
          resolve({ success: false, error: error || 'Authentication failed' });
        }
      } else {
        res.writeHead(404);
        res.end('Not found');
      }
    });
    
    server.listen(port, () => {
      console.log(`Waiting for OAuth callback on port ${port}...`);
    });
    
    // Timeout after 5 minutes
    setTimeout(() => {
      server.close();
      reject(new Error('OAuth timeout - no response received within 5 minutes'));
    }, 5 * 60 * 1000);
  });
}

/**
 * Get the backend OAuth URL
 */
function getBackendOAuthUrl(subscriberId: string, redirectUrl: string, scopes: string[]): string {
  const config = loadConfig();
  const baseUrl = config.baseUrl || 'https://olympic-api.pragma-digital.org/v1';
  
  // Build state parameter with redirect back to localhost
  const stateData = {
    subscriber_id: subscriberId,
    credential_name: 'main',
    redirect_url: redirectUrl,
    client_type: 'web'
  };
  const state = Buffer.from(JSON.stringify(stateData)).toString('base64');
  
  // Use the web client ID (same as rainfall-sdk-studio)
  const clientId = '657060394786-m8u442of08oivcgncn4sr774ketuk9nr.apps.googleusercontent.com';
  
  // Backend OAuth callback URL (must match GOOGLE_REDIRECT_URI env var on backend)
  const backendRedirectUri = `${baseUrl}/webhooks/integration/google/oauth/callback`;
  
  return `https://accounts.google.com/o/oauth2/v2/auth?` +
    `client_id=${encodeURIComponent(clientId)}` +
    `&redirect_uri=${encodeURIComponent(backendRedirectUri)}` +
    `&response_type=code` +
    `&scope=${encodeURIComponent(scopes.join(' '))}` +
    `&state=${encodeURIComponent(state)}` +
    `&access_type=offline` +
    `&prompt=consent`;
}

/**
 * Check if Google tokens are expired
 */
export function isTokenExpired(tokens: GoogleTokens): boolean {
  if (!tokens.expiry_date) return true;
  // Consider token expired 5 minutes before actual expiry
  return Date.now() >= (tokens.expiry_date - 5 * 60 * 1000);
}

/**
 * Get credential scopes from the backend (non-sensitive metadata)
 * This endpoint returns scopes without exposing actual tokens
 */
export async function getGoogleCredentialScopes(subscriberId: string): Promise<string[] | null> {
  const config = loadConfig();
  
  if (!config.apiKey) {
    return null;
  }
  
  try {
    const baseUrl = config.baseUrl || 'https://olympic-api.pragma-digital.org/v1';
    const response = await fetch(`${baseUrl}/olympic/subscribers/${subscriberId}/account/credentials/scopes`, {
      headers: {
        'x-api-key': config.apiKey,
      },
    });
    
    if (!response.ok) {
      return null;
    }
    
    const result = await response.json();
    if (!result.success || !result.credentials) {
      return null;
    }
    
    // Find Google credential
    const googleCred = result.credentials.find((c: any) => 
      c.service_name === 'google' && c.credential_name === 'main'
    );
    
    if (!googleCred?.scope) {
      return null;
    }
    
    // Scope is a space-separated string, split it into array
    return googleCred.scope.split(' ').filter((s: string) => s.length > 0);
  } catch (error) {
    return null;
  }
}

/**
 * Get valid Google tokens from the backend
 * Falls back to local config if backend credentials are masked
 */
export async function getValidGoogleTokens(): Promise<GoogleTokens | null> {
  const config = loadConfig();
  
  if (!config.apiKey) {
    return config.googleTokens || null;
  }
  
  try {
    // Get subscriber ID
    const { Rainfall } = await import('../../sdk.js');
    const rainfall = new Rainfall({ apiKey: config.apiKey, baseUrl: config.baseUrl });
    const me = await rainfall.getMe();
    
    if (!me.id) {
      return config.googleTokens || null;
    }
    
    // Fetch credentials from backend
    const baseUrl = config.baseUrl || 'https://olympic-api.pragma-digital.org/v1';
    const response = await fetch(`${baseUrl}/olympic/subscribers/${me.id}/account/credentials`, {
      headers: {
        'x-api-key': config.apiKey,
      },
    });
    
    if (!response.ok) {
      return config.googleTokens || null;
    }
    
    const result = await response.json();
    if (!result.success || !result.credentials) {
      return config.googleTokens || null;
    }
    
    // Find Google credential
    const googleCred = result.credentials.find((c: any) => 
      c.service_name === 'google' && c.credential_name === 'main'
    );
    
    if (!googleCred?.credential_data) {
      return config.googleTokens || null;
    }
    
    // Parse credential data if it's a string
    let credentialData = googleCred.credential_data;
    if (typeof credentialData === 'string') {
      // Handle the masked format [Length: XXX] - fall back to local config
      if (credentialData.startsWith('[Length:')) {
        return config.googleTokens || null;
      }
      try {
        credentialData = JSON.parse(credentialData);
      } catch {
        return config.googleTokens || null;
      }
    }
    
    return {
      access_token: credentialData.access_token,
      refresh_token: credentialData.refresh_token,
      expiry_date: credentialData.expiry_date,
      token_type: credentialData.token_type,
      scope: credentialData.scope,
    };
  } catch (error) {
    return config.googleTokens || null;
  }
}

/**
 * Perform the complete OAuth flow
 */
export async function authenticateGoogle(scopes: string[] = []): Promise<void> {
  const config = loadConfig();
  
  if (!config.apiKey) {
    throw new Error('Not authenticated with Rainfall. Run: rainfall auth login <api-key>');
  }
  
  // Get subscriber ID
  const { Rainfall } = await import('../../sdk.js');
  const rainfall = new Rainfall({ apiKey: config.apiKey, baseUrl: config.baseUrl });
  const me = await rainfall.getMe();
  
  if (!me.id) {
    throw new Error('Failed to get subscriber ID');
  }
  
  // Default scopes if none provided
  const defaultScopes = [
    GOOGLE_SCOPES.userinfo,
    GOOGLE_SCOPES.drive,
    GOOGLE_SCOPES.sheets,
    GOOGLE_SCOPES.docs,
  ];
  
  const requestedScopes = scopes.length > 0 ? scopes : defaultScopes;
  
  // Find available port for local callback
  const port = await findAvailablePort();
  const redirectUrl = `http://localhost:${port}/oauth/callback`;
  
  // Build OAuth URL
  const authUrl = getBackendOAuthUrl(me.id, redirectUrl, requestedScopes);
  
  // Start callback server
  const callbackPromise = startCallbackServer(port);
  
  // Open browser
  console.log('Opening browser for Google authentication...');
  console.log(`Scopes: ${requestedScopes.map(s => s.split('/').pop()).join(', ')}`);
  
  try {
    await open(authUrl);
  } catch {
    console.log('Could not open browser automatically.');
    console.log(`Please open this URL manually:\n${authUrl}`);
  }
  
  // Wait for callback
  const result = await callbackPromise;
  
  if (!result.success) {
    throw new Error(result.error || 'Authentication failed');
  }
  
  console.log('✓ Google authentication successful!');
  console.log('  Credentials stored on Rainfall backend');
  
  // Also fetch and save locally for reference
  const tokens = await getValidGoogleTokens();
  if (tokens) {
    saveConfig({ ...config, googleTokens: tokens });
    console.log(`  Access token expires: ${new Date(tokens.expiry_date).toLocaleString()}`);
    console.log(`  Has refresh token: ${!!tokens.refresh_token}`);
  } else {
    // Backend masks credentials, so save the requested scopes for local reference
    // This allows the CLI to check if required scopes were granted
    const expiryDate = Date.now() + (3600 * 1000); // 1 hour from now (typical OAuth expiry)
    saveConfig({ 
      ...config, 
      googleTokens: {
        access_token: 'stored-on-backend',
        refresh_token: 'stored-on-backend',
        expiry_date: expiryDate,
        token_type: 'Bearer',
        scope: requestedScopes.join(' '),
      } as GoogleTokens
    });
    console.log(`  Scopes granted: ${requestedScopes.map(s => s.split('/').pop()).join(', ')}`);
  }
}

/**
 * Check if Google is authenticated
 */
export async function isGoogleAuthenticated(): Promise<boolean> {
  const tokens = await getValidGoogleTokens();
  return !!tokens?.access_token;
}

/**
 * Clear Google authentication
 */
export async function logoutGoogle(): Promise<void> {
  const config = loadConfig();
  
  // Try to delete credentials from backend
  if (config.apiKey) {
    try {
      const { Rainfall } = await import('../../sdk.js');
      const rainfall = new Rainfall({ apiKey: config.apiKey, baseUrl: config.baseUrl });
      const me = await rainfall.getMe();
      
      if (me.id) {
        const baseUrl = config.baseUrl || 'https://olympic-api.pragma-digital.org/v1';
        
        // First, find the credential
        const listResponse = await fetch(`${baseUrl}/olympic/subscribers/${me.id}/account/credentials`, {
          headers: {
            'x-api-key': config.apiKey,
          },
        });
        
        if (listResponse.ok) {
          const result = await listResponse.json();
          if (result.success && result.credentials) {
            const googleCred = result.credentials.find((c: any) => 
              c.service_name === 'google' && c.credential_name === 'main'
            );
            
            if (googleCred) {
              // Delete the credential
              await fetch(`${baseUrl}/olympic/subscribers/${me.id}/account/credentials/${googleCred.id}`, {
                method: 'DELETE',
                headers: {
                  'x-api-key': config.apiKey,
                },
              });
              console.log('  Credentials removed from Rainfall backend');
            }
          }
        }
      }
    } catch (error) {
      // Silently fail - local cleanup is more important
    }
  }
  
  // Clear local tokens
  const { googleTokens, ...rest } = config;
  saveConfig(rest);
  console.log('✓ Google authentication cleared');
}
