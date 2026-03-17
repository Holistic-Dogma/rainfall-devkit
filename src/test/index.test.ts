import { describe, it, expect } from 'bun:test';
import { Rainfall } from '../index.js';
import { RainfallError, RateLimitError, AuthenticationError } from '../errors.js';

describe('Rainfall SDK', () => {
  describe('Error classes', () => {
    it('should create RainfallError', () => {
      const error = new RainfallError('Test error', 'TEST_ERROR', 400);
      expect(error.message).toBe('Test error');
      expect(error.code).toBe('TEST_ERROR');
      expect(error.statusCode).toBe(400);
    });

    it('should create RateLimitError', () => {
      const error = new RateLimitError('Rate limited', 60, 100, 0);
      expect(error.retryAfter).toBe(60);
      expect(error.limit).toBe(100);
      expect(error.remaining).toBe(0);
    });

    it('should create AuthenticationError', () => {
      const error = new AuthenticationError('Invalid key');
      expect(error.code).toBe('AUTHENTICATION_ERROR');
      expect(error.statusCode).toBe(401);
    });
  });

  describe('Rainfall class', () => {
    it('should create instance with API key', () => {
      const rainfall = new Rainfall({ apiKey: 'test-key' });
      expect(rainfall).toBeDefined();
    });

    it('should expose namespaces', () => {
      const rainfall = new Rainfall({ apiKey: 'test-key' });
      
      expect(rainfall.integrations).toBeDefined();
      expect(rainfall.integrations.github).toBeDefined();
      expect(rainfall.integrations.notion).toBeDefined();
      expect(rainfall.integrations.linear).toBeDefined();
      expect(rainfall.integrations.slack).toBeDefined();
      expect(rainfall.integrations.figma).toBeDefined();
      expect(rainfall.integrations.stripe).toBeDefined();
      
      expect(rainfall.memory).toBeDefined();
      expect(rainfall.articles).toBeDefined();
      expect(rainfall.web).toBeDefined();
      expect(rainfall.ai).toBeDefined();
      expect(rainfall.data).toBeDefined();
      expect(rainfall.utils).toBeDefined();
    });
  });
});
