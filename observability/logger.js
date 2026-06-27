const pino = require('pino');

const SERVICE = process.env.SERVICE_NAME ?? 'api-gateway';
const ENV = process.env.NODE_ENV ?? 'development';

// Cuando configures Grafana Cloud, ponés estas variables de entorno:
//   LOKI_URL      = https://logs-prod-us-central1.grafana.net
//   LOKI_USER     = <tu numeric user id de Grafana Cloud>
//   LOKI_TOKEN    = <tu API token de Grafana Cloud>
const lokiUrl = process.env.LOKI_URL;
const lokiUser = process.env.LOKI_USER;
const lokiToken = process.env.LOKI_TOKEN;
const lokiEnabled = !!(lokiUrl && lokiUser && lokiToken);

function pushToLoki(line) {
  if (!lokiEnabled) return;

  const auth = Buffer.from(`${lokiUser}:${lokiToken}`).toString('base64');

  let entry;
  try {
    const parsed = JSON.parse(line);
    const ts = parsed.time ? new Date(parsed.time).getTime() * 1e6 : Date.now() * 1e6;
    entry = {
      streams: [{
        stream: { service: SERVICE, env: ENV, level: parsed.level ?? 'info' },
        values: [[String(ts), line.trim()]],
      }],
    };
  } catch {
    return;
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 2000);

  fetch(`${lokiUrl.trim()}/loki/api/v1/push`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Basic ${auth}`,
    },
    body: JSON.stringify(entry),
    signal: controller.signal,
  })
    .catch(() => undefined)
    .finally(() => clearTimeout(timeout));
}

const logStream = {
  write(line) {
    process.stdout.write(line);
    pushToLoki(line);
  },
};

const logger = pino(
  {
    level: process.env.LOG_LEVEL ?? 'info',
    base: { service: SERVICE, env: ENV },
    formatters: { level: (label) => ({ level: label }) },
    timestamp: pino.stdTimeFunctions.isoTime,
  },
  logStream,
);

module.exports = { logger };
