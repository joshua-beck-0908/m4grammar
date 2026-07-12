import * as path from 'path';
import { ExtensionContext, workspace } from 'vscode';
import { LanguageClient, LanguageClientOptions, ServerOptions, TransportKind } from 'vscode-languageclient/node';

let client: LanguageClient | undefined;

export function activate(context: ExtensionContext): void {
  const serverModule = context.asAbsolutePath(path.join('out', 'server', 'server.js'));

  const serverOptions: ServerOptions = {
    run: { module: serverModule, transport: TransportKind.ipc },
    debug: {
      module: serverModule,
      transport: TransportKind.ipc,
      options: { execArgv: ['--nolazy', '--inspect=6009'] },
    },
  };

  const clientOptions: LanguageClientOptions = {
    documentSelector: [
      { scheme: 'file', language: 'm4' },
      { scheme: 'untitled', language: 'm4' },
      // Notebook cells (e.g. Jupyter) get this scheme once their language is set to m4.
      { scheme: 'vscode-notebook-cell', language: 'm4' },
    ],
    synchronize: {
      fileEvents: workspace.createFileSystemWatcher('**/*.{m4,m4i,m4f}'),
      configurationSection: 'm4',
    },
    initializationOptions: {
      maxIncludeDepth: workspace.getConfiguration('m4').get('maxIncludeDepth', 8),
    },
  };

  // Client id 'm4' matches the `m4.trace.server` setting declared in package.json:
  // vscode-languageclient reads `<id>.trace.server` automatically to control tracing.
  client = new LanguageClient('m4', 'M4 Language Server', serverOptions, clientOptions);
  void client.start();
}

export function deactivate(): Thenable<void> | undefined {
  return client?.stop();
}
