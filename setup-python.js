/**
 * setup-python.js - Verifica e instala Python automaticamente
 * Roda automaticamente no npm start antes do Electron
 */
const { execSync } = require('child_process');

function findPython() {
  const candidates = ['py', 'python', 'python3'];
  for (const cmd of candidates) {
    try {
      const version = execSync(`${cmd} --version`, { encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] }).trim();
      console.log(`[PYTHON] Encontrado: ${cmd} (${version})`);
      return cmd;
    } catch (e) { /* não encontrado */ }
  }
  return null;
}

function installPython() {
  console.log('[PYTHON] Python não encontrado. Tentando instalar automaticamente...');
  console.log('');

  // Tenta via winget (Windows 10/11)
  try {
    console.log('[PYTHON] Tentando instalar via winget...');
    execSync('winget install Python.Python.3.12 --accept-source-agreements --accept-package-agreements', {
      stdio: 'inherit',
      timeout: 300000 // 5 minutos
    });
    console.log('[PYTHON] Python instalado via winget!');
    console.log('[PYTHON] IMPORTANTE: Feche e abra o terminal novamente, depois rode npm start de novo.');
    process.exit(0);
  } catch (e) {
    console.log('[PYTHON] winget falhou ou não disponível.');
  }

  // Tenta via choco (se tiver Chocolatey)
  try {
    console.log('[PYTHON] Tentando instalar via Chocolatey...');
    execSync('choco install python3 -y', {
      stdio: 'inherit',
      timeout: 300000
    });
    console.log('[PYTHON] Python instalado via Chocolatey!');
    console.log('[PYTHON] IMPORTANTE: Feche e abra o terminal novamente, depois rode npm start de novo.');
    process.exit(0);
  } catch (e) {
    console.log('[PYTHON] Chocolatey falhou ou não disponível.');
  }

  // Nenhum método automático funcionou
  console.log('');
  console.log('==================================================');
  console.log(' PYTHON NÃO ENCONTRADO!');
  console.log('==================================================');
  console.log(' O Buddy precisa do Python 3.10+ para funcionar.');
  console.log(' Instale manualmente em: https://www.python.org/downloads/');
  console.log(' IMPORTANTE: Marque "Add Python to PATH" durante a instalação!');
  console.log('==================================================');
  console.log('');
  process.exit(1);
}

function setup() {
  const python = findPython();
  if (!python) {
    installPython();
    return;
  }

  // Verifica versão mínima (3.10+)
  try {
    const versionOutput = execSync(`${python} -c "import sys; print(f'{sys.version_info.major}.{sys.version_info.minor}')"`, {
      encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe']
    }).trim();
    const [major, minor] = versionOutput.split('.').map(Number);
    if (major < 3 || (major === 3 && minor < 10)) {
      console.log(`[PYTHON] Versão ${versionOutput} encontrada, mas precisa de 3.10+`);
      console.log('[PYTHON] Atualize em: https://www.python.org/downloads/');
      process.exit(1);
    }
    console.log(`[PYTHON] Versão ${versionOutput} OK`);
  } catch (e) {
    console.log('[PYTHON] Não foi possível verificar a versão, continuando...');
  }

  console.log('[PYTHON] Setup concluído!');
}

setup();
