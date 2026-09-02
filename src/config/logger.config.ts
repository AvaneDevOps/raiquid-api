import type { Params } from 'nestjs-pino';

/**
 * nestjs-pino configuration. In development we pretty-print via `pino-pretty`;
 * in every other environment we emit newline-delimited JSON for log shippers.
 * A request-id is attached to every HTTP log line so requests can be traced.
 */
export function buildLoggerConfig(nodeEnv: string): Params {
  const isDev = nodeEnv === 'development';

  return {
    pinoHttp: {
      level: isDev ? 'debug' : 'info',
      transport: isDev
        ? { target: 'pino-pretty', options: { singleLine: true } }
        : undefined,
      autoLogging: true,
      // Never log secrets that ride along in headers.
      redact: ['req.headers.authorization', 'req.headers.cookie'],
      customProps: () => ({ context: 'HTTP' }),
    },
  };
}
