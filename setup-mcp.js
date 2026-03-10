/**
 * setup-mcp.js - Instala o Desktop Commander MCP localmente para o Buddy
 * Roda automaticamente no npm start
 * Instala em ./mcp-tools/desktopcommanderbuddy para não conflitar
 */
const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const MCP_DIR = path.join(__dirname, 'mcp-tools', 'desktopcommanderbuddy');
const MARKER = path.join(MCP_DIR, '.installed');

function setup() {
  // Ja instalado?
  if (fs.existsSync(MARKER)) {
    console.log('[MCP] Desktop Commander Buddy ja instalado.');
    return;
  }

  console.log('[MCP] Instalando Desktop Commander Buddy...');

  // Cria a pasta
  fs.mkdirSync(MCP_DIR, { recursive: true });

  // Inicializa package.json local
  const pkg = {
    name: "desktopcommanderbuddy",
    version: "1.0.0",
    private: true,
    dependencies: {
      "@wonderwhy-er/desktop-commander": "latest"
    }
  };
  fs.writeFileSync(
    path.join(MCP_DIR, 'package.json'),
    JSON.stringify(pkg, null, 2)
  );

  // Instala dependencias
  try {
    execSync('npm install --production', {
      cwd: MCP_DIR,
      stdio: 'inherit',
      timeout: 120000
    });
  } catch (e) {
    console.error('[MCP] Erro na instalacao:', e.message);
    process.exit(1);
  }

  // Marca como instalado
  fs.writeFileSync(MARKER, new Date().toISOString());
  console.log('[MCP] Desktop Commander Buddy instalado com sucesso!');
}

setup();
