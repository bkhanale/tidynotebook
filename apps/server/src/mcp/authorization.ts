/**
 * MCP authorization and OAuth 2.1 resource server support.
 *
 * Implements RFC 9728 Protected Resource Metadata, RFC 8414 Authorization
 * Server Metadata, PKCE authorization code exchange, audience binding,
 * and actor resolution on every tool invocation.
 */
import { createHash, randomBytes } from 'node:crypto';
import type { FastifyReply, FastifyRequest } from 'fastify';
import type { Action, Actor, TokenScope } from '@notesapp/core';
import { authorize, tokenGrants, verifyActor } from '@notesapp/core';
import type { IdentityStoreHandle } from '@notesapp/storage-server';
import type {
  AuthInfo,
  OAuthProtectedResourceMetadata,
} from '@modelcontextprotocol/server';
import { OAuthError } from '@modelcontextprotocol/server';
import type { ServerConfig } from '../config.ts';
import type { ResolvedActor } from '../auth/actor.ts';

/** Registered OAuth client metadata. */
export type RegisteredOAuthClient = {
  readonly clientId: string;
  readonly clientName: string;
  readonly redirectUris: readonly string[];
  readonly clientSecret?: string;
  readonly tokenEndpointAuthMethod?:
    'none' | 'client_secret_post' | 'client_secret_basic';
};

/** Default registered clients for MCP access. */
const defaultRegisteredClients: readonly RegisteredOAuthClient[] = [
  {
    clientId: 'notesapp-cli',
    clientName: 'notesapp CLI',
    redirectUris: [
      'http://localhost/callback',
      'http://127.0.0.1/callback',
      'http://localhost:3000/callback',
    ],
    tokenEndpointAuthMethod: 'none',
  },
  {
    clientId: 'claude-desktop',
    clientName: 'Claude Desktop',
    redirectUris: ['http://localhost/callback', 'http://127.0.0.1/callback'],
    tokenEndpointAuthMethod: 'none',
  },
  {
    clientId: 'test-client',
    clientName: 'Test Client',
    redirectUris: [
      'http://localhost/callback',
      'http://127.0.0.1/callback',
      'https://example.com/callback',
    ],
    tokenEndpointAuthMethod: 'none',
  },
];

/** Active client registry. */
const registeredClients = new Map<string, RegisteredOAuthClient>(
  defaultRegisteredClients.map((client) => [client.clientId, client]),
);

/**
 * Registers an OAuth client explicitly.
 */
export function registerOAuthClient(client: RegisteredOAuthClient): void {
  registeredClients.set(client.clientId, client);
}

/**
 * Finds a registered OAuth client by ID.
 */
export function findRegisteredClient(
  clientId: string,
): RegisteredOAuthClient | undefined {
  return registeredClients.get(clientId);
}

/** One pending authorization code. */
type PendingAuthorizationCode = {
  readonly code: string;
  readonly clientId: string;
  readonly accountId: string;
  readonly scopes: readonly string[];
  readonly redirectUri: string;
  readonly codeChallenge: string;
  readonly resource?: string | undefined;
  readonly expiresAt: number;
};

/** Active issued OAuth access token. */
export type ActiveOAuthToken = {
  readonly tokenHash: string;
  readonly clientId: string;
  readonly accountId: string;
  readonly scopes: readonly string[];
  readonly resource?: string | undefined;
  readonly expiresAt: number;
  revokedAt: number | null;
};

/** SHA-256 hash helper for tokens and secrets. */
export function sha256Hex(secret: string): string {
  return createHash('sha256').update(secret, 'utf8').digest('hex');
}

/** PKCE S256 verification helper. */
export function verifyPkce(
  verifier: string,
  challenge: string,
  method = 'S256',
): boolean {
  if (method !== 'S256') return false;
  const computed = createHash('sha256')
    .update(verifier, 'utf8')
    .digest('base64url');
  return computed === challenge;
}

/** Supported OAuth scopes for remote notesapp MCP. */
export const supportedMcpScopes: readonly string[] = [
  'notes:read',
  'notes:write',
  'notes:share',
  'notes:admin',
];

/** Dependencies for MCP authorization. */
export type McpAuthDependencies = {
  readonly config: ServerConfig;
  readonly identity: IdentityStoreHandle;
  readonly resolveSessionActor: (
    request: FastifyRequest,
  ) => Promise<ResolvedActor | null>;
  readonly now?: () => Date;
};

/**
 * Manages OAuth authorization and token verification for MCP.
 */
export class McpAuthorizationServer {
  private readonly config: ServerConfig;
  private readonly identity: IdentityStoreHandle;
  private readonly resolveSessionActor: (
    request: FastifyRequest,
  ) => Promise<ResolvedActor | null>;
  private readonly now: () => Date;

  private readonly authCodes = new Map<string, PendingAuthorizationCode>();
  private readonly oauthTokens = new Map<string, ActiveOAuthToken>();

  constructor(dependencies: McpAuthDependencies) {
    this.config = dependencies.config;
    this.identity = dependencies.identity;
    this.resolveSessionActor = dependencies.resolveSessionActor;
    this.now = dependencies.now ?? (() => new Date());
  }

  /**
   * The public MCP resource URL.
   */
  get resourceUrl(): URL {
    return new URL('/mcp', this.config.origin);
  }

  /**
   * Returns RFC 9728 Protected Resource Metadata.
   */
  getProtectedResourceMetadata(): OAuthProtectedResourceMetadata {
    return {
      resource: this.resourceUrl.href,
      authorization_servers: [this.config.origin],
      scopes_supported: [...supportedMcpScopes],
      bearer_methods_supported: ['header'],
      resource_documentation: `${this.config.origin}/docs/mcp`,
    };
  }

  /**
   * Returns RFC 8414 Authorization Server Metadata.
   */
  getAuthorizationServerMetadata(): Record<string, unknown> {
    return {
      issuer: this.config.origin,
      authorization_endpoint: `${this.config.origin}/oauth/authorize`,
      token_endpoint: `${this.config.origin}/oauth/token`,
      response_types_supported: ['code'],
      response_modes_supported: ['query'],
      grant_types_supported: ['authorization_code'],
      code_challenge_methods_supported: ['S256'],
      token_endpoint_auth_methods_supported: [
        'none',
        'client_secret_post',
        'client_secret_basic',
      ],
      scopes_supported: [...supportedMcpScopes],
    };
  }

  /**
   * Issues an access token directly for an account (useful in tests).
   */
  issueAccessToken(options: {
    readonly accountId: string;
    readonly clientId: string;
    readonly scopes: readonly string[];
    readonly resource?: string | undefined;
    readonly lifetimeSeconds?: number;
  }): string {
    const secret = `mcp_at_${randomBytes(24).toString('hex')}`;
    const hash = sha256Hex(secret);
    const lifetime = options.lifetimeSeconds ?? 3600;
    const expiresAt = Math.floor(this.now().getTime() / 1000) + lifetime;

    this.oauthTokens.set(hash, {
      tokenHash: hash,
      clientId: options.clientId,
      accountId: options.accountId,
      scopes: options.scopes,
      resource: options.resource ?? this.resourceUrl.href,
      expiresAt,
      revokedAt: null,
    });

    return secret;
  }

  /**
   * Revokes an issued OAuth token by secret.
   */
  revokeAccessToken(secret: string): boolean {
    const hash = sha256Hex(secret);
    const token = this.oauthTokens.get(hash);
    if (!token) return false;
    token.revokedAt = Math.floor(this.now().getTime() / 1000);
    return true;
  }

  /**
   * Handles GET /oauth/authorize.
   */
  async handleAuthorize(
    request: FastifyRequest,
    reply: FastifyReply,
  ): Promise<void> {
    const query = request.query as Record<string, string | undefined>;
    const responseType = query.response_type;
    const clientId = query.client_id;
    const redirectUri = query.redirect_uri;
    const codeChallenge = query.code_challenge;
    const codeChallengeMethod = query.code_challenge_method;
    const state = query.state;
    const scope = query.scope ?? 'notes:read notes:write';
    const resource = query.resource;

    if (responseType !== 'code') {
      await reply.status(400).send({
        error: 'unsupported_response_type',
        error_description: 'Only code response_type is supported.',
      });
      return;
    }

    if (!clientId) {
      await reply.status(400).send({
        error: 'invalid_request',
        error_description: 'client_id is required.',
      });
      return;
    }

    const client = findRegisteredClient(clientId);
    if (!client) {
      await reply.status(400).send({
        error: 'unauthorized_client',
        error_description: 'Client is not registered.',
      });
      return;
    }

    if (!redirectUri || !client.redirectUris.includes(redirectUri)) {
      await reply.status(400).send({
        error: 'invalid_request',
        error_description:
          'redirect_uri does not match registered client URLs.',
      });
      return;
    }

    if (!codeChallenge) {
      await reply.status(400).send({
        error: 'invalid_request',
        error_description: 'PKCE code_challenge is required.',
      });
      return;
    }

    if (codeChallengeMethod !== 'S256') {
      await reply.status(400).send({
        error: 'invalid_request',
        error_description: 'code_challenge_method must be S256.',
      });
      return;
    }

    // Audience binding check when resource is specified
    if (
      resource &&
      resource !== this.resourceUrl.href &&
      resource !== this.config.origin
    ) {
      await reply.status(400).send({
        error: 'invalid_target',
        error_description: 'Target resource does not match this server.',
      });
      return;
    }

    // Check authenticated user
    const actorInfo = await this.resolveSessionActor(request);
    if (!actorInfo) {
      await reply.status(401).send({
        error: 'unauthenticated',
        error_description: 'Sign in required before granting authorization.',
      });
      return;
    }

    // Generate single-use authorization code (valid for 5 minutes)
    const code = `mcp_code_${randomBytes(24).toString('hex')}`;
    const expiresAt = Math.floor(this.now().getTime() / 1000) + 300;
    const scopes = scope.split(/\s+/).filter(Boolean);

    this.authCodes.set(code, {
      code,
      clientId,
      accountId: actorInfo.actor.accountId,
      scopes,
      redirectUri,
      codeChallenge,
      resource,
      expiresAt,
    });

    const targetUrl = new URL(redirectUri);
    targetUrl.searchParams.set('code', code);
    if (state) {
      targetUrl.searchParams.set('state', state);
    }

    await reply.redirect(targetUrl.href, 302);
  }

  /**
   * Handles POST /oauth/token.
   */
  async handleToken(
    request: FastifyRequest,
    reply: FastifyReply,
  ): Promise<void> {
    const body = (request.body as Record<string, string | undefined>) ?? {};
    const grantType = body.grant_type;
    const code = body.code;
    const redirectUri = body.redirect_uri;
    const clientId = body.client_id;
    const codeVerifier = body.code_verifier;

    if (grantType !== 'authorization_code') {
      await reply.status(400).send({
        error: 'unsupported_grant_type',
        error_description: 'Only authorization_code grant_type is supported.',
      });
      return;
    }

    if (!code) {
      await reply.status(400).send({
        error: 'invalid_request',
        error_description: 'code parameter is required.',
      });
      return;
    }

    const pending = this.authCodes.get(code);
    if (!pending) {
      await reply.status(400).send({
        error: 'invalid_grant',
        error_description:
          'Authorization code is invalid or has already been used.',
      });
      return;
    }

    // Single-use: immediately remove from store
    this.authCodes.delete(code);

    if (pending.expiresAt <= Math.floor(this.now().getTime() / 1000)) {
      await reply.status(400).send({
        error: 'invalid_grant',
        error_description: 'Authorization code has expired.',
      });
      return;
    }

    if (clientId && clientId !== pending.clientId) {
      await reply.status(400).send({
        error: 'invalid_grant',
        error_description: 'client_id does not match the authorization code.',
      });
      return;
    }

    if (redirectUri && redirectUri !== pending.redirectUri) {
      await reply.status(400).send({
        error: 'invalid_grant',
        error_description:
          'redirect_uri does not match the authorization code.',
      });
      return;
    }

    if (!codeVerifier) {
      await reply.status(400).send({
        error: 'invalid_request',
        error_description: 'PKCE code_verifier is required.',
      });
      return;
    }

    if (!verifyPkce(codeVerifier, pending.codeChallenge)) {
      await reply.status(400).send({
        error: 'invalid_grant',
        error_description: 'PKCE verification failed.',
      });
      return;
    }

    // Issue access token
    const accessToken = this.issueAccessToken({
      accountId: pending.accountId,
      clientId: pending.clientId,
      scopes: pending.scopes,
      resource: pending.resource,
    });

    await reply.status(200).send({
      access_token: accessToken,
      token_type: 'Bearer',
      expires_in: 3600,
      scope: pending.scopes.join(' '),
    });
  }

  /**
   * Verifies an incoming bearer token from an MCP client request.
   * Throws OAuthError if the token is invalid, expired, revoked, or audience mismatched.
   */
  async verifyAccessToken(token: string): Promise<AuthInfo> {
    const hash = sha256Hex(token);
    const nowSec = Math.floor(this.now().getTime() / 1000);

    // 1. Check in-memory OAuth tokens
    const oauthEntry = this.oauthTokens.get(hash);
    if (oauthEntry) {
      if (oauthEntry.revokedAt !== null) {
        throw new OAuthError('invalid_token', 'Access token has been revoked');
      }
      if (oauthEntry.expiresAt <= nowSec) {
        throw new OAuthError('invalid_token', 'Access token has expired');
      }
      if (oauthEntry.resource) {
        const expected = this.resourceUrl.href;
        if (
          oauthEntry.resource !== expected &&
          oauthEntry.resource !== this.config.origin
        ) {
          throw new OAuthError(
            'invalid_token',
            'Token audience does not match this resource server',
          );
        }
      }

      const memberships = await this.identity.memberships(oauthEntry.accountId);
      const actions: Action[] = [];
      if (
        oauthEntry.scopes.includes('notes:read') ||
        oauthEntry.scopes.includes('read')
      ) {
        actions.push('read', 'history');
      }
      if (
        oauthEntry.scopes.includes('notes:write') ||
        oauthEntry.scopes.includes('write')
      ) {
        actions.push('read', 'history', 'write');
      }
      if (
        oauthEntry.scopes.includes('notes:share') ||
        oauthEntry.scopes.includes('share')
      ) {
        actions.push('share');
      }
      if (
        oauthEntry.scopes.includes('notes:admin') ||
        oauthEntry.scopes.includes('admin')
      ) {
        actions.push('read', 'history', 'write', 'share', 'members');
      }
      const uniqueActions = [...new Set(actions)];
      const scopes: TokenScope[] = memberships.map((m) => ({
        workspaceId: m.workspaceId,
        actions: uniqueActions,
      }));
      const grants = tokenGrants(scopes, memberships);
      const verified = verifyActor(oauthEntry.accountId, grants);
      if (!verified.ok) {
        throw new OAuthError(
          'invalid_token',
          'Actor verification failed for access token',
        );
      }

      return {
        token,
        clientId: oauthEntry.clientId,
        scopes: [...oauthEntry.scopes],
        expiresAt: oauthEntry.expiresAt,
        resource: this.resourceUrl,
        extra: {
          accountId: oauthEntry.accountId,
          tokenType: 'oauth',
          secret: token,
        },
      };
    }

    // 2. Check stored agent tokens in database
    const agentRecord = await this.identity.agentToken(hash);
    if (agentRecord) {
      if (agentRecord.revokedAt !== null) {
        throw new OAuthError('invalid_token', 'Agent token has been revoked');
      }
      const expiryMs = Date.parse(agentRecord.expiresAt);
      if (Number.isNaN(expiryMs) || expiryMs <= this.now().getTime()) {
        throw new OAuthError('invalid_token', 'Agent token has expired');
      }

      const memberships = await this.identity.memberships(
        agentRecord.accountId,
      );
      const grants = tokenGrants(agentRecord.scopes, memberships);
      const verified = verifyActor(agentRecord.accountId, grants);
      if (!verified.ok) {
        throw new OAuthError(
          'invalid_token',
          'Actor verification failed for agent token',
        );
      }

      const actions = agentRecord.scopes.flatMap((s) => s.actions);
      return {
        token,
        clientId: 'agent-token',
        scopes: [...new Set(actions)],
        expiresAt: Math.floor(expiryMs / 1000),
        resource: this.resourceUrl,
        extra: {
          accountId: agentRecord.accountId,
          tokenType: 'agent-token',
          secret: token,
        },
      };
    }

    throw new OAuthError('invalid_token', 'Invalid or unrecognised token');
  }

  /**
   * Resolves the verified Actor for one tool call and ensures current permission.
   * This re-checks token revocation, expiration, and current workspace membership.
   */
  async resolveToolActor(
    authInfo: AuthInfo | undefined,
    workspaceId: string,
    action: Action,
  ): Promise<Actor> {
    if (!authInfo) {
      throw new Error('Unauthenticated MCP tool execution: missing auth info.');
    }
    const extra = authInfo.extra as
      { accountId?: string; tokenType?: string; secret?: string } | undefined;
    const accountId = extra?.accountId;
    const secret = extra?.secret ?? authInfo.token;

    if (!accountId || !secret) {
      throw new Error(
        'Unauthenticated MCP tool execution: invalid token context.',
      );
    }

    const hash = sha256Hex(secret);
    const nowSec = Math.floor(this.now().getTime() / 1000);

    if (extra?.tokenType === 'agent-token') {
      const record = await this.identity.agentToken(hash);
      if (!record || record.revokedAt !== null) {
        throw new Error('Forbidden: agent token has been revoked.');
      }
      const expiryMs = Date.parse(record.expiresAt);
      if (Number.isNaN(expiryMs) || expiryMs <= this.now().getTime()) {
        throw new Error('Forbidden: agent token has expired.');
      }

      const memberships = await this.identity.memberships(accountId);
      const membership = memberships.find((m) => m.workspaceId === workspaceId);
      if (!membership) {
        throw new Error(
          `Forbidden: actor is not a member of workspace ${workspaceId}.`,
        );
      }
      const grants = tokenGrants(record.scopes, memberships);
      const verified = verifyActor(accountId, grants);
      if (!verified.ok) {
        throw new Error('Forbidden: actor could not be verified.');
      }

      const check = authorize(
        verified.value,
        workspaceId,
        membership.role,
        action,
      );
      if (!check.ok) {
        throw new Error(
          `Forbidden: actor lacks '${action}' grant on workspace ${workspaceId}.`,
        );
      }
      return verified.value;
    }

    // OAuth token branch
    const oauthEntry = this.oauthTokens.get(hash);
    if (!oauthEntry || oauthEntry.revokedAt !== null) {
      throw new Error('Forbidden: OAuth access token has been revoked.');
    }
    if (oauthEntry.expiresAt <= nowSec) {
      throw new Error('Forbidden: OAuth access token has expired.');
    }

    const memberships = await this.identity.memberships(accountId);
    const membership = memberships.find((m) => m.workspaceId === workspaceId);
    if (!membership) {
      throw new Error(
        `Forbidden: actor is not a member of workspace ${workspaceId}.`,
      );
    }
    const actions: Action[] = [];
    if (
      oauthEntry.scopes.includes('notes:read') ||
      oauthEntry.scopes.includes('read')
    ) {
      actions.push('read', 'history');
    }
    if (
      oauthEntry.scopes.includes('notes:write') ||
      oauthEntry.scopes.includes('write')
    ) {
      actions.push('read', 'history', 'write');
    }
    if (
      oauthEntry.scopes.includes('notes:share') ||
      oauthEntry.scopes.includes('share')
    ) {
      actions.push('share');
    }
    if (
      oauthEntry.scopes.includes('notes:admin') ||
      oauthEntry.scopes.includes('admin')
    ) {
      actions.push('read', 'history', 'write', 'share', 'members');
    }
    const uniqueActions = [...new Set(actions)];
    const scopes: TokenScope[] = memberships.map((m) => ({
      workspaceId: m.workspaceId,
      actions: uniqueActions,
    }));
    const grants = tokenGrants(scopes, memberships);
    const verified = verifyActor(accountId, grants);
    if (!verified.ok) {
      throw new Error('Forbidden: actor could not be verified.');
    }

    const check = authorize(
      verified.value,
      workspaceId,
      membership.role,
      action,
    );
    if (!check.ok) {
      throw new Error(
        `Forbidden: actor lacks '${action}' grant on workspace ${workspaceId}.`,
      );
    }
    return verified.value;
  }
}
