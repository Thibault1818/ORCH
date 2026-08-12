import dns from 'node:dns/promises';
import http, { type IncomingHttpHeaders, type IncomingMessage, type ServerResponse } from 'node:http';
import net, { type Socket } from 'node:net';
import type { Duplex } from 'node:stream';
import { domainToASCII } from 'node:url';

export interface EndpointProxyTarget {
  host: string;
  port: number;
}

export interface EndpointProxyAddress {
  host: string;
  port: number;
}

export interface EndpointProxyLookupAddress {
  address: string;
  family: 4 | 6;
}

export interface EndpointProxyOptions {
  allowlist: readonly EndpointProxyTarget[];
  listenHost?: string;
  listenPort?: number;
  connectTimeoutMs?: number;
  resolve?: (host: string) => Promise<readonly EndpointProxyLookupAddress[]>;
}

interface ResolvedTarget extends EndpointProxyTarget {
  addresses: readonly EndpointProxyLookupAddress[];
}

const HOP_HEADERS = new Set(['connection', 'keep-alive', 'proxy-authenticate', 'proxy-authorization', 'proxy-connection', 'te', 'trailer', 'transfer-encoding', 'upgrade']);

export class EndpointProxy {
  private readonly server: http.Server;
  private readonly configured = new Map<string, EndpointProxyTarget>();
  private readonly resolved = new Map<string, ResolvedTarget>();
  private readonly sockets = new Set<Duplex>();
  private readonly listenHost: string;
  private readonly listenPort: number;
  private readonly connectTimeoutMs: number;
  private readonly resolveHost: NonNullable<EndpointProxyOptions['resolve']>;
  private started = false;

  constructor(options: EndpointProxyOptions) {
    this.listenHost = normalizeIp(options.listenHost ?? '127.0.0.1');
    if (!isLoopback(this.listenHost)) throw new Error('Endpoint proxy must listen on a numeric loopback address');
    this.listenPort = validPort(options.listenPort ?? 0, true);
    this.connectTimeoutMs = options.connectTimeoutMs ?? 10_000;
    if (!Number.isSafeInteger(this.connectTimeoutMs) || this.connectTimeoutMs < 1) throw new Error('connectTimeoutMs must be a positive integer');
    this.resolveHost = options.resolve ?? resolveHost;
    for (const target of options.allowlist) {
      const normalized = normalizeTarget(target);
      const key = targetKey(normalized.host, normalized.port);
      if (this.configured.has(key)) throw new Error(`Duplicate proxy allowlist endpoint: ${key}`);
      this.configured.set(key, normalized);
    }
    this.server = http.createServer((request, response) => void this.handleHttp(request, response));
    this.server.on('connect', (request, socket, head) => void this.handleConnect(request, socket, head));
    this.server.on('upgrade', (_request, socket) => socket.destroy());
    this.server.on('connection', (socket) => this.track(socket));
  }

  async start(): Promise<EndpointProxyAddress> {
    if (this.started) return this.address();
    for (const [key, target] of this.configured) {
      const addresses = await this.resolveHost(target.host);
      const safe = uniqueAddresses(addresses);
      if (safe.length === 0) throw new Error(`Proxy endpoint did not resolve: ${target.host}`);
      this.resolved.set(key, { ...target, addresses: safe });
    }
    await new Promise<void>((resolve, reject) => {
      const onError = (error: Error) => reject(error);
      this.server.once('error', onError);
      this.server.listen(this.listenPort, this.listenHost, () => {
        this.server.unref();
        this.server.off('error', onError);
        resolve();
      });
    });
    this.started = true;
    return this.address();
  }

  address(): EndpointProxyAddress {
    const address = this.server.address();
    if (!address || typeof address === 'string') throw new Error('Endpoint proxy is not listening');
    return { host: normalizeIp(address.address), port: address.port };
  }

  async close(): Promise<void> {
    for (const socket of this.sockets) socket.destroy();
    if (!this.server.listening) {
      this.started = false;
      return;
    }
    await new Promise<void>((resolve, reject) => this.server.close((error) => error ? reject(error) : resolve()));
    this.started = false;
  }

  private async handleConnect(request: IncomingMessage, client: Duplex, head: Buffer): Promise<void> {
    try {
      const authority = parseAuthority(request.url ?? '');
      const target = this.allowed(authority.host, authority.port);
      const upstream = await this.connect(target);
      this.track(upstream);
      client.write('HTTP/1.1 200 Connection Established\r\n\r\n');
      if (head.length > 0) upstream.write(head);
      upstream.pipe(client);
      client.pipe(upstream);
    } catch (error) {
      if (!client.destroyed) client.end(`HTTP/1.1 ${isDenied(error) ? '403 Forbidden' : '502 Bad Gateway'}\r\nConnection: close\r\n\r\n`);
    }
  }

  private async handleHttp(request: IncomingMessage, response: ServerResponse): Promise<void> {
    try {
      const targetUrl = proxyUrl(request);
      if (targetUrl.protocol !== 'http:' || targetUrl.username || targetUrl.password || targetUrl.hash) throw new ProxyDeniedError('Only unauthenticated HTTP proxy URLs are supported');
      const port = validPort(targetUrl.port ? Number(targetUrl.port) : 80);
      const host = normalizeHost(targetUrl.hostname);
      const target = this.allowed(host, port);
      const address = target.addresses[0]!;
      const upstream = http.request({
        host: address.address,
        family: address.family,
        port,
        method: request.method,
        path: `${targetUrl.pathname}${targetUrl.search}`,
        headers: forwardHeaders(request.headers, hostHeader(host, port)),
        agent: false,
        timeout: this.connectTimeoutMs,
      }, (upstreamResponse) => {
        response.writeHead(upstreamResponse.statusCode ?? 502, forwardHeaders(upstreamResponse.headers));
        upstreamResponse.pipe(response);
      });
      upstream.once('timeout', () => upstream.destroy(new Error('Proxy upstream timed out')));
      upstream.once('error', () => {
        if (!response.headersSent) response.writeHead(502, { connection: 'close' });
        response.end();
      });
      request.pipe(upstream);
    } catch (error) {
      response.writeHead(isDenied(error) ? 403 : 502, { connection: 'close' });
      response.end();
    }
  }

  private allowed(host: string, port: number): ResolvedTarget {
    const target = this.resolved.get(targetKey(normalizeHost(host), port));
    if (!target) throw new ProxyDeniedError(`Proxy endpoint is not allowlisted: ${host}:${port}`);
    return target;
  }

  private async connect(target: ResolvedTarget): Promise<Socket> {
    let lastError: Error | null = null;
    for (const address of target.addresses) {
      try {
        return await connectAddress(address, target.port, this.connectTimeoutMs);
      } catch (error) {
        lastError = error instanceof Error ? error : new Error(String(error));
      }
    }
    throw lastError ?? new Error('Proxy endpoint connection failed');
  }

  private track(socket: Duplex): void {
    this.sockets.add(socket);
    socket.once('close', () => this.sockets.delete(socket));
  }
}

class ProxyDeniedError extends Error {}

async function resolveHost(host: string): Promise<readonly EndpointProxyLookupAddress[]> {
  const ip = net.isIP(host);
  if (ip === 4 || ip === 6) return [{ address: host, family: ip }];
  const values = await dns.lookup(host, { all: true, verbatim: true });
  return values.map((value) => {
    if (value.family !== 4 && value.family !== 6) throw new Error(`Resolver returned an invalid address family: ${value.family}`);
    return { address: value.address, family: value.family };
  });
}

function connectAddress(address: EndpointProxyLookupAddress, port: number, timeoutMs: number): Promise<Socket> {
  return new Promise((resolve, reject) => {
    const socket = net.connect({ host: address.address, family: address.family, port });
    const timer = setTimeout(() => socket.destroy(new Error('Proxy endpoint connection timed out')), timeoutMs);
    socket.once('connect', () => {
      clearTimeout(timer);
      resolve(socket);
    });
    socket.once('error', (error) => {
      clearTimeout(timer);
      reject(error);
    });
  });
}

function proxyUrl(request: IncomingMessage): URL {
  const value = request.url ?? '';
  if (/^http:\/\//i.test(value)) return new URL(value);
  const host = request.headers.host;
  if (!host || !value.startsWith('/')) throw new ProxyDeniedError('Proxy request target is invalid');
  return new URL(`http://${host}${value}`);
}

function parseAuthority(value: string): EndpointProxyTarget {
  if (!value || /[\s/@?#]/.test(value)) throw new ProxyDeniedError('CONNECT authority is invalid');
  const bracketed = /^\[([^\]]+)]:(\d+)$/.exec(value);
  const plain = /^([^:]+):(\d+)$/.exec(value);
  const match = bracketed ?? plain;
  if (!match) throw new ProxyDeniedError('CONNECT requires an explicit host and port');
  return normalizeTarget({ host: match[1]!, port: Number(match[2]) });
}

function normalizeTarget(target: EndpointProxyTarget): EndpointProxyTarget {
  return { host: normalizeHost(target.host), port: validPort(target.port) };
}

function normalizeHost(value: string): string {
  const unwrapped = value.startsWith('[') && value.endsWith(']') ? value.slice(1, -1) : value;
  const ip = normalizeIp(unwrapped);
  if (net.isIP(ip)) return ip;
  const ascii = domainToASCII(unwrapped.replace(/\.$/, '')).toLowerCase();
  if (!ascii || ascii.length > 253 || !ascii.split('.').every((label) => /^(?!-)[a-z0-9-]{1,63}(?<!-)$/.test(label))) {
    throw new Error(`Invalid endpoint host: ${value}`);
  }
  return ascii;
}

function normalizeIp(value: string): string {
  const unwrapped = value.startsWith('[') && value.endsWith(']') ? value.slice(1, -1) : value;
  return unwrapped.toLowerCase();
}

function uniqueAddresses(values: readonly EndpointProxyLookupAddress[]): EndpointProxyLookupAddress[] {
  const seen = new Set<string>();
  const result: EndpointProxyLookupAddress[] = [];
  for (const value of values) {
    const address = normalizeIp(value.address);
    const family = net.isIP(address);
    if (family !== value.family || (family !== 4 && family !== 6)) throw new Error(`Resolver returned an invalid address: ${value.address}`);
    const key = `${family}:${address}`;
    if (!seen.has(key)) {
      seen.add(key);
      result.push({ address, family });
    }
  }
  return result;
}

function forwardHeaders(headers: IncomingHttpHeaders, host?: string): IncomingHttpHeaders {
  const connectionTokens = new Set((headers.connection ?? '').split(',').map((value) => value.trim().toLowerCase()).filter(Boolean));
  const result: IncomingHttpHeaders = {};
  for (const [name, value] of Object.entries(headers)) {
    const lower = name.toLowerCase();
    if (lower === 'host' || HOP_HEADERS.has(lower) || connectionTokens.has(lower)) continue;
    result[lower] = value;
  }
  if (host) result.host = host;
  return result;
}

function hostHeader(host: string, port: number): string {
  const formatted = net.isIP(host) === 6 ? `[${host}]` : host;
  return port === 80 ? formatted : `${formatted}:${port}`;
}

function targetKey(host: string, port: number): string {
  return `${net.isIP(host) === 6 ? `[${host}]` : host}:${port}`;
}

function validPort(value: number, allowZero = false): number {
  if (!Number.isSafeInteger(value) || value < (allowZero ? 0 : 1) || value > 65_535) throw new Error(`Invalid endpoint port: ${value}`);
  return value;
}

function isLoopback(host: string): boolean {
  if (net.isIP(host) === 4) return host.startsWith('127.');
  return net.isIP(host) === 6 && (host === '::1' || host === '0:0:0:0:0:0:0:1');
}

function isDenied(error: unknown): boolean {
  return error instanceof ProxyDeniedError;
}
