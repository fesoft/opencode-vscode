import * as vscode from 'vscode';
import { execFile } from 'child_process';
import * as os from 'os';
import * as path from 'path';

const SECTION = 'opencode';
const TERMINAL_ICON = new vscode.ThemeIcon('sparkle');

interface OpenCodeSettings {
  binaryPath: string;
  standalone: boolean;
  extraArgs: string[];
  workingDirectory: string;
  terminalName: string;
  reuseTerminal: boolean;
  autoDetect: boolean;
  showStatusBar: boolean;
}

let statusBarItem: vscode.StatusBarItem | undefined;
let knownVersion: string | undefined;
let knownBinary: string | undefined;

function readSettings(): OpenCodeSettings {
  const cfg = vscode.workspace.getConfiguration(SECTION);
  return {
    binaryPath: (cfg.get<string>('binaryPath') ?? 'opencode').trim() || 'opencode',
    standalone: cfg.get<boolean>('standalone', false),
    extraArgs: cfg.get<string[]>('extraArgs', []) ?? [],
    workingDirectory: (cfg.get<string>('workingDirectory') ?? '').trim(),
    terminalName: (cfg.get<string>('terminalName') ?? 'OpenCode').trim() || 'OpenCode',
    reuseTerminal: cfg.get<boolean>('reuseTerminal', true),
    autoDetect: cfg.get<boolean>('autoDetect', true),
    showStatusBar: cfg.get<boolean>('showStatusBar', true),
  };
}

function resolveCwd(settings: OpenCodeSettings): string | undefined {
  if (settings.workingDirectory) {
    return settings.workingDirectory.replace(/^~(?=$|[\\/])/, os.homedir());
  }
  const folders = vscode.workspace.workspaceFolders;
  if (folders && folders.length > 0) {
    return folders[0].uri.fsPath;
  }
  return undefined;
}

function quoteArg(value: string): string {
  if (process.platform === 'win32') {
    if (/[\s"]/.test(value)) {
      return `"${value.replace(/"/g, '\\"')}"`;
    }
    return value;
  }
  if (value === '') {
    return "''";
  }
  if (/[^\w@%+=:,./-]/.test(value)) {
    return `'${value.replace(/'/g, `'\\''`)}'`;
  }
  return value;
}

function buildCommand(binary: string, args: string[]): string {
  return [binary, ...args].map(quoteArg).join(' ');
}

function findTerminal(name: string): vscode.Terminal | undefined {
  return vscode.window.terminals.find((t) => t.name === name);
}

interface OpenOptions {
  /** Extra arguments appended after the configured arguments (e.g. `run`, `"prompt"`). */
  args?: string[];
  /** Force the standalone flag regardless of settings. */
  standalone?: boolean;
  /** Do not apply the configured `standalone` flag (for commands like `run`/`mini`). */
  ignoreStandaloneSetting?: boolean;
  /** Terminal name override. */
  terminalName?: string;
}

function openInTerminal(options: OpenOptions = {}): vscode.Terminal {
  const settings = readSettings();
  const binary = knownBinary ?? settings.binaryPath;

  const args: string[] = [...settings.extraArgs];

  const useStandalone = options.standalone ?? (!options.ignoreStandaloneSetting && settings.standalone);
  if (useStandalone) {
    args.push('--standalone');
  }

  if (options.args && options.args.length > 0) {
    args.push(...options.args);
  }

  const name = options.terminalName ?? settings.terminalName;
  let terminal: vscode.Terminal | undefined;
  if (settings.reuseTerminal) {
    terminal = findTerminal(name);
  }
  if (!terminal) {
    terminal = vscode.window.createTerminal({
      name,
      cwd: resolveCwd(settings),
      iconPath: TERMINAL_ICON,
    });
  }
  terminal.show(true);
  terminal.sendText(buildCommand(binary, args), true);
  return terminal;
}

function execFileAsync(file: string, args: string[]): Promise<{ ok: boolean; stdout: string }> {
  return new Promise((resolve) => {
    execFile(file, args, { timeout: 8000, windowsHide: true }, (error, stdout) => {
      resolve({ ok: !error, stdout: stdout?.toString() ?? '' });
    });
  });
}

async function isExecutable(binary: string): Promise<{ ok: boolean; version?: string }> {
  const result = await execFileAsync(binary, ['--version']);
  if (!result.ok) {
    return { ok: false };
  }
  const version = result.stdout.trim().split(/\r?\n/)[0] || undefined;
  return { ok: true, version };
}

function whichOnPath(binary: string): Promise<string | undefined> {
  const isWin = process.platform === 'win32';
  const file = isWin ? 'where' : 'sh';
  const args = isWin ? [binary] : ['-c', 'command -v "$1"', 'sh', binary];
  return new Promise((resolve) => {
    execFile(file, args, { timeout: 8000, windowsHide: true }, (error, stdout) => {
      if (error) {
        resolve(undefined);
        return;
      }
      const first = stdout
        .split(/\r?\n/)
        .map((line) => line.trim())
        .find((line) => line.length > 0);
      resolve(first || undefined);
    });
  });
}

function commonBinDirs(): string[] {
  const home = os.homedir();
  const dirs = [
    path.join(home, '.opencode', 'bin'),
    path.join(home, '.local', 'bin'),
    path.join(home, 'bin'),
    '/usr/local/bin',
    '/usr/bin',
    '/opt/homebrew/bin',
  ];
  // nvm keeps the active Node bin directory here; opencode installs alongside node.
  const nodeDir = path.dirname(process.execPath);
  if (nodeDir) {
    dirs.unshift(nodeDir);
  }
  return dirs;
}

/** Locate the OpenCode binary and return its path plus reported version. */
async function resolveBinary(
  settings: OpenCodeSettings,
): Promise<{ binary: string; version?: string } | undefined> {
  const configured = settings.binaryPath;
  const hasPathSeparator = configured.includes('/') || configured.includes('\\');

  if (hasPathSeparator) {
    const resolved = configured.replace(/^~(?=$|[\\/])/, os.homedir());
    const result = await isExecutable(resolved);
    return result.ok ? { binary: resolved, version: result.version } : undefined;
  }

  const direct = await isExecutable(configured);
  if (direct.ok) {
    return { binary: configured, version: direct.version };
  }

  const onPath = await whichOnPath(configured);
  if (onPath) {
    const result = await isExecutable(onPath);
    if (result.ok) {
      return { binary: onPath, version: result.version };
    }
  }

  for (const dir of commonBinDirs()) {
    const candidate = path.join(dir, configured);
    const result = await isExecutable(candidate);
    if (result.ok) {
      return { binary: candidate, version: result.version };
    }
  }

  return undefined;
}

function updateStatusBar(installed: boolean): void {
  const settings = readSettings();
  if (!settings.showStatusBar) {
    statusBarItem?.hide();
    return;
  }
  if (!statusBarItem) {
    statusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 50);
    statusBarItem.command = 'opencode.open';
  }
  if (installed) {
    statusBarItem.text = '$(sparkle) OpenCode';
    statusBarItem.tooltip = knownVersion
      ? `OpenCode v2 — ${knownVersion}\nClique para abrir no terminal integrado`
      : 'OpenCode v2 — clique para abrir no terminal integrado';
    statusBarItem.color = undefined;
    statusBarItem.backgroundColor = undefined;
  } else {
    statusBarItem.text = '$(warning) OpenCode';
    statusBarItem.tooltip = 'OpenCode não encontrado. Clique para verificar a instalação.';
    statusBarItem.color = new vscode.ThemeColor('statusBarItem.warningForeground');
    statusBarItem.backgroundColor = new vscode.ThemeColor('statusBarItem.warningBackground');
  }
  statusBarItem.show();
}

async function refreshDetection(showNotification: boolean): Promise<boolean> {
  const settings = readSettings();
  if (!settings.autoDetect) {
    knownBinary = undefined;
    knownVersion = undefined;
    updateStatusBar(true);
    return true;
  }

  const resolved = await resolveBinary(settings);
  if (resolved) {
    knownBinary = resolved.binary;
    knownVersion = resolved.version;
    updateStatusBar(true);
    if (showNotification) {
      const label = resolved.version ? `${resolved.binary} (${resolved.version})` : resolved.binary;
      vscode.window.showInformationMessage(`OpenCode encontrado: ${label}`);
    }
    return true;
  }

  knownBinary = undefined;
  knownVersion = undefined;
  updateStatusBar(false);
  if (showNotification) {
    const install = 'Como instalar';
    const setPath = 'Definir caminho';
    const choice = await vscode.window.showWarningMessage(
      'OpenCode não foi encontrado. Instale-o ou aponte o caminho em opencode.binaryPath.',
      install,
      setPath,
    );
    if (choice === install) {
      void vscode.env.openExternal(vscode.Uri.parse('https://opencode.ai/v2/docs'));
    } else if (choice === setPath) {
      void vscode.commands.executeCommand('workbench.action.openSettings', 'opencode.binaryPath');
    }
  }
  return false;
}

async function ensureInstalled(): Promise<boolean> {
  const settings = readSettings();
  const resolved = await resolveBinary(settings);
  if (resolved) {
    knownBinary = resolved.binary;
    knownVersion = resolved.version;
    return true;
  }
  knownBinary = undefined;
  knownVersion = undefined;
  updateStatusBar(false);
  const install = 'Como instalar';
  const setPath = 'Definir caminho';
  const choice = await vscode.window.showWarningMessage(
    'OpenCode não foi encontrado no PATH. Os comandos continuarão tentando executar "' +
      settings.binaryPath +
      '".',
    install,
    setPath,
  );
  if (choice === install) {
    void vscode.env.openExternal(vscode.Uri.parse('https://opencode.ai/v2/docs'));
  } else if (choice === setPath) {
    void vscode.commands.executeCommand('workbench.action.openSettings', 'opencode.binaryPath');
  }
  return false;
}

async function withInstallCheck(action: () => void): Promise<void> {
  // Non-blocking check: only warn once, then run the terminal command anyway.
  if (!knownBinary) {
    await ensureInstalled();
  }
  action();
}

export function activate(context: vscode.ExtensionContext): void {
  context.subscriptions.push(
    vscode.commands.registerCommand('opencode.open', () => {
      void withInstallCheck(() => openInTerminal());
    }),

    vscode.commands.registerCommand('opencode.openStandalone', () => {
      void withInstallCheck(() => openInTerminal({ standalone: true, terminalName: 'OpenCode (standalone)' }));
    }),

    vscode.commands.registerCommand('opencode.mini', () => {
      void withInstallCheck(() =>
        openInTerminal({ args: ['mini'], ignoreStandaloneSetting: true, terminalName: 'OpenCode Mini' }),
      );
    }),

    vscode.commands.registerCommand('opencode.continue', () => {
      void withInstallCheck(() =>
        openInTerminal({ args: ['--continue'], terminalName: 'OpenCode (continue)' }),
      );
    }),

    vscode.commands.registerCommand('opencode.runPrompt', async () => {
      const prompt = await vscode.window.showInputBox({
        title: 'OpenCode',
        prompt: 'Mensagem para opencode run',
        placeHolder: 'Explique este repositório',
        ignoreFocusOut: true,
      });
      if (!prompt || !prompt.trim()) {
        return;
      }
      void withInstallCheck(() =>
        openInTerminal({
          args: ['run', prompt.trim()],
          terminalName: 'OpenCode Run',
        }),
      );
    }),

    vscode.commands.registerCommand('opencode.checkInstallation', () => {
      void refreshDetection(true);
    }),
  );

  const settings = readSettings();
  if (settings.showStatusBar) {
    updateStatusBar(true);
  }

  void refreshDetection(false);

  context.subscriptions.push(
    vscode.workspace.onDidChangeConfiguration((event) => {
      if (!event.affectsConfiguration(SECTION)) {
        return;
      }
      const next = readSettings();
      if (!next.showStatusBar) {
        statusBarItem?.hide();
      } else {
        void refreshDetection(false);
      }
    }),
  );
}

export function deactivate(): void {
  statusBarItem?.dispose();
  statusBarItem = undefined;
}
