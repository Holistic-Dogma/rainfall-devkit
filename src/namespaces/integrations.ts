/**
 * Integrations namespace for Rainfall SDK
 * GitHub, Notion, Linear, Slack, Figma, Stripe
 */

import { RainfallClient } from '../client.js';
import type { Integrations } from '../types.js';

export function createIntegrations(client: RainfallClient): IntegrationsNamespace {
  return new IntegrationsNamespace(client);
}

export class IntegrationsNamespace {
  constructor(private client: RainfallClient) {}

  get github(): Integrations.GitHub {
    return {
      issues: {
        create: (params) => this.client.executeTool('github-create-issue', params),
        list: (params) => this.client.executeTool('github-list-issues', params),
        get: (params) => this.client.executeTool('github-get-issue', params),
        update: (params) => this.client.executeTool('github-update-issue', params),
        addComment: (params) => this.client.executeTool('github-add-issue-comment', params),
      },
      repos: {
        get: (params) => this.client.executeTool('github-get-repository', params),
        listBranches: (params) => this.client.executeTool('github-list-branches', params),
      },
      pullRequests: {
        list: (params) => this.client.executeTool('github-list-pull-requests', params),
        get: (params) => this.client.executeTool('github-get-pull-request', params),
      },
    };
  }

  get notion(): Integrations.Notion {
    return {
      pages: {
        create: (params) => this.client.executeTool('notion-pages-create', params),
        retrieve: (params) => this.client.executeTool('notion-pages-retrieve', params),
        update: (params) => this.client.executeTool('notion-pages-update', params),
      },
      databases: {
        query: (params) => this.client.executeTool('notion-databases-query', params),
        retrieve: (params) => this.client.executeTool('notion-databases-retrieve', params),
      },
      blocks: {
        appendChildren: (params) => this.client.executeTool('notion-blocks-append-children', params),
        retrieveChildren: (params) => this.client.executeTool('notion-blocks-retrieve-children', params),
      },
    };
  }

  get linear(): Integrations.Linear {
    return {
      issues: {
        create: (params) => this.client.executeTool('linear-core-issueCreate', params),
        list: (params) => this.client.executeTool('linear-core-issues', params),
        get: (params) => this.client.executeTool('linear-core-issue', params),
        update: (params) => this.client.executeTool('linear-core-issueUpdate', params),
        archive: (params) => this.client.executeTool('linear-core-issueArchive', params),
      },
      teams: {
        list: () => this.client.executeTool('linear-core-teams', {}),
      },
    };
  }

  get slack(): Integrations.Slack {
    return {
      messages: {
        send: (params) => this.client.executeTool('slack-core-postMessage', params),
        list: (params) => this.client.executeTool('slack-core-listMessages', params),
      },
      channels: {
        list: () => this.client.executeTool('slack-core-listChannels', {}),
      },
      users: {
        list: () => this.client.executeTool('slack-core-listUsers', {}),
      },
      reactions: {
        add: (params) => this.client.executeTool('slack-core-addReaction', params),
      },
    };
  }

  get figma(): Integrations.Figma {
    return {
      files: {
        get: (params) => this.client.executeTool('figma-files-getFile', { fileKey: params.fileKey }),
        getNodes: (params) => this.client.executeTool('figma-files-getFileNodes', { fileKey: params.fileKey, nodeIds: params.nodeIds }),
        getImages: (params) => this.client.executeTool('figma-files-getFileImage', { fileKey: params.fileKey, nodeIds: params.nodeIds, format: params.format }),
        getComments: (params) => this.client.executeTool('figma-comments-getFileComments', { fileKey: params.fileKey }),
        postComment: (params) => this.client.executeTool('figma-comments-postComment', { fileKey: params.fileKey, message: params.message, nodeId: params.nodeId }),
      },
      projects: {
        list: (params) => this.client.executeTool('figma-projects-getTeamProjects', { teamId: params.teamId }),
        getFiles: (params) => this.client.executeTool('figma-projects-getProjectFiles', { projectId: params.projectId }),
      },
    };
  }

  get stripe(): Integrations.Stripe {
    return {
      customers: {
        create: (params) => this.client.executeTool('stripe-customers-create', params),
        retrieve: (params) => this.client.executeTool('stripe-customers-retrieve', { customerId: params.customerId }),
        update: (params) => this.client.executeTool('stripe-customers-update', params),
        listPaymentMethods: (params) => this.client.executeTool('stripe-customers-list-payment-methods', { customerId: params.customerId }),
      },
      paymentIntents: {
        create: (params) => this.client.executeTool('stripe-payment-intents-create', params),
        retrieve: (params) => this.client.executeTool('stripe-payment-intents-retrieve', { paymentIntentId: params.paymentIntentId }),
        confirm: (params) => this.client.executeTool('stripe-payment-intents-confirm', { paymentIntentId: params.paymentIntentId }),
      },
      subscriptions: {
        create: (params) => this.client.executeTool('stripe-subscriptions-create', params),
        retrieve: (params) => this.client.executeTool('stripe-subscriptions-retrieve', { subscriptionId: params.subscriptionId }),
        cancel: (params) => this.client.executeTool('stripe-subscriptions-cancel', { subscriptionId: params.subscriptionId }),
      },
    };
  }
}
