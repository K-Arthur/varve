import type { HelpArticle } from './helpTypes';

export const TROUBLESHOOTING: Record<string, HelpArticle> = {
  'trouble:startup': {
    id: 'trouble:startup',
    title: "App won't start",
    summary: 'Check Rust dependencies and system requirements.',
    body: 'If Varve fails to launch, verify your system meets the requirements. On Linux, ensure WebKitGTK 2.38+ and GTK 3.24+ are installed. Run "just check-env" from the project root to verify your toolchain. Common missing dependencies include librsvg, openssl, and libsoup. On macOS, ensure Xcode Command Line Tools are installed. On Windows, ensure WebView2 is available (included with Windows 11 and recent Windows 10 updates).',
    keywords: ['startup', 'launch', 'crash', 'install', 'dependencies', 'webkit'],
    category: 'Troubleshooting',
    related: ['trouble:canvas', 'trouble:file'],
  },
  'trouble:canvas': {
    id: 'trouble:canvas',
    title: 'Canvas not rendering',
    summary: 'Check WebGL and Canvas2D support.',
    body: 'If the canvas appears blank or does not render shapes, check that your browser supports Canvas2D and WebGL. Varve uses Canvas2D as its primary rendering backend. Try switching between canvas modes (Ctrl+Shift+O for outline, Ctrl+Shift+R for preview) to isolate the issue. Refresh the page or restart the application. Clear browser cache and disable hardware acceleration in your browser settings if problems persist.',
    keywords: ['canvas', 'render', 'blank', 'webgl', 'display', 'graphics'],
    category: 'Troubleshooting',
    related: ['trouble:startup'],
  },
  'trouble:file': {
    id: 'trouble:file',
    title: "File won't open",
    summary: 'Format version mismatch or corrupted file.',
    body: 'If a saved document will not open, the file may be from a newer version of Varve with features not supported by your current version. Check that you are running the latest version of Varve. The document format version is checked on load, and migration is attempted automatically. If the file is corrupted, try restoring from a recovery session or backup. Files are stored as JSON text and can be inspected in any text editor.',
    keywords: ['file', 'open', 'load', 'corrupt', 'version', 'migration'],
    category: 'Troubleshooting',
    related: ['trouble:startup', 'faq:recover'],
  },
  'trouble:export': {
    id: 'trouble:export',
    title: 'Export fails',
    summary: 'Check disk space, permissions, and format settings.',
    body: 'If export fails, first check that you have sufficient disk space and write permissions for the target directory. For PDF export, verify that all fonts used in the design are installed and available. For code export, check that the generated code does not contain unsupported property combinations. Try exporting a single node instead of the entire document to isolate the issue. Check the browser console or application logs for detailed error messages.',
    keywords: ['export', 'fail', 'error', 'disk', 'permission', 'font'],
    category: 'Troubleshooting',
    related: ['export:overview', 'trouble:file'],
  },
};
