import type { Params } from 'nestjs-pino';

export function buildLoggerConfig(nodeEnv: string): Params {
  const isDev = nodeEnv === 'development';

  return {
    pinoHttp: {
      level: isDev ? 'debug' : 'info',
      transport: isDev
        ? { target: 'pino-pretty', options: { singleLine: true } }
        : undefined,
      autoLogging: true,
      redact: ['req.headers.authorization', 'req.headers.cookie'],
      customProps: () => ({ context: 'HTTP' }),
    },
  };
}
