/** Website-only ports and early collision checks; never adopts an existing server. */
const { createServer } = require('node:net');

function websiteE2ePorts(env = process.env) {
  const port = (key, fallback) => {
    const value = env[key] ?? String(fallback);
    if (!/^\d+$/.test(value) || Number(value) < 1 || Number(value) > 65535)
      throw new Error(`${key} must be an integer port from 1 through 65535; received ${value}`);
    return Number(value);
  };
  const pages = port('VARVE_WEBSITE_E2E_PORT', 15991);
  const root = port('VARVE_WEBSITE_E2E_PORT_ROOT', 15992);
  if (pages === root) throw new Error('Website E2E requires distinct Pages and root ports.');
  return { pages, root };
}

async function preflightWebsitePorts(env = process.env) {
  const ports = websiteE2ePorts(env);
  const opened = [];
  try {
    for (const [role, port] of Object.entries(ports)) {
      const server = createServer();
      await new Promise((accept, reject) => {
        server.once('error', (error) =>
          reject(
            new Error(
              `Website E2E ${role} port ${port} unavailable (${error.code}); set ${role === 'pages' ? 'VARVE_WEBSITE_E2E_PORT' : 'VARVE_WEBSITE_E2E_PORT_ROOT'} before building.`,
            ),
          ),
        );
        server.listen({ port, exclusive: true }, accept);
      });
      opened.push(server);
    }
  } finally {
    await Promise.all(
      opened.map(
        (server) =>
          new Promise((done, reject) => server.close((error) => (error ? reject(error) : done()))),
      ),
    );
  }
  return ports;
}

exports.websiteE2ePorts = websiteE2ePorts;
exports.preflightWebsitePorts = preflightWebsitePorts;

if (require.main === module) {
  if (process.argv.length !== 3 || process.argv[2] !== '--check') {
    console.error('Usage: node scripts/website/e2e-ports.cjs --check');
    process.exitCode = 1;
  } else {
    preflightWebsitePorts().catch((error) => {
      console.error(error.message);
      process.exitCode = 1;
    });
  }
}
