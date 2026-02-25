import { exec, spawn } from 'child_process';
import fs from 'fs';
import path from 'path';
import os from 'os';

export interface ToolResult {
  success: boolean;
  output: string;
  error?: string;
  metadata?: Record<string, any>;
}

export interface Tool {
  name: string;
  description: string;
  execute(args: Record<string, any>): Promise<ToolResult>;
}

/**
 * Execute shell command
 */
export class ShellTool implements Tool {
  name = 'shell';
  description = 'Execute a shell command on the local computer';

  async execute(args: Record<string, any>): Promise<ToolResult> {
    const { command, timeout = 30000 } = args;

    if (!command) {
      return { success: false, output: '', error: 'Command is required' };
    }

    return new Promise((resolve) => {
      const startTime = Date.now();
      const isWindows = process.platform === 'win32';
      const shell = isWindows ? 'cmd.exe' : '/bin/bash';
      const shellArgs = isWindows ? ['/c', command] : ['-c', command];

      const child = spawn(shell, shellArgs, {
        cwd: args.cwd || process.cwd(),
        env: { ...process.env, ...args.env },
        timeout,
      });

      let stdout = '';
      let stderr = '';

      child.stdout?.on('data', (data) => {
        stdout += data.toString();
      });

      child.stderr?.on('data', (data) => {
        stderr += data.toString();
      });

      child.on('close', (code) => {
        const duration = Date.now() - startTime;
        const output = stdout + (stderr ? `\nSTDERR: ${stderr}` : '');

        resolve({
          success: code === 0,
          output: output || '(no output)',
          error: code !== 0 ? `Exit code: ${code}` : undefined,
          metadata: { exitCode: code, duration: `${duration}ms` },
        });
      });

      child.on('error', (err) => {
        resolve({
          success: false,
          output: '',
          error: err.message,
        });
      });
    });
  }
}

/**
 * Read file contents
 */
export class ReadFileTool implements Tool {
  name = 'read_file';
  description = 'Read contents of a file';

  async execute(args: Record<string, any>): Promise<ToolResult> {
    const { path: filePath, lines = 100, offset = 0 } = args;

    if (!filePath) {
      return { success: false, output: '', error: 'File path is required' };
    }

    try {
      // Security: prevent directory traversal
      const resolvedPath = path.resolve(filePath);
      const homeDir = os.homedir();

      // Allow files in home directory or current working directory
      if (!resolvedPath.startsWith(homeDir) && !resolvedPath.startsWith(process.cwd())) {
        return { success: false, output: '', error: 'Access denied: path must be in home or working directory' };
      }

      if (!fs.existsSync(resolvedPath)) {
        return { success: false, output: '', error: 'File not found' };
      }

      const stat = fs.statSync(resolvedPath);
      if (stat.isDirectory()) {
        return { success: false, output: '', error: 'Path is a directory, not a file' };
      }

      const content = fs.readFileSync(resolvedPath, 'utf-8');
      const allLines = content.split('\n');
      const selectedLines = allLines.slice(offset, offset + lines);

      return {
        success: true,
        output: selectedLines.join('\n'),
        metadata: {
          filePath: resolvedPath,
          totalLines: allLines.length,
          linesShown: selectedLines.length,
          offset,
        },
      };
    } catch (err: any) {
      return { success: false, output: '', error: err.message };
    }
  }
}

/**
 * Write file contents
 */
export class WriteFileTool implements Tool {
  name = 'write_file';
  description = 'Write contents to a file';

  async execute(args: Record<string, any>): Promise<ToolResult> {
    const { path: filePath, content, append = false } = args;

    if (!filePath) {
      return { success: false, output: '', error: 'File path is required' };
    }

    if (content === undefined) {
      return { success: false, output: '', error: 'Content is required' };
    }

    try {
      const resolvedPath = path.resolve(filePath);
      const homeDir = os.homedir();

      // Security check
      if (!resolvedPath.startsWith(homeDir) && !resolvedPath.startsWith(process.cwd())) {
        return { success: false, output: '', error: 'Access denied: path must be in home or working directory' };
      }

      // Create directory if it doesn't exist
      const dir = path.dirname(resolvedPath);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }

      if (append) {
        fs.appendFileSync(resolvedPath, content, 'utf-8');
      } else {
        fs.writeFileSync(resolvedPath, content, 'utf-8');
      }

      return {
        success: true,
        output: `File written successfully: ${resolvedPath}`,
        metadata: { filePath: resolvedPath, bytesWritten: content.length },
      };
    } catch (err: any) {
      return { success: false, output: '', error: err.message };
    }
  }
}

/**
 * List directory contents
 */
export class ListDirTool implements Tool {
  name = 'list_dir';
  description = 'List contents of a directory';

  async execute(args: Record<string, any>): Promise<ToolResult> {
    const { path: dirPath = '.', showHidden = false } = args;

    try {
      const resolvedPath = path.resolve(dirPath);
      const homeDir = os.homedir();

      if (!resolvedPath.startsWith(homeDir) && !resolvedPath.startsWith(process.cwd())) {
        return { success: false, output: '', error: 'Access denied' };
      }

      if (!fs.existsSync(resolvedPath)) {
        return { success: false, output: '', error: 'Directory not found' };
      }

      const stat = fs.statSync(resolvedPath);
      if (!stat.isDirectory()) {
        return { success: false, output: '', error: 'Path is not a directory' };
      }

      const entries = fs.readdirSync(resolvedPath, { withFileTypes: true });
      let filtered = entries;

      if (!showHidden) {
        filtered = entries.filter(e => !e.name.startsWith('.'));
      }

      const result = filtered
        .map(e => `${e.isDirectory() ? 'd' : '-'} ${e.name}`)
        .join('\n');

      return {
        success: true,
        output: result || '(empty)',
        metadata: { path: resolvedPath, itemCount: filtered.length },
      };
    } catch (err: any) {
      return { success: false, output: '', error: err.message };
    }
  }
}

/**
 * Get system information
 */
export class SystemInfoTool implements Tool {
  name = 'system_info';
  description = 'Get system information';

  async execute(args: Record<string, any>): Promise<ToolResult> {
    const info = {
      platform: os.platform(),
      arch: os.arch(),
      hostname: os.hostname(),
      homedir: os.homedir(),
      cwd: process.cwd(),
      nodeVersion: process.version,
      uptime: `${os.uptime()}s`,
      cpuCount: os.cpus().length,
      totalMemory: `${Math.round(os.totalmem() / 1024 / 1024 / 1024)} GB`,
      freeMemory: `${Math.round(os.freemem() / 1024 / 1024 / 1024)} GB`,
    };

    return {
      success: true,
      output: Object.entries(info)
        .map(([k, v]) => `${k}: ${v}`)
        .join('\n'),
      metadata: info,
    };
  }
}

/**
 * Get current directory
 */
export class CwdTool implements Tool {
  name = 'cwd';
  description = 'Get current working directory';

  async execute(args: Record<string, any>): Promise<ToolResult> {
    return {
      success: true,
      output: process.cwd(),
    };
  }
}

/**
 * Tool manager
 */
export class ToolManager {
  private tools: Map<string, Tool> = new Map();

  constructor() {
    this.registerDefaultTools();
  }

  private registerDefaultTools() {
    this.register(new ShellTool());
    this.register(new ReadFileTool());
    this.register(new WriteFileTool());
    this.register(new ListDirTool());
    this.register(new SystemInfoTool());
    this.register(new CwdTool());
  }

  register(tool: Tool): void {
    this.tools.set(tool.name, tool);
  }

  get(name: string): Tool | undefined {
    return this.tools.get(name);
  }

  list(): { name: string; description: string }[] {
    return Array.from(this.tools.values()).map(t => ({
      name: t.name,
      description: t.description,
    }));
  }

  async execute(name: string, args: Record<string, any>): Promise<ToolResult> {
    const tool = this.tools.get(name);
    if (!tool) {
      return { success: false, output: '', error: `Tool not found: ${name}` };
    }

    try {
      return await tool.execute(args);
    } catch (err: any) {
      return { success: false, output: '', error: err.message };
    }
  }
}

export const toolManager = new ToolManager();
