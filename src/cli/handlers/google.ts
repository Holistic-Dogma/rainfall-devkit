/**
 * Google Workspace tool handler
 * 
 * Handles scope checking and authentication prompts for Google services.
 * When a user tries to use a Google tool without proper scopes, this handler
 * catches the error and guides them through re-authentication.
 */

import { ToolHandler, ToolContext, PostflightContext, DisplayContext } from '../core/types.js';
import { loadConfig } from '../config.js';

// Map of Google tool prefixes to their required scopes
const GOOGLE_TOOL_SCOPES: Record<string, string[]> = {
  'google-gmail': ['https://mail.google.com/'],
  'google-sheets': ['https://www.googleapis.com/auth/spreadsheets'],
  'google-docs': ['https://www.googleapis.com/auth/documents'],
  'google-drive': ['https://www.googleapis.com/auth/drive.readonly'],
};

// Human-readable scope descriptions
const SCOPE_DESCRIPTIONS: Record<string, string> = {
  'https://mail.google.com/': 'Gmail (read, send, and manage emails)',
  'https://www.googleapis.com/auth/spreadsheets': 'Google Sheets',
  'https://www.googleapis.com/auth/documents': 'Google Docs',
  'https://www.googleapis.com/auth/drive.readonly': 'Google Drive (read-only)',
};

/**
 * Check if the current Google tokens have the required scope
 * Uses the backend scopes endpoint to get accurate scope information
 */
async function hasRequiredScope(requiredScopes: string[]): Promise<boolean> {
  const { getGoogleCredentialScopes, getValidGoogleTokens } = await import('../auth/google.js');
  const { Rainfall } = await import('../../sdk.js');
  const { loadConfig } = await import('../config.js');
  
  const config = loadConfig();
  
  // Try to get scopes from the backend first (more accurate)
  let currentScopes: string[] = [];
  
  try {
    const rainfall = new Rainfall({ apiKey: config.apiKey!, baseUrl: config.baseUrl });
    const me = await rainfall.getMe();
    
    if (me.id) {
      const backendScopes = await getGoogleCredentialScopes(me.id);
      if (backendScopes) {
        currentScopes = backendScopes;
      }
    }
  } catch {
    // Fall back to local tokens if backend check fails
  }
  
  // If backend didn't return scopes, fall back to local config
  if (currentScopes.length === 0) {
    const tokens = await getValidGoogleTokens();
    if (tokens?.scope) {
      currentScopes = tokens.scope.split(' ');
    }
  }
  
  if (currentScopes.length === 0) {
    return false;
  }
  
  // Check if all required scopes are present
  return requiredScopes.every(required => 
    currentScopes.some(current => {
      // Exact match
      if (current === required) return true;
      // Check for broader scope (e.g., https://mail.google.com/ covers gmail.readonly)
      if (required === 'https://www.googleapis.com/auth/gmail.readonly' && 
          current === 'https://mail.google.com/') return true;
      if (required === 'https://www.googleapis.com/auth/gmail.send' && 
          current === 'https://mail.google.com/') return true;
      if (required === 'https://www.googleapis.com/auth/gmail.modify' && 
          current === 'https://mail.google.com/') return true;
      return false;
    })
  );
}

/**
 * Get the required scopes for a Google tool
 */
function getRequiredScopes(toolId: string): string[] | null {
  for (const [prefix, scopes] of Object.entries(GOOGLE_TOOL_SCOPES)) {
    if (toolId.startsWith(prefix)) {
      return scopes;
    }
  }
  return null;
}

/**
 * Format scope list for display
 */
function formatScopes(scopes: string[]): string {
  return scopes.map(s => `  • ${SCOPE_DESCRIPTIONS[s] || s}`).join('\n');
}

/**
 * Check if an error is an insufficient scope error from Google
 */
function isInsufficientScopeError(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  
  const message = error.message.toLowerCase();
  return (
    message.includes('insufficient') ||
    message.includes('insufficientpermissions') ||
    message.includes('access_token_scope_insufficient') ||
    message.includes('scope') && message.includes('403') ||
    (message.includes('permission') && message.includes('denied'))
  );
}

/**
 * Google tool handler - checks scopes and guides re-authentication
 */
export const googleToolHandler: ToolHandler = {
  toolId: /^google-/,
  
  async preflight(context: ToolContext) {
    const { toolId } = context;
    
    // Get required scopes for this tool
    const requiredScopes = getRequiredScopes(toolId);
    if (!requiredScopes) {
      return; // Not a recognized Google tool
    }
    
    // Check if user has Google authentication
    const { isGoogleAuthenticated } = await import('../auth/google.js');
    const isAuthenticated = await isGoogleAuthenticated();
    
    if (!isAuthenticated) {
      console.log('🔐 Google authentication required');
      console.log(`\nThis tool requires access to:`);
      console.log(formatScopes(requiredScopes));
      console.log(`\nRun: rainfall auth google${requiredScopes.includes('https://mail.google.com/') ? ' --gmail' : ''}`);
      
      return {
        skipExecution: {
          error: 'Google authentication required',
          message: `Run: rainfall auth google${requiredScopes.includes('https://mail.google.com/') ? ' --gmail' : ''}`,
        },
      };
    }
    
    // Check if we have the required scopes
    const hasScope = await hasRequiredScope(requiredScopes);
    
    if (!hasScope) {
      console.log('⚠️  Insufficient Google permissions');
      console.log(`\nThe tool "${toolId}" requires additional access:`);
      console.log(formatScopes(requiredScopes));
      console.log(`\nYour current authentication is missing these permissions.`);
      console.log(`\nTo fix this, run:`);
      
      // Build the auth command with appropriate flags
      const needsGmail = requiredScopes.includes('https://mail.google.com/');
      const authCommand = `rainfall auth google${needsGmail ? ' --gmail' : ''}`;
      console.log(`  ${authCommand}`);
      
      return {
        skipExecution: {
          error: 'Insufficient Google permissions',
          required_scopes: requiredScopes,
          message: `Run: ${authCommand}`,
        },
      };
    }
    
    // All good, proceed with execution
    return;
  },
  
  async postflight(context: PostflightContext) {
    // Check if the result indicates a scope error
    const { result, toolId } = context;
    
    if (result && typeof result === 'object') {
      const resultObj = result as Record<string, unknown>;
      
      // Check for Google API scope errors in the result
      if (resultObj.error && typeof resultObj.error === 'object') {
        const error = resultObj.error as Record<string, unknown>;
        const errorMessage = JSON.stringify(error).toLowerCase();
        
        if (
          errorMessage.includes('insufficient') ||
          errorMessage.includes('scope') ||
          (error.code === 403 && errorMessage.includes('permission'))
        ) {
          const requiredScopes = getRequiredScopes(toolId);
          
          console.log('\n⚠️  Google API permission denied');
          console.log(`\nThe tool "${toolId}" requires additional access:`);
          if (requiredScopes) {
            console.log(formatScopes(requiredScopes));
          }
          console.log(`\nTo fix this, run:`);
          const needsGmail = requiredScopes?.includes('https://mail.google.com/');
          console.log(`  rainfall auth google${needsGmail ? ' --gmail' : ''}`);
        }
      }
    }
  },
  
  async display(context: DisplayContext): Promise<boolean> {
    const { result, toolId } = context;
    
    // Handle preflight skip results
    if (result && typeof result === 'object') {
      const resultObj = result as Record<string, unknown>;
      
      if (resultObj.error === 'Google authentication required') {
        console.log(`\n❌ ${resultObj.error}`);
        console.log(`\n${resultObj.message}`);
        return true;
      }
      
      if (resultObj.error === 'Insufficient Google permissions') {
        console.log(`\n❌ ${resultObj.error}`);
        console.log(`\n${resultObj.message}`);
        return true;
      }
      
      // Check for Google API errors in the result
      if (resultObj.error && typeof resultObj.error === 'object') {
        const error = resultObj.error as Record<string, unknown>;
        const errorMessage = JSON.stringify(error).toLowerCase();
        
        if (
          errorMessage.includes('insufficient') ||
          errorMessage.includes('scope') ||
          error.status === 'PERMISSION_DENIED' ||
          (error.code === 403 && errorMessage.includes('permission'))
        ) {
          const requiredScopes = getRequiredScopes(toolId);
          
          console.log('\n❌ Google API Error: Insufficient permissions');
          console.log(`\nThe tool "${toolId}" requires additional access:`);
          if (requiredScopes) {
            console.log(formatScopes(requiredScopes));
          }
          console.log(`\nTo fix this, run:`);
          const needsGmail = requiredScopes?.includes('https://mail.google.com/');
          console.log(`  rainfall auth google${needsGmail ? ' --gmail' : ''}`);
          return true;
        }
      }
    }
    
    return false; // Let default display handle it
  },
};

export default googleToolHandler;
