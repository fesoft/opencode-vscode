# OpenCode V2 — Extensão para VS Code

Abre o [OpenCode v2](https://opencode.ai/v2/docs) no terminal integrado do VS Code,
com atalhos, botão na barra de título do editor, detecção automática da instalação
e configurações.

## Recursos

- **Abrir o OpenCode** no terminal integrado, no diretório do workspace.
- Comandos para `--standalone` (servidor privado), interface `mini`, continuar a
  última sessão e executar um prompt com `opencode run`.
- **Atalho**: `Ctrl+Alt+O` (macOS: `Cmd+Alt+O`) para abrir.
  `Ctrl+Alt+Shift+O` para executar um prompt.
- **Botão na barra de título** do editor e no menu de contexto do Explorer.
- **Item na barra de status** com a versão detectada (clicável para abrir).
- **Detecção automática** do binário, incluindo diretórios comuns do `nvm`.

## Comandos

| Comando | Descrição |
| --- | --- |
| `OpenCode: Abrir` | Executa `opencode` no terminal integrado. |
| `OpenCode: Abrir (servidor privado / --standalone)` | Executa `opencode --standalone`. |
| `OpenCode: Abrir interface Mini` | Executa `opencode mini`. |
| `OpenCode: Continuar última sessão` | Executa `opencode --continue`. |
| `OpenCode: Executar prompt (run)` | Pede uma mensagem e executa `opencode run "<mensagem>"`. |
| `OpenCode: Verificar instalação` | Localiza o binário e mostra a versão. |

## Configurações

| Configuração | Padrão | Descrição |
| --- | --- | --- |
| `opencode.binaryPath` | `opencode` | Caminho ou comando do binário. |
| `opencode.standalone` | `false` | Usar `--standalone` nos comandos de abertura. |
| `opencode.extraArgs` | `[]` | Argumentos extras para todos os comandos. |
| `opencode.workingDirectory` | `""` | Diretório de trabalho (vazio = primeira pasta do workspace). |
| `opencode.terminalName` | `OpenCode` | Nome do terminal criado. |
| `opencode.reuseTerminal` | `true` | Reutilizar o terminal existente. |
| `opencode.autoDetect` | `true` | Detectar a instalação automaticamente. |
| `opencode.showStatusBar` | `true` | Mostrar item na barra de status. |

## Desenvolvimento

```bash
npm install
npm run compile
```

Para testar: abra esta pasta no VS Code e pressione `F5`.

## Empacotar e instalar globalmente

```bash
npm install
npx vsce package           # gera opencode-vscode-0.1.0.vsix
code --install-extension opencode-vscode-0.1.0.vsix --force
```

Ou use os scripts prontos:

```bash
npm run package
npm run install:vsix
```

Para desinstalar:

```bash
code --uninstall-extension fernando.opencode-vscode
```

## Publicar no VS Code Marketplace

1. Crie um publisher em <https://marketplace.visualstudio.com/manage> e gere um
   Personal Access Token (PAT) no Azure DevOps com escopo **Marketplace → Manage**.
2. Publique localmente:

   ```bash
   npx vsce login fernando
   npm run publish:marketplace
   ```

3. Ou use o workflow `Publish Extension` em `.github/workflows/publish.yml`
   (dispara ao enviar uma tag `v*`). Configure o secret `VSCE_PAT` no repositório
   e, opcionalmente, `OVSX_PAT` para publicar também no Open VSX.

Repositório: <https://github.com/fesoft/opencode-vscode>

## Requisitos

- VS Code 1.136+.
- OpenCode v2 instalado e disponível no `PATH` (ou configurado em `opencode.binaryPath`).
