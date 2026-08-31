/**
 * Remote Gateway
 * WebSocket 控制平面，管理远程连接和消息路由
 */

import * as crypto from 'crypto';
import { EventEmitter } from 'events';
import { WebSocketServer, WebSocket } from 'ws';
import { createServer, Server as HttpServer, IncomingMessage, ServerResponse } from 'http';
import { log, logError, logWarn } from '../utils/logger';
import type {
  GatewayConfig,
  GatewayStatus,
  IChannel,
  ChannelType,
  RemoteMessage,
  RemoteResponse,
  PairingRequest,
  PairedUser,
  GatewayEvent,
  RemoteConfig,
} from './types';
import { MessageRouter } from './message-router';
import { NonRetryableChannelError } from './channels/channel-base';

// WebSocket client connection
interface WSClient {
  id: string;
  ws: WebSocket;
  authenticated: boolean;
  userId?: string;
  connectedAt: number;
  ip: string;
}

// WebSocket message protocol
interface WSMessage {
  type: string;
  payload: unknown;
  requestId?: string;
}

const PAIRING_REQUEST_WINDOW_MS = 10 * 60 * 1000;
const MAX_PAIRING_REQUESTS_PER_WINDOW = 3;

export class RemoteGateway extends EventEmitter {
  private config: GatewayConfig;
  private httpServer?: HttpServer;
  private wss?: WebSocketServer;
  private channels: Map<ChannelType, IChannel> = new Map();
  private channelEnabled: Map<ChannelType, boolean> = new Map();
  private channelOperations: Map<ChannelType, Promise<void>> = new Map();
  private channelErrors: Map<ChannelType, string> = new Map();
  private wsClients: Map<string, WSClient> = new Map();
  private messageRouter: MessageRouter;
  private channelConfigs: RemoteConfig['channels'];

  // Pairing management
  private pairingRequests: Map<string, PairingRequest> = new Map();
  private pairedUsers: Map<string, PairedUser> = new Map();

  private _running: boolean = false;

  // Rate limiting for WebSocket auth
  private authAttempts: Map<string, { count: number; resetTime: number }> = new Map();

  // Rate limiting for new channel pairing requests (pending requests are reused)
  private pairingRequestAttempts: Map<string, { count: number; resetTime: number }> = new Map();

  constructor(
    config: GatewayConfig,
    messageRouter: MessageRouter,
    channelConfigs: RemoteConfig['channels'] = {}
  ) {
    super();
    this.config = config;
    this.messageRouter = messageRouter;
    this.channelConfigs = channelConfigs;

    // Set up message router callback
    this.messageRouter.onResponse(this.handleAgentResponse.bind(this));
  }

  get running(): boolean {
    return this._running;
  }

  /**
   * Start the gateway
   */
  async start(): Promise<void> {
    if (this._running) {
      logWarn('[Gateway] Already running');
      return;
    }

    log('[Gateway] Starting gateway on port', this.config.port);

    try {
      // Create HTTP server for webhook callbacks
      this.httpServer = createServer(this.handleHttpRequest.bind(this));

      // Create WebSocket server
      this.wss = new WebSocketServer({
        server: this.httpServer,
        path: '/ws',
      });

      this.wss.on('connection', this.handleWSConnection.bind(this));
      this.wss.on('error', (error) => {
        logError('[Gateway] WebSocket server error:', error);
        this.emitEvent('gateway.error', { error: error.message });
      });

      // Start listening
      await new Promise<void>((resolve, reject) => {
        this.httpServer!.listen(this.config.port, this.config.bind, () => {
          log(`[Gateway] HTTP/WS server listening on ${this.config.bind}:${this.config.port}`);
          resolve();
        });

        this.httpServer!.on('error', (error) => {
          logError('[Gateway] HTTP server error:', error);
          reject(error);
        });
      });

      // The transport is now accepting traffic. Channel activity is gated by
      // both this flag and each channel's own connected state.
      this._running = true;

      // Start all registered channels
      for (const [type, channel] of this.channels) {
        if (!this.isChannelEnabled(type)) {
          this.channelErrors.delete(type);
          log(`[Gateway] Channel ${type} is disabled; skipping startup`);
          continue;
        }
        try {
          await this.enqueueChannelOperation(type, () => this.startChannelTransport(type, channel));
        } catch (error) {
          logError(`[Gateway] Failed to start channel ${type}:`, error);
        }
      }

      this.emitEvent('gateway.started', { port: this.config.port });
      log('[Gateway] Gateway started successfully');
    } catch (error) {
      logError('[Gateway] Failed to start gateway:', error);
      throw error;
    }
  }

  /**
   * Stop the gateway
   */
  async stop(): Promise<void> {
    if (!this._running && !this.httpServer && !this.wss) {
      return;
    }

    log('[Gateway] Stopping gateway...');
    // Reject new inbound, webhook, and outbound work before waiting for any
    // individual transport to finish shutting down.
    this._running = false;

    // Stop all channels
    for (const [type, channel] of this.channels) {
      try {
        await this.enqueueChannelOperation(type, () => this.stopChannelTransport(type, channel));
      } catch (error) {
        logError(`[Gateway] Error stopping channel ${type}:`, error);
      }
    }

    // Close all WebSocket connections
    for (const client of this.wsClients.values()) {
      try {
        client.ws.close(1000, 'Gateway shutting down');
      } catch (e) {
        // Ignore close errors
      }
    }
    this.wsClients.clear();
    this.authAttempts.clear();
    this.pairingRequestAttempts.clear();
    this.channelErrors.clear();

    // Close WebSocket server
    if (this.wss) {
      this.wss.close();
      this.wss = undefined;
    }

    // Close HTTP server
    if (this.httpServer) {
      await new Promise<void>((resolve) => {
        this.httpServer!.close(() => resolve());
      });
      this.httpServer = undefined;
    }

    this._running = false;
    this.emitEvent('gateway.stopped', {});
    log('[Gateway] Gateway stopped');
  }

  /**
   * Register a channel
   */
  registerChannel(channel: IChannel, enabled: boolean = true): void {
    if (this.channels.has(channel.type)) {
      logWarn(`[Gateway] Channel ${channel.type} already registered, replacing...`);
    }

    // Set up message handler
    channel.onMessage(this.handleChannelMessage.bind(this));
    channel.onError((error) => {
      if (!this.isChannelEnabled(channel.type)) {
        logWarn(`[Gateway] Ignoring error from disabled channel ${channel.type}:`, error.message);
        return;
      }
      this.channelErrors.set(channel.type, error.message);
      logError(`[Gateway] Channel ${channel.type} error:`, error);
      this.emitEvent('channel.error', { channel: channel.type, error: error.message });
    });

    this.channels.set(channel.type, channel);
    this.channelEnabled.set(channel.type, enabled);
    log(`[Gateway] Registered channel: ${channel.type}`);

    // Start channel if gateway is already running
    if (this._running && enabled) {
      this.enqueueChannelOperation(channel.type, () =>
        this.startChannelTransport(channel.type, channel)
      ).catch((error) => {
        logError(`[Gateway] Failed to start channel ${channel.type}:`, error);
      });
    }
  }

  /**
   * Unregister a channel
   */
  async unregisterChannel(type: ChannelType): Promise<void> {
    const channel = this.channels.get(type);
    if (channel) {
      await channel.stop();
      this.channels.delete(type);
      this.channelEnabled.delete(type);
      this.channelOperations.delete(type);
      this.channelErrors.delete(type);
      log(`[Gateway] Unregistered channel: ${type}`);
    }
  }

  /** Enable or disable one registered channel without restarting the gateway. */
  async setChannelEnabled(type: ChannelType, enabled: boolean): Promise<void> {
    const channel = this.channels.get(type);
    if (!channel) throw new Error(`Channel not found: ${type}`);

    await this.enqueueChannelOperation(type, async () => {
      this.channelEnabled.set(type, enabled);
      if (!enabled) {
        // Flip the gate before awaiting transport shutdown so no new inbound,
        // webhook, or outbound work is accepted during a slow stop.
        this.channelErrors.delete(type);
        this.clearPendingPairingsForChannel(type);
        await this.stopChannelTransport(type, channel);
        this.emitEvent('channel.disabled', { channel: type });
        return;
      }

      if (!this._running) {
        this.channelErrors.delete(type);
        this.emitEvent('channel.enabled', { channel: type });
        return;
      }

      await this.startChannelTransport(type, channel);
      this.emitEvent('channel.enabled', { channel: type });
    });
  }

  isChannelEnabled(type: ChannelType): boolean {
    return this.channelEnabled.get(type) !== false;
  }

  private isChannelActive(type: ChannelType): boolean {
    return (
      this._running && this.isChannelEnabled(type) && this.channels.get(type)?.connected === true
    );
  }

  private enqueueChannelOperation(
    type: ChannelType,
    operation: () => Promise<void>
  ): Promise<void> {
    const previous = this.channelOperations.get(type) ?? Promise.resolve();
    const next = previous.catch(() => undefined).then(operation);
    this.channelOperations.set(type, next);
    return next;
  }

  private async startChannelTransport(type: ChannelType, channel: IChannel): Promise<void> {
    try {
      await channel.start();
      this.channelErrors.delete(type);
      log(`[Gateway] Channel ${type} started`);
    } catch (error) {
      this.channelErrors.set(type, error instanceof Error ? error.message : String(error));
      throw error;
    }
  }

  private async stopChannelTransport(type: ChannelType, channel: IChannel): Promise<void> {
    await channel.stop();
    log(`[Gateway] Channel ${type} stopped`);
  }

  private clearPendingPairingsForChannel(type: ChannelType): void {
    const prefix = `${type}:`;
    for (const key of this.pairingRequests.keys()) {
      if (key.startsWith(prefix)) this.pairingRequests.delete(key);
    }
    for (const key of this.pairingRequestAttempts.keys()) {
      if (key.startsWith(prefix)) this.pairingRequestAttempts.delete(key);
    }
  }

  /**
   * Get gateway status
   */
  getStatus(): GatewayStatus {
    const channelStatuses = Array.from(this.channels.entries()).map(([type, channel]) => ({
      type,
      enabled: this.isChannelEnabled(type),
      connected: this.isChannelActive(type),
      error:
        this.isChannelEnabled(type) && !channel.connected
          ? this.channelErrors.get(type)
          : undefined,
    }));

    return {
      running: this._running,
      port: this._running ? this.config.port : undefined,
      publicUrl: undefined, // TODO: Add tunnel support
      channels: channelStatuses,
      activeSessions: this.messageRouter.getActiveSessionCount(),
      pendingPairings: this.pairingRequests.size,
    };
  }

  // Message interceptor for handling interaction responses
  private messageInterceptor?: (message: RemoteMessage) => Promise<boolean> | boolean;

  /**
   * Set message interceptor for interaction responses
   * Returns true if message was consumed (don't route to agent)
   */
  setMessageInterceptor(interceptor: (message: RemoteMessage) => Promise<boolean> | boolean): void {
    this.messageInterceptor = interceptor;
  }

  /**
   * Handle incoming message from a channel
   */
  private async handleChannelMessage(message: RemoteMessage): Promise<void> {
    if (!this.isChannelActive(message.channelType)) {
      logWarn(`[Gateway] Ignoring message from inactive channel: ${message.channelType}`);
      return;
    }

    log('[Gateway] Received message from channel:', {
      type: message.channelType,
      channelId: message.channelId,
      sender: message.sender.id,
    });

    // Check if user is authorized FIRST — before any interceptor processing
    const authorized = await this.checkAuthorization(message);
    if (!authorized) {
      log('[Gateway] User not authorized:', message.sender.id);

      // Handle pairing if enabled
      const effectivePolicy =
        this.getChannelDmPolicy(message.channelType)?.policy ?? this.config.auth.mode;
      if (effectivePolicy === 'pairing') {
        await this.handlePairingRequest(message);
      } else {
        // Send unauthorized response
        await this.sendToChannel({
          channelType: message.channelType,
          channelId: message.channelId,
          content: {
            type: 'text',
            text: '⚠️ 您没有权限使用此机器人。请联系管理员获取访问权限。',
          },
          replyTo: message.id,
        });
      }
      return;
    }

    // Check if this is a response to a pending interaction (only after authorization)
    if (this.messageInterceptor && message.content.type === 'text' && message.content.text) {
      const consumed = await this.messageInterceptor(message);
      if (consumed) {
        log('[Gateway] Message consumed by interceptor (interaction response)');
        return;
      }
    }

    // Check group settings
    if (message.isGroup) {
      const shouldProcess = this.shouldProcessGroupMessage(message);
      if (!shouldProcess) {
        log('[Gateway] Ignoring group message (not mentioned)');
        return;
      }
    }

    // Route message to agent
    this.emitEvent('message.received', { message });
    await this.messageRouter.routeMessage(message);
  }

  /**
   * Handle agent response
   */
  private async handleAgentResponse(response: RemoteResponse): Promise<void> {
    await this.sendToChannel(response);
  }

  /**
   * Send response to channel (public method for RemoteManager)
   */
  async sendResponse(response: RemoteResponse): Promise<void> {
    await this.sendToChannel(response, true);
  }

  /**
   * Send response to channel (internal)
   */
  private async sendToChannel(
    response: RemoteResponse,
    propagateError: boolean = false
  ): Promise<void> {
    const channel = this.channels.get(response.channelType);
    if (!channel) {
      const error = new Error(`Channel not found: ${response.channelType}`);
      logError(`[Gateway] ${error.message}`);
      if (propagateError) {
        throw error;
      }
      return;
    }
    if (!this.isChannelActive(response.channelType)) {
      const error = new NonRetryableChannelError(
        `Channel is disabled or disconnected: ${response.channelType}`
      );
      logError(`[Gateway] ${error.message}`);
      if (propagateError) throw error;
      return;
    }

    try {
      await channel.send(response);
      this.emitEvent('message.sent', { response });
    } catch (error) {
      logError(`[Gateway] Failed to send message to channel ${response.channelType}:`, error);
      if (propagateError) {
        throw error;
      }
    }
  }

  /**
   * Check if user is authorized
   */
  private async checkAuthorization(message: RemoteMessage): Promise<boolean> {
    const channelPolicy = this.getChannelDmPolicy(message.channelType);
    if (channelPolicy) {
      switch (channelPolicy.policy) {
        case 'open':
          return true;
        case 'pairing':
          return this.pairedUsers.has(`${message.channelType}:${message.sender.id}`);
        case 'allowlist': {
          const pairedKey = `${message.channelType}:${message.sender.id}`;
          return (
            (channelPolicy.allowFrom ?? []).includes(message.sender.id) ||
            this.pairedUsers.has(pairedKey)
          );
        }
      }
    }

    // Gateway auth remains the fallback for channels without their own policy
    // and for compatibility with older configurations.
    const { mode, allowlist } = this.config.auth;

    switch (mode) {
      case 'token':
        // Token auth is for WebSocket clients only, deny channel messages
        return false;

      case 'allowlist':
        if (!allowlist || allowlist.length === 0) {
          return false; // Empty allowlist means deny all
        }
        // Support both scoped (channelType:userId) and legacy (userId) formats
        return (
          allowlist.includes(`${message.channelType}:${message.sender.id}`) ||
          allowlist.includes(message.sender.id)
        );

      case 'pairing': {
        // Check if user is paired
        const pairedKey = `${message.channelType}:${message.sender.id}`;
        return this.pairedUsers.has(pairedKey);
      }

      case 'open':
        return true;

      default:
        return false;
    }
  }

  /**
   * Check if group message should be processed
   */
  private shouldProcessGroupMessage(message: RemoteMessage): boolean {
    const rawChannelId = message.channelId.replace(/^(group|dm):/, '');
    const channelConfig = this.channelConfigs[message.channelType];
    let requireMention = true;

    if (channelConfig && ('groups' in channelConfig || 'defaultGroupSettings' in channelConfig)) {
      requireMention =
        channelConfig.groups?.[rawChannelId]?.requireMention ??
        ('defaultGroupSettings' in channelConfig
          ? channelConfig.defaultGroupSettings?.requireMention
          : undefined) ??
        true;
    } else if (channelConfig && 'channels' in channelConfig) {
      requireMention = channelConfig.channels?.[rawChannelId]?.requireMention ?? true;
    }

    if (!requireMention || message.isMentioned) {
      return true;
    }

    // TODO: Check channel-specific group settings
    // For now, require mention in groups by default
    return false;
  }

  private getChannelDmPolicy(
    channelType: ChannelType
  ): { policy: 'open' | 'pairing' | 'allowlist'; allowFrom?: string[] } | undefined {
    const channelConfig = this.channelConfigs[channelType];
    if (!channelConfig || !('dm' in channelConfig)) return undefined;
    return channelConfig.dm;
  }

  /**
   * Handle pairing request from unauthorized user
   */
  private async handlePairingRequest(message: RemoteMessage): Promise<void> {
    const userKey = `${message.channelType}:${message.sender.id}`;

    // Check if already has a pending pairing request
    if (this.pairingRequests.has(userKey)) {
      const existing = this.pairingRequests.get(userKey)!;

      // Check if expired
      if (Date.now() > existing.expiresAt) {
        this.pairingRequests.delete(userKey);
      } else {
        // A requester cannot approve their own access by echoing the code.
        await this.sendToChannel({
          channelType: message.channelType,
          channelId: message.channelId,
          content: {
            type: 'text',
            text: `您的授权申请正在等待管理员审批。\n\n申请码: **${existing.code}**\n\n请让管理员在九思助理的“授权用户”页面批准。直接回复申请码不会自动获得权限。`,
          },
          replyTo: message.id,
        });
        return;
      }
    }

    if (!this.checkPairingRequestRateLimit(userKey)) {
      await this.sendToChannel({
        channelType: message.channelType,
        channelId: message.channelId,
        content: {
          type: 'text',
          text: '⚠️ 授权申请过于频繁，请稍后再试或联系管理员。',
        },
        replyTo: message.id,
      });
      return;
    }

    // Generate new pairing code
    const code = this.generatePairingCode();
    const pairingRequest: PairingRequest = {
      code,
      channelType: message.channelType,
      userId: message.sender.id,
      userName: message.sender.name,
      createdAt: Date.now(),
      expiresAt: Date.now() + PAIRING_REQUEST_WINDOW_MS,
    };

    this.pairingRequests.set(userKey, pairingRequest);

    await this.sendToChannel({
      channelType: message.channelType,
      channelId: message.channelId,
      content: {
        type: 'text',
        text: `👋 您好！首次使用需要管理员授权。\n\n申请码: **${code}**\n\n请让管理员在九思助理的“授权用户”页面核对并批准。申请有效期10分钟，直接回复申请码不会自动获得权限。`,
      },
      replyTo: message.id,
    });

    log('[Gateway] Generated pairing code for user:', userKey);

    // Emit pairing event for UI notification
    this.emitEvent('gateway.pairing_request', {
      code,
      channelType: message.channelType,
      userId: message.sender.id,
      userName: message.sender.name,
    });
  }

  /**
   * Approve pairing request (called from UI)
   */
  approvePairing(channelType: ChannelType, userId: string): boolean {
    const userKey = `${channelType}:${userId}`;
    const request = this.pairingRequests.get(userKey);

    if (!request) {
      logWarn('[Gateway] No pairing request found for:', userKey);
      return false;
    }

    if (Date.now() > request.expiresAt) {
      this.pairingRequests.delete(userKey);
      logWarn('[Gateway] Pairing request expired:', userKey);
      return false;
    }

    this.pairedUsers.set(userKey, {
      userId: request.userId,
      userName: request.userName,
      channelType: request.channelType,
      pairedAt: Date.now(),
      lastActiveAt: Date.now(),
    });

    this.pairingRequests.delete(userKey);
    this.pairingRequestAttempts.delete(userKey);
    log('[Gateway] Pairing approved:', userKey);
    return true;
  }

  /**
   * Reject pairing request (called from UI)
   */
  rejectPairing(channelType: ChannelType, userId: string): boolean {
    const userKey = `${channelType}:${userId}`;
    const request = this.pairingRequests.get(userKey);

    if (!request) {
      logWarn('[Gateway] No pairing request found for:', userKey);
      return false;
    }

    this.pairingRequests.delete(userKey);
    log('[Gateway] Pairing rejected:', userKey);
    return true;
  }

  /**
   * Revoke user pairing
   */
  revokePairing(channelType: ChannelType, userId: string): boolean {
    const userKey = `${channelType}:${userId}`;
    if (this.pairedUsers.has(userKey)) {
      this.pairedUsers.delete(userKey);
      log('[Gateway] Pairing revoked:', userKey);
      return true;
    }
    return false;
  }

  /**
   * Get all paired users
   */
  getPairedUsers(): PairedUser[] {
    return Array.from(this.pairedUsers.values());
  }

  /**
   * Restore a previously-paired user directly (called on startup from persisted config).
   * Bypasses the normal pairing-request flow since the user was already approved.
   */
  restorePairedUser(user: PairedUser): void {
    const userKey = `${user.channelType}:${user.userId}`;
    if (!this.pairedUsers.has(userKey)) {
      this.pairedUsers.set(userKey, user);
      log('[Gateway] Restored paired user:', userKey);
    }
  }

  /**
   * Get pending pairing requests
   */
  getPendingPairings(): PairingRequest[] {
    // Clean up expired requests
    const now = Date.now();
    for (const [key, request] of this.pairingRequests) {
      if (now > request.expiresAt) {
        this.pairingRequests.delete(key);
      }
    }
    return Array.from(this.pairingRequests.values());
  }

  private checkPairingRequestRateLimit(userKey: string): boolean {
    const now = Date.now();
    const attempt = this.pairingRequestAttempts.get(userKey);
    if (!attempt || now > attempt.resetTime) {
      this.pairingRequestAttempts.set(userKey, {
        count: 1,
        resetTime: now + PAIRING_REQUEST_WINDOW_MS,
      });
      return true;
    }

    attempt.count += 1;
    return attempt.count <= MAX_PAIRING_REQUESTS_PER_WINDOW;
  }

  /**
   * Generate an 8-digit request correlation code. It is display-only and is
   * never accepted as proof of authorization.
   */
  private generatePairingCode(): string {
    return crypto.randomInt(0, 100_000_000).toString().padStart(8, '0');
  }

  // ============================================================================
  // HTTP Request Handling (for webhooks)
  // ============================================================================

  private handleHttpRequest(req: IncomingMessage, res: ServerResponse): void {
    const url = req.url || '/';

    // Health check endpoint
    if (url === '/health' || url === '/') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ status: 'ok', timestamp: Date.now() }));
      return;
    }

    // Status endpoint
    if (url === '/status') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(this.getStatus()));
      return;
    }

    // Channel webhooks
    if (url.startsWith('/webhook/')) {
      this.handleWebhook(req, res, url);
      return;
    }

    // 404 for unknown paths
    res.writeHead(404, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Not found' }));
  }

  private handleWebhook(req: IncomingMessage, res: ServerResponse, url: string): void {
    if (req.method !== 'GET' && req.method !== 'POST') {
      res.writeHead(405, { 'Content-Type': 'application/json', Allow: 'GET, POST' });
      res.end(JSON.stringify({ error: 'Method not allowed' }));
      return;
    }

    // Extract channel type from URL: /webhook/feishu, /webhook/telegram, etc.
    const channelType = url.split('?')[0]?.split('/')[2] as ChannelType;

    log(`[Gateway] Received webhook for channel: ${channelType}, URL: ${url}`);

    if (!this.channels.has(channelType)) {
      log(`[Gateway] Channel ${channelType} not found`);
      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: `Channel ${channelType} not found` }));
      return;
    }

    if (!this.isChannelActive(channelType)) {
      log(`[Gateway] Channel ${channelType} is disabled or disconnected`);
      res.writeHead(503, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: `Channel ${channelType} is disabled or disconnected` }));
      return;
    }

    const dispatch = (body: string) => {
      try {
        log(`[Gateway] Webhook body received, length: ${body.length}`);

        const listenerCount = this.listenerCount(`webhook:${channelType}`);
        log(`[Gateway] Listeners for webhook:${channelType}: ${listenerCount}`);

        if (listenerCount === 0) {
          log(`[Gateway] No listeners for webhook:${channelType}`);
          res.writeHead(503, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: `Webhook handler for ${channelType} is unavailable` }));
          return;
        }

        this.emit(`webhook:${channelType}`, {
          method: req.method || 'GET',
          url,
          headers: req.headers,
          body,
          respond: (status: number, data: unknown, contentType?: string) => {
            if (res.writableEnded) return;
            log(`[Gateway] Webhook response: ${status}`);
            if (typeof data === 'string' || Buffer.isBuffer(data)) {
              res.writeHead(status, {
                'Content-Type': contentType || 'text/plain; charset=utf-8',
              });
              res.end(data);
              return;
            }
            res.writeHead(status, { 'Content-Type': contentType || 'application/json' });
            res.end(JSON.stringify(data));
          },
        });
      } catch (error) {
        logError('[Gateway] Error processing webhook body:', error);
        if (!res.writableEnded) {
          res.writeHead(500, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Internal server error' }));
        }
      }
    };

    // WeCom verifies callback URLs with an encrypted GET request.
    if (req.method === 'GET') {
      dispatch('');
      return;
    }

    // Collect POST request body.
    let body = '';
    const MAX_BODY_SIZE = 1024 * 1024; // 1MB limit
    let bodyTooLarge = false;
    req.on('data', (chunk: Buffer) => {
      if (bodyTooLarge) return;
      body += chunk.toString();
      if (body.length > MAX_BODY_SIZE) {
        bodyTooLarge = true;
        res.writeHead(413, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Request body too large' }));
        req.destroy();
      }
    });

    req.on('end', () => {
      if (bodyTooLarge) return;
      dispatch(body);
    });
  }

  // ============================================================================
  // WebSocket Connection Handling
  // ============================================================================

  private handleWSConnection(ws: WebSocket, _req: IncomingMessage): void {
    const clientId = this.generateClientId();
    const ip = _req.socket.remoteAddress || 'unknown';

    const client: WSClient = {
      id: clientId,
      ws,
      authenticated: false,
      connectedAt: Date.now(),
      ip,
    };

    this.wsClients.set(clientId, client);
    log('[Gateway] WebSocket client connected:', clientId);

    ws.on('message', (data: Buffer) => {
      try {
        this.handleWSMessage(client, data);
      } catch (error) {
        logError('[Gateway] Error handling WS message:', error);
      }
    });

    ws.on('close', () => {
      this.wsClients.delete(clientId);
      log('[Gateway] WebSocket client disconnected:', clientId);
    });

    ws.on('error', (error) => {
      logError('[Gateway] WebSocket client error:', clientId, error);
    });

    // Send welcome message
    this.sendWSMessage(ws, {
      type: 'connected',
      payload: { clientId },
    });
  }

  private handleWSMessage(client: WSClient, data: Buffer): void {
    try {
      const message: WSMessage = JSON.parse(data.toString());

      switch (message.type) {
        case 'auth':
          this.handleWSAuth(client, message);
          break;

        case 'message':
          void this.handleWSClientMessage(client, message).catch((error) => {
            logError('[Gateway] Error handling WS client message:', error);
          });
          break;

        case 'ping':
          this.sendWSMessage(client.ws, { type: 'pong', payload: {} });
          break;

        default:
          log('[Gateway] Unknown WS message type:', message.type);
      }
    } catch (error) {
      logError('[Gateway] Failed to parse WS message:', error);
    }
  }

  private checkAuthRateLimit(ip: string): boolean {
    const now = Date.now();
    const attempt = this.authAttempts.get(ip);
    if (!attempt || now > attempt.resetTime) {
      this.authAttempts.set(ip, { count: 1, resetTime: now + 60000 });
      return true;
    }
    attempt.count++;
    return attempt.count <= 5;
  }

  private handleWSAuth(client: WSClient, message: WSMessage): void {
    // Rate limit auth attempts by IP
    if (!this.checkAuthRateLimit(client.ip)) {
      this.sendWSMessage(client.ws, {
        type: 'auth_result',
        payload: { success: false, error: 'Too many auth attempts. Try again later.' },
        requestId: message.requestId,
      });
      return;
    }

    const { token } = message.payload as { token?: string };

    if (this.config.auth.mode === 'token') {
      if (token === this.config.auth.token) {
        client.authenticated = true;
        this.sendWSMessage(client.ws, {
          type: 'auth_result',
          payload: { success: true },
          requestId: message.requestId,
        });
        log('[Gateway] WS client authenticated:', client.id);
      } else {
        this.sendWSMessage(client.ws, {
          type: 'auth_result',
          payload: { success: false, error: 'Invalid token' },
          requestId: message.requestId,
        });
      }
    } else {
      // Other auth modes don't require token for WS
      client.authenticated = true;
      this.sendWSMessage(client.ws, {
        type: 'auth_result',
        payload: { success: true },
        requestId: message.requestId,
      });
    }
  }

  private async handleWSClientMessage(client: WSClient, message: WSMessage): Promise<void> {
    try {
      if (!client.authenticated) {
        this.sendWSMessage(client.ws, {
          type: 'error',
          payload: { error: 'Not authenticated' },
          requestId: message.requestId,
        });
        return;
      }

      const { text } = message.payload as { text: string; sessionId?: string };

      // Create a remote message from WS client
      const remoteMessage: RemoteMessage = {
        id: this.generateMessageId(),
        channelType: 'websocket',
        channelId: client.id,
        sender: {
          id: client.userId || client.id,
          isBot: false,
        },
        content: {
          type: 'text',
          text,
        },
        timestamp: Date.now(),
        isGroup: false,
        isMentioned: true,
      };

      // Route to agent
      await this.messageRouter.routeMessage(remoteMessage);
    } catch (error) {
      logError('[Gateway] Error in handleWSClientMessage:', error);
    }
  }

  private sendWSMessage(ws: WebSocket, message: WSMessage): void {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify(message));
    }
  }

  /**
   * Broadcast message to all authenticated WS clients
   */
  broadcastWS(message: WSMessage): void {
    for (const client of this.wsClients.values()) {
      if (client.authenticated) {
        this.sendWSMessage(client.ws, message);
      }
    }
  }

  private generateClientId(): string {
    return `ws-${Date.now()}-${crypto.randomUUID()}`;
  }

  private generateMessageId(): string {
    return `msg-${Date.now()}-${crypto.randomUUID()}`;
  }

  private emitEvent(type: string, data: unknown): void {
    const event: GatewayEvent = {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      type: type as any,
      timestamp: Date.now(),
      data,
    };
    this.emit('event', event);
    this.emit(type, data);
  }
}
