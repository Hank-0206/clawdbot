import { exec, execSync, spawn } from 'child_process';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { ToolDefinition } from '../types/index.js';

export interface ToolResult {
  success: boolean;
  output: string;
  error?: string;
  metadata?: Record<string, any>;
  filePath?: string;  // If the tool produces a file (e.g. screenshot)
}

export interface Tool {
  name: string;
  description: string;
  definition: ToolDefinition;
  execute(args: Record<string, any>): Promise<ToolResult>;
}

// ─── Shell Command ───────────────────────────────────────────────

export class ShellTool implements Tool {
  name = 'shell';
  description = 'Execute a shell command on the local machine';
  definition: ToolDefinition = {
    name: 'shell',
    description: 'Execute a shell command on the local machine. Use this to run any system command (ls, cat, git, pip, npm, curl, etc.). Returns stdout and stderr.',
    input_schema: {
      type: 'object',
      properties: {
        command: {
          type: 'string',
          description: 'The shell command to execute',
        },
        cwd: {
          type: 'string',
          description: 'Working directory for the command (optional, defaults to home directory)',
        },
        timeout: {
          type: 'number',
          description: 'Timeout in milliseconds (default: 30000)',
        },
      },
      required: ['command'],
    },
  };

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
        cwd: args.cwd || os.homedir(),
        env: { ...process.env },
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
        // Truncate output if too long
        let output = stdout;
        if (stderr) output += `\nSTDERR:\n${stderr}`;
        if (output.length > 10000) {
          output = output.slice(0, 10000) + '\n... (output truncated)';
        }

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

// ─── Read File ───────────────────────────────────────────────────

export class ReadFileTool implements Tool {
  name = 'read_file';
  description = 'Read the contents of a file';
  definition: ToolDefinition = {
    name: 'read_file',
    description: 'Read the contents of a file on the local machine. Supports text files of any type.',
    input_schema: {
      type: 'object',
      properties: {
        path: {
          type: 'string',
          description: 'Absolute or relative file path to read',
        },
        lines: {
          type: 'number',
          description: 'Maximum number of lines to read (default: 200)',
        },
        offset: {
          type: 'number',
          description: 'Line offset to start reading from (default: 0)',
        },
      },
      required: ['path'],
    },
  };

  async execute(args: Record<string, any>): Promise<ToolResult> {
    const { path: filePath, lines = 200, offset = 0 } = args;
    if (!filePath) {
      return { success: false, output: '', error: 'File path is required' };
    }

    try {
      const resolvedPath = path.resolve(filePath);
      if (!fs.existsSync(resolvedPath)) {
        return { success: false, output: '', error: `File not found: ${resolvedPath}` };
      }

      const stat = fs.statSync(resolvedPath);
      if (stat.isDirectory()) {
        return { success: false, output: '', error: 'Path is a directory, not a file' };
      }

      const content = fs.readFileSync(resolvedPath, 'utf-8');
      const allLines = content.split('\n');
      const selectedLines = allLines.slice(offset, offset + lines);

      let output = selectedLines.join('\n');
      if (output.length > 10000) {
        output = output.slice(0, 10000) + '\n... (content truncated)';
      }

      return {
        success: true,
        output,
        metadata: {
          filePath: resolvedPath,
          totalLines: allLines.length,
          linesShown: selectedLines.length,
          fileSize: `${Math.round(stat.size / 1024)}KB`,
        },
      };
    } catch (err: any) {
      return { success: false, output: '', error: err.message };
    }
  }
}

// ─── Write File ──────────────────────────────────────────────────

export class WriteFileTool implements Tool {
  name = 'write_file';
  description = 'Write content to a file';
  definition: ToolDefinition = {
    name: 'write_file',
    description: 'Write content to a file on the local machine. Creates the file and parent directories if they do not exist.',
    input_schema: {
      type: 'object',
      properties: {
        path: {
          type: 'string',
          description: 'Absolute or relative file path to write to',
        },
        content: {
          type: 'string',
          description: 'Content to write to the file',
        },
        append: {
          type: 'boolean',
          description: 'If true, append to the file instead of overwriting (default: false)',
        },
      },
      required: ['path', 'content'],
    },
  };

  async execute(args: Record<string, any>): Promise<ToolResult> {
    const { path: filePath, content, append = false } = args;
    if (!filePath) return { success: false, output: '', error: 'File path is required' };
    if (content === undefined) return { success: false, output: '', error: 'Content is required' };

    try {
      const resolvedPath = path.resolve(filePath);
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
        metadata: { filePath: resolvedPath, bytesWritten: Buffer.byteLength(content, 'utf-8') },
      };
    } catch (err: any) {
      return { success: false, output: '', error: err.message };
    }
  }
}

// ─── List Directory ──────────────────────────────────────────────

export class ListDirTool implements Tool {
  name = 'list_dir';
  description = 'List the contents of a directory';
  definition: ToolDefinition = {
    name: 'list_dir',
    description: 'List files and subdirectories in a directory. Shows file type (file/directory), size, and modification time.',
    input_schema: {
      type: 'object',
      properties: {
        path: {
          type: 'string',
          description: 'Directory path to list (default: home directory)',
        },
        showHidden: {
          type: 'boolean',
          description: 'Show hidden files starting with . (default: false)',
        },
      },
    },
  };

  async execute(args: Record<string, any>): Promise<ToolResult> {
    const { path: dirPath = os.homedir(), showHidden = false } = args;

    try {
      const resolvedPath = path.resolve(dirPath);
      if (!fs.existsSync(resolvedPath)) {
        return { success: false, output: '', error: `Directory not found: ${resolvedPath}` };
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

      const lines = filtered.map(e => {
        try {
          const entryPath = path.join(resolvedPath, e.name);
          const entryStat = fs.statSync(entryPath);
          const size = e.isDirectory() ? '-' : formatSize(entryStat.size);
          const modified = entryStat.mtime.toISOString().slice(0, 16).replace('T', ' ');
          return `${e.isDirectory() ? 'd' : '-'} ${size.padStart(8)} ${modified} ${e.name}`;
        } catch {
          return `${e.isDirectory() ? 'd' : '-'} ${e.name}`;
        }
      });

      return {
        success: true,
        output: lines.join('\n') || '(empty directory)',
        metadata: { path: resolvedPath, itemCount: filtered.length },
      };
    } catch (err: any) {
      return { success: false, output: '', error: err.message };
    }
  }
}

// ─── System Info ─────────────────────────────────────────────────

export class SystemInfoTool implements Tool {
  name = 'system_info';
  description = 'Get detailed system information';
  definition: ToolDefinition = {
    name: 'system_info',
    description: 'Get detailed system information including OS, CPU, memory, disk, network interfaces, and environment.',
    input_schema: {
      type: 'object',
      properties: {},
    },
  };

  async execute(_args: Record<string, any>): Promise<ToolResult> {
    const cpus = os.cpus();
    const networkInterfaces = os.networkInterfaces();

    const ipAddresses: string[] = [];
    for (const [name, interfaces] of Object.entries(networkInterfaces)) {
      if (interfaces) {
        for (const iface of interfaces) {
          if (!iface.internal && iface.family === 'IPv4') {
            ipAddresses.push(`${name}: ${iface.address}`);
          }
        }
      }
    }

    const info = [
      `=== System ===`,
      `OS: ${os.type()} ${os.release()} (${os.arch()})`,
      `Hostname: ${os.hostname()}`,
      `Username: ${os.userInfo().username}`,
      `Home: ${os.homedir()}`,
      `CWD: ${process.cwd()}`,
      `Uptime: ${formatDuration(os.uptime())}`,
      ``,
      `=== CPU ===`,
      `Model: ${cpus[0]?.model || 'Unknown'}`,
      `Cores: ${cpus.length}`,
      ``,
      `=== Memory ===`,
      `Total: ${formatSize(os.totalmem())}`,
      `Free: ${formatSize(os.freemem())}`,
      `Used: ${formatSize(os.totalmem() - os.freemem())} (${Math.round((1 - os.freemem() / os.totalmem()) * 100)}%)`,
      ``,
      `=== Network ===`,
      ...ipAddresses.map(ip => `  ${ip}`),
      ``,
      `=== Node.js ===`,
      `Version: ${process.version}`,
      `Platform: ${process.platform}`,
    ];

    return {
      success: true,
      output: info.join('\n'),
    };
  }
}

// ─── Process List ────────────────────────────────────────────────

export class ProcessListTool implements Tool {
  name = 'process_list';
  description = 'List running processes';
  definition: ToolDefinition = {
    name: 'process_list',
    description: 'List running processes on the system. Shows PID, name, CPU, and memory usage.',
    input_schema: {
      type: 'object',
      properties: {
        filter: {
          type: 'string',
          description: 'Filter processes by name (optional)',
        },
      },
    },
  };

  async execute(args: Record<string, any>): Promise<ToolResult> {
    const { filter } = args;
    const isWindows = process.platform === 'win32';

    let command: string;
    if (isWindows) {
      if (filter) {
        const escapedFilter = String(filter).replace(/'/g, "''");
        command = `powershell -NoProfile -Command "$f='${escapedFilter}'; $p=Get-Process | Where-Object { $_.ProcessName -like ('*' + $f + '*') }; if(-not $p){ Write-Output 'No matching processes.'; exit 0 }; $p | Sort-Object -Property WorkingSet -Descending | Select-Object -First 50 Id, ProcessName, CPU, @{Name='MemoryMB';Expression={[math]::Round($_.WorkingSet64/1MB,1)}} | Format-Table -AutoSize | Out-String -Width 200"`;
      } else {
        command = `powershell -NoProfile -Command "Get-Process | Sort-Object -Property WorkingSet -Descending | Select-Object -First 50 Id, ProcessName, CPU, @{Name='MemoryMB';Expression={[math]::Round($_.WorkingSet64/1MB,1)}} | Format-Table -AutoSize | Out-String -Width 200"`;
      }
    } else {
      command = filter
        ? `ps aux | grep -i "${filter}" | grep -v grep | head -50`
        : `ps aux --sort=-%mem | head -30`;
    }

    return new ShellTool().execute({ command });
  }
}

// ─── Process Kill ────────────────────────────────────────────────

export class ProcessKillTool implements Tool {
  name = 'process_kill';
  description = 'Kill a running process by PID or name';
  definition: ToolDefinition = {
    name: 'process_kill',
    description: 'Kill a running process by PID or name.',
    input_schema: {
      type: 'object',
      properties: {
        pid: {
          type: 'number',
          description: 'Process ID to kill',
        },
        name: {
          type: 'string',
          description: 'Process name to kill (alternative to PID)',
        },
        force: {
          type: 'boolean',
          description: 'Force kill the process (default: false)',
        },
      },
    },
  };

  async execute(args: Record<string, any>): Promise<ToolResult> {
    const { pid, name } = args;
    const isWindows = process.platform === 'win32';
    const force = args.force === undefined ? isWindows : Boolean(args.force);

    if (!pid && !name) {
      return { success: false, output: '', error: 'Either PID or process name is required' };
    }

    let command: string;
    if (isWindows) {
      if (pid) {
        const safePid = Number(pid);
        command = `taskkill /PID ${safePid} ${force ? '/F' : ''} /T`;
      } else {
        const baseName = String(name).trim().replace(/\.exe$/i, '');
        const imageName = `${baseName}.exe`;
        command = `taskkill /IM "${imageName}" ${force ? '/F' : ''} /T`;
      }
    } else {
      if (pid) {
        command = `kill ${force ? '-9' : ''} ${pid}`;
      } else {
        command = `pkill ${force ? '-9' : ''} "${name}"`;
      }
    }

    const result = await new ShellTool().execute({ command });

    // taskkill returns non-zero when process not found — provide a clearer message
    if (!result.success && isWindows && result.output) {
      const output = result.output.toLowerCase();
      if (output.includes('not found') || output.includes('没有找到')) {
        return { success: true, output: `Process "${name || pid}" is not running.` };
      }
    }

    return result;
  }
}

// ─── Network Info ────────────────────────────────────────────────

export class NetworkInfoTool implements Tool {
  name = 'network_info';
  description = 'Get network information and connectivity status';
  definition: ToolDefinition = {
    name: 'network_info',
    description: 'Get network information: IP addresses, open ports, active connections, and connectivity test.',
    input_schema: {
      type: 'object',
      properties: {
        action: {
          type: 'string',
          enum: ['interfaces', 'connections', 'ping', 'ports'],
          description: 'Action: interfaces (default), connections, ping, or ports',
        },
        target: {
          type: 'string',
          description: 'Target host for ping action (default: 8.8.8.8)',
        },
      },
    },
  };

  async execute(args: Record<string, any>): Promise<ToolResult> {
    const { action = 'interfaces', target = '8.8.8.8' } = args;
    const isWindows = process.platform === 'win32';

    let command: string;
    switch (action) {
      case 'connections':
        command = isWindows ? 'netstat -an | findstr ESTABLISHED' : 'ss -tunp | head -30';
        break;
      case 'ping':
        command = isWindows ? `ping -n 4 ${target}` : `ping -c 4 ${target}`;
        break;
      case 'ports':
        command = isWindows ? 'netstat -an | findstr LISTENING' : 'ss -tlnp';
        break;
      default: // interfaces
        command = isWindows ? 'ipconfig' : 'ip addr show 2>/dev/null || ifconfig';
    }

    return new ShellTool().execute({ command });
  }
}

// ─── Open Application / URL ──────────────────────────────────────

export class OpenTool implements Tool {
  name = 'open';
  description = 'Open a URL, file, or application';
  definition: ToolDefinition = {
    name: 'open',
    description: 'Open a URL in the default browser, or open a file/application. Works across Windows, macOS, and Linux.',
    input_schema: {
      type: 'object',
      properties: {
        target: {
          type: 'string',
          description: 'URL, file path, or application name to open',
        },
      },
      required: ['target'],
    },
  };

  async execute(args: Record<string, any>): Promise<ToolResult> {
    const { target } = args;
    if (!target) return { success: false, output: '', error: 'Target is required' };

    const platform = process.platform;
    let command: string;

    if (platform === 'win32') {
      command = `start "" "${target}"`;
    } else if (platform === 'darwin') {
      command = `open "${target}"`;
    } else {
      command = `xdg-open "${target}"`;
    }

    return new ShellTool().execute({ command, timeout: 5000 });
  }
}

// ─── Clipboard ───────────────────────────────────────────────────

export class ClipboardTool implements Tool {
  name = 'clipboard';
  description = 'Read from or write to the system clipboard';
  definition: ToolDefinition = {
    name: 'clipboard',
    description: 'Read from or write to the system clipboard.',
    input_schema: {
      type: 'object',
      properties: {
        action: {
          type: 'string',
          enum: ['read', 'write'],
          description: 'Action: read clipboard contents or write text to clipboard',
        },
        text: {
          type: 'string',
          description: 'Text to write to clipboard (required for write action)',
        },
      },
      required: ['action'],
    },
  };

  async execute(args: Record<string, any>): Promise<ToolResult> {
    const { action, text } = args;
    const platform = process.platform;

    if (action === 'read') {
      let command: string;
      if (platform === 'win32') {
        command = 'powershell -command "Get-Clipboard"';
      } else if (platform === 'darwin') {
        command = 'pbpaste';
      } else {
        command = 'xclip -selection clipboard -o 2>/dev/null || xsel --clipboard --output';
      }
      return new ShellTool().execute({ command });
    } else if (action === 'write') {
      if (!text) return { success: false, output: '', error: 'Text is required for write action' };

      let command: string;
      // Use echo to pipe text to clipboard utility
      const escapedText = text.replace(/"/g, '\\"');
      if (platform === 'win32') {
        command = `powershell -command "Set-Clipboard -Value '${text.replace(/'/g, "''")}'"`;
      } else if (platform === 'darwin') {
        command = `echo "${escapedText}" | pbcopy`;
      } else {
        command = `echo "${escapedText}" | xclip -selection clipboard`;
      }
      const result = await new ShellTool().execute({ command });
      if (result.success) {
        result.output = 'Text copied to clipboard';
      }
      return result;
    }

    return { success: false, output: '', error: 'Action must be "read" or "write"' };
  }
}

// ─── Disk Usage ──────────────────────────────────────────────────

export class DiskUsageTool implements Tool {
  name = 'disk_usage';
  description = 'Check disk space usage';
  definition: ToolDefinition = {
    name: 'disk_usage',
    description: 'Check disk space usage for all drives or a specific path.',
    input_schema: {
      type: 'object',
      properties: {
        path: {
          type: 'string',
          description: 'Specific path to check disk usage for (optional)',
        },
      },
    },
  };

  async execute(args: Record<string, any>): Promise<ToolResult> {
    const { path: targetPath } = args;
    const isWindows = process.platform === 'win32';

    let command: string;
    if (isWindows) {
      if (targetPath) {
        command = `powershell -command "Get-PSDrive -Name (Split-Path '${targetPath}' -Qualifier).TrimEnd(':') | Format-Table Name,Used,Free -AutoSize"`;
      } else {
        command = `powershell -command "Get-PSDrive -PSProvider FileSystem | Select-Object Name, @{N='Used(GB)';E={[math]::Round($_.Used/1GB,2)}}, @{N='Free(GB)';E={[math]::Round($_.Free/1GB,2)}}, @{N='Total(GB)';E={[math]::Round(($_.Used+$_.Free)/1GB,2)}} | Format-Table -AutoSize"`;
      }
    } else {
      command = targetPath ? `df -h "${targetPath}"` : `df -h`;
    }

    return new ShellTool().execute({ command });
  }
}

// ─── Search Files ────────────────────────────────────────────────

export class SearchFilesTool implements Tool {
  name = 'search_files';
  description = 'Search for files by name or search within file contents';
  definition: ToolDefinition = {
    name: 'search_files',
    description: 'Search for files by name pattern or search within file contents using grep/findstr.',
    input_schema: {
      type: 'object',
      properties: {
        query: {
          type: 'string',
          description: 'Search query - filename pattern or text to search for within files',
        },
        path: {
          type: 'string',
          description: 'Directory to search in (default: home directory)',
        },
        type: {
          type: 'string',
          enum: ['filename', 'content'],
          description: 'Search type: filename (search by name) or content (search within files). Default: filename',
        },
        extension: {
          type: 'string',
          description: 'File extension filter, e.g. "txt", "py", "js" (optional)',
        },
      },
      required: ['query'],
    },
  };

  async execute(args: Record<string, any>): Promise<ToolResult> {
    const { query, path: searchPath = os.homedir(), type = 'filename', extension } = args;
    const isWindows = process.platform === 'win32';

    let command: string;
    if (type === 'content') {
      if (isWindows) {
        const ext = extension ? `*.${extension}` : '*.*';
        command = `findstr /s /i /n "${query}" "${searchPath}\\${ext}" | head -50`;
      } else {
        const extFilter = extension ? `--include="*.${extension}"` : '';
        command = `grep -rn ${extFilter} "${query}" "${searchPath}" 2>/dev/null | head -50`;
      }
    } else {
      if (isWindows) {
        const ext = extension ? `*.${extension}` : `*${query}*`;
        command = `dir /s /b "${searchPath}\\${ext}" 2>nul | findstr /i "${query}" | head -50`;
      } else {
        const namePattern = extension ? `-name "*.${extension}" -path "*${query}*"` : `-iname "*${query}*"`;
        command = `find "${searchPath}" ${namePattern} -maxdepth 5 2>/dev/null | head -50`;
      }
    }

    return new ShellTool().execute({ command, timeout: 15000 });
  }
}

// ─── Environment Variables ───────────────────────────────────────

export class EnvTool implements Tool {
  name = 'env';
  description = 'Get or set environment variables';
  definition: ToolDefinition = {
    name: 'env',
    description: 'List, get, or set environment variables in the current process.',
    input_schema: {
      type: 'object',
      properties: {
        action: {
          type: 'string',
          enum: ['list', 'get', 'set'],
          description: 'Action: list all, get one, or set one',
        },
        name: {
          type: 'string',
          description: 'Variable name (required for get/set)',
        },
        value: {
          type: 'string',
          description: 'Variable value (required for set)',
        },
      },
      required: ['action'],
    },
  };

  async execute(args: Record<string, any>): Promise<ToolResult> {
    const { action, name, value } = args;

    if (action === 'list') {
      const envVars = Object.entries(process.env)
        .filter(([k]) => !k.includes('KEY') && !k.includes('SECRET') && !k.includes('TOKEN') && !k.includes('PASSWORD'))
        .map(([k, v]) => `${k}=${v}`)
        .sort()
        .join('\n');
      return { success: true, output: envVars };
    } else if (action === 'get') {
      if (!name) return { success: false, output: '', error: 'Variable name is required' };
      const val = process.env[name];
      return { success: true, output: val !== undefined ? `${name}=${val}` : `${name} is not set` };
    } else if (action === 'set') {
      if (!name || value === undefined) return { success: false, output: '', error: 'Name and value are required' };
      process.env[name] = value;
      return { success: true, output: `Set ${name}=${value}` };
    }

    return { success: false, output: '', error: 'Invalid action' };
  }
}

// ─── Screenshot ──────────────────────────────────────────────────

export class ScreenshotTool implements Tool {
  name = 'screenshot';
  description = 'Take a screenshot of the desktop';
  definition: ToolDefinition = {
    name: 'screenshot',
    description: 'Capture a screenshot of the desktop and send it. The image will be sent as a photo in the chat.',
    input_schema: {
      type: 'object',
      properties: {},
    },
  };

  async execute(_args: Record<string, any>): Promise<ToolResult> {
    const platform = process.platform;
    const tmpDir = os.tmpdir();
    const fileName = `screenshot_${Date.now()}.png`;
    const filePath = path.join(tmpDir, fileName);

    if (platform === 'win32') {
      // Write a temp .ps1 script with try-catch for error reporting
      const psScript = [
        'try {',
        '  Add-Type -AssemblyName System.Windows.Forms',
        '  Add-Type -AssemblyName System.Drawing',
        '  $bounds = [System.Windows.Forms.Screen]::PrimaryScreen.Bounds',
        '  $bitmap = [System.Drawing.Bitmap]::new($bounds.Width, $bounds.Height)',
        '  $graphics = [System.Drawing.Graphics]::FromImage($bitmap)',
        '  $graphics.CopyFromScreen($bounds.X, $bounds.Y, 0, 0, $bounds.Size)',
        `  $bitmap.Save('${filePath.replace(/\\/g, '\\\\')}', [System.Drawing.Imaging.ImageFormat]::Png)`,
        '  $graphics.Dispose()',
        '  $bitmap.Dispose()',
        '  Write-Output "OK"',
        '} catch {',
        '  Write-Error $_.Exception.Message',
        '  exit 1',
        '}',
      ].join('\r\n');

      const scriptPath = path.join(tmpDir, `screenshot_${Date.now()}.ps1`);
      fs.writeFileSync(scriptPath, psScript, 'utf-8');

      try {
        // Spawn powershell directly, bypassing cmd.exe
        const result = await new Promise<ToolResult>((resolve) => {
          const child = spawn('powershell.exe', [
            '-ExecutionPolicy', 'Bypass',
            '-NoProfile',
            '-NonInteractive',
            '-File', scriptPath,
          ], {
            cwd: tmpDir,
            env: { ...process.env },
            timeout: 15000,
          });

          let stdout = '';
          let stderr = '';

          child.stdout?.on('data', (data) => { stdout += data.toString(); });
          child.stderr?.on('data', (data) => { stderr += data.toString(); });

          child.on('close', (code) => {
            resolve({
              success: code === 0,
              output: stdout.trim(),
              error: code !== 0 ? (stderr.trim() || stdout.trim() || `Exit code: ${code}`) : undefined,
            });
          });

          child.on('error', (err) => {
            resolve({ success: false, output: '', error: err.message });
          });
        });

        // Clean up script
        try { fs.unlinkSync(scriptPath); } catch {}

        if (!fs.existsSync(filePath)) {
          return {
            success: false,
            output: result.output || '',
            error: `Screenshot failed: ${result.error || 'file not created'}`,
          };
        }
      } catch (err: any) {
        try { fs.unlinkSync(scriptPath); } catch {}
        return { success: false, output: '', error: `Screenshot failed: ${err.message}` };
      }
    } else {
      let command: string;
      if (platform === 'darwin') {
        command = `screencapture -x "${filePath}"`;
      } else {
        command = `gnome-screenshot -f "${filePath}" 2>/dev/null || scrot "${filePath}" 2>/dev/null || import -window root "${filePath}"`;
      }

      const shellResult = await new ShellTool().execute({ command, timeout: 10000 });

      if (!fs.existsSync(filePath)) {
        return {
          success: false,
          output: '',
          error: `Screenshot failed: ${shellResult.error || shellResult.output || 'file not created'}`,
        };
      }
    }

    const stat = fs.statSync(filePath);
    return {
      success: true,
      output: `Screenshot saved (${formatSize(stat.size)})`,
      filePath,
      metadata: { filePath, size: stat.size },
    };
  }
}

// ─── Web Browse ──────────────────────────────────────────────────

function findBrowserExecutable(): string | null {
  const platform = process.platform;

  if (platform === 'win32') {
    const candidates = [
      path.join(process.env['PROGRAMFILES(X86)'] || 'C:\\Program Files (x86)', 'Microsoft', 'Edge', 'Application', 'msedge.exe'),
      path.join(process.env['PROGRAMFILES'] || 'C:\\Program Files', 'Microsoft', 'Edge', 'Application', 'msedge.exe'),
      path.join(process.env['PROGRAMFILES'] || 'C:\\Program Files', 'Google', 'Chrome', 'Application', 'chrome.exe'),
      path.join(process.env['PROGRAMFILES(X86)'] || 'C:\\Program Files (x86)', 'Google', 'Chrome', 'Application', 'chrome.exe'),
      path.join(process.env['LOCALAPPDATA'] || '', 'Microsoft', 'Edge', 'Application', 'msedge.exe'),
      path.join(process.env['LOCALAPPDATA'] || '', 'Google', 'Chrome', 'Application', 'chrome.exe'),
    ];
    for (const p of candidates) {
      if (p && fs.existsSync(p)) return p;
    }
  } else if (platform === 'darwin') {
    const candidates = [
      '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
      '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    ];
    for (const p of candidates) {
      if (fs.existsSync(p)) return p;
    }
  } else {
    const names = ['microsoft-edge-stable', 'google-chrome-stable', 'google-chrome', 'chromium-browser'];
    for (const name of names) {
      try {
        const result = execSync(`which ${name}`, { encoding: 'utf-8' }).trim();
        if (result) return result;
      } catch { /* not found */ }
    }
    const linuxPaths = ['/usr/bin/microsoft-edge', '/usr/bin/google-chrome', '/usr/bin/chromium-browser'];
    for (const p of linuxPaths) {
      if (fs.existsSync(p)) return p;
    }
  }

  return null;
}

export class WebBrowseTool implements Tool {
  name = 'web_browse';
  description = 'Open a URL in a headless browser and extract the page text content';
  definition: ToolDefinition = {
    name: 'web_browse',
    description: 'Open a URL in a headless browser (Edge/Chrome) and extract the readable text content of the page. Use this to read web pages, articles, documentation, search results, etc.',
    input_schema: {
      type: 'object',
      properties: {
        url: {
          type: 'string',
          description: 'The URL to navigate to (must start with http:// or https://)',
        },
        selector: {
          type: 'string',
          description: 'Optional CSS selector to extract content from a specific element (e.g., "article", "main", ".content")',
        },
        waitFor: {
          type: 'number',
          description: 'Additional milliseconds to wait after page load for dynamic content (default: 0, max: 5000)',
        },
      },
      required: ['url'],
    },
  };

  async execute(args: Record<string, any>): Promise<ToolResult> {
    const { url, selector, waitFor = 0 } = args;

    if (!url) {
      return { success: false, output: '', error: 'URL is required' };
    }
    if (!url.startsWith('http://') && !url.startsWith('https://')) {
      return { success: false, output: '', error: 'URL must start with http:// or https://' };
    }

    const executablePath = findBrowserExecutable();
    if (!executablePath) {
      return { success: false, output: '', error: 'No Chrome or Edge browser found. Please install Microsoft Edge or Google Chrome.' };
    }

    let browser: any;
    try {
      const puppeteer = await import('puppeteer-core');
      browser = await puppeteer.default.launch({
        executablePath,
        headless: true,
        args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage', '--disable-gpu', '--disable-extensions'],
      });

      const page = await browser.newPage();
      await page.setViewport({ width: 1280, height: 800 });
      await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');

      await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 20000 });

      const extraWait = Math.min(Math.max(Number(waitFor) || 0, 0), 5000);
      if (extraWait > 0) {
        await new Promise(resolve => setTimeout(resolve, extraWait));
      }

      const pageTitle = await page.title();

      const selectorJson = selector ? JSON.stringify(selector) : 'null';
      const textContent: string = await page.evaluate(`
        (() => {
          const removeSelectors = ['script', 'style', 'noscript', 'svg'];
          for (const rs of removeSelectors) {
            document.querySelectorAll(rs).forEach(el => el.remove());
          }
          const sel = ${selectorJson};
          let target;
          if (sel) {
            target = document.querySelector(sel);
            if (!target) {
              return '[Selector "' + sel + '" not found]\\n\\n' + (document.body?.innerText || '');
            }
          } else {
            target = document.querySelector('article') ||
                     document.querySelector('main') ||
                     document.querySelector('[role="main"]') ||
                     document.body;
          }
          return target?.innerText || '';
        })()
      `) as string;

      const finalUrl = page.url();

      const MAX_LEN = 8000;
      let output = textContent.trim().replace(/\n{3,}/g, '\n\n');
      let truncated = false;
      if (output.length > MAX_LEN) {
        output = output.slice(0, MAX_LEN);
        const cutPoint = Math.max(output.lastIndexOf('.'), output.lastIndexOf('\n'));
        if (cutPoint > MAX_LEN * 0.8) {
          output = output.slice(0, cutPoint + 1);
        }
        truncated = true;
      }

      const header = `Title: ${pageTitle}\nURL: ${finalUrl}\n${truncated ? '(Content truncated)\n' : ''}---\n\n`;

      return {
        success: true,
        output: header + output,
        metadata: { title: pageTitle, url: finalUrl, contentLength: textContent.length, truncated },
      };
    } catch (err: any) {
      let errorMsg = err.message;
      if (errorMsg.includes('net::ERR_NAME_NOT_RESOLVED')) {
        errorMsg = `Could not resolve hostname: ${url}`;
      } else if (errorMsg.includes('net::ERR_CONNECTION_REFUSED')) {
        errorMsg = `Connection refused: ${url}`;
      } else if (errorMsg.includes('Timeout') || errorMsg.includes('timeout')) {
        errorMsg = `Page load timed out: ${url}`;
      }
      return { success: false, output: '', error: `Browse failed: ${errorMsg}` };
    } finally {
      if (browser) {
        try { await browser.close(); } catch { /* ignore */ }
      }
    }
  }
}

// ─── Memory Directory ────────────────────────────────────────────

const MEMORY_DIR = path.join(process.env.HOME || process.env.USERPROFILE || '.', '.copy-clawd', 'memory');

function ensureMemoryDir(): void {
  if (!fs.existsSync(MEMORY_DIR)) {
    fs.mkdirSync(MEMORY_DIR, { recursive: true });
  }
}

// ─── Memory Save ─────────────────────────────────────────────────

export class MemorySaveTool implements Tool {
  name = 'memory_save';
  description = 'Save important information to long-term memory';
  definition: ToolDefinition = {
    name: 'memory_save',
    description: 'Save important information to long-term memory as a markdown file. Use this to remember user preferences, facts, project context, or anything worth recalling later.',
    input_schema: {
      type: 'object',
      properties: {
        content: {
          type: 'string',
          description: 'The content to save (markdown format)',
        },
        category: {
          type: 'string',
          description: 'Category for organizing memories: "user", "project", "facts", "preferences", "notes". Default: "notes"',
        },
        title: {
          type: 'string',
          description: 'A short title for this memory entry',
        },
      },
      required: ['content'],
    },
  };

  async execute(args: Record<string, any>): Promise<ToolResult> {
    const { content, category = 'notes', title } = args;
    if (!content) {
      return { success: false, output: '', error: 'content is required' };
    }

    ensureMemoryDir();

    const categoryDir = path.join(MEMORY_DIR, category);
    if (!fs.existsSync(categoryDir)) {
      fs.mkdirSync(categoryDir, { recursive: true });
    }

    const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    const safeName = title
      ? title.replace(/[^a-zA-Z0-9\u4e00-\u9fff_-]/g, '_').slice(0, 50)
      : timestamp;
    const fileName = `${safeName}.md`;
    const filePath = path.join(categoryDir, fileName);

    const header = `# ${title || 'Memory Note'}\n\n_Saved: ${new Date().toLocaleString()}_\n\n---\n\n`;
    fs.writeFileSync(filePath, header + content + '\n', 'utf-8');

    return {
      success: true,
      output: `Memory saved to ${category}/${fileName}`,
    };
  }
}

// ─── Memory Search ───────────────────────────────────────────────

export class MemorySearchTool implements Tool {
  name = 'memory_search';
  description = 'Search through long-term memory for relevant information';
  definition: ToolDefinition = {
    name: 'memory_search',
    description: 'Search through saved memories using keywords. Returns matching memory entries ranked by relevance.',
    input_schema: {
      type: 'object',
      properties: {
        query: {
          type: 'string',
          description: 'Search keywords or phrase to look for in memories',
        },
        category: {
          type: 'string',
          description: 'Limit search to a specific category (optional). Categories: "user", "project", "facts", "preferences", "notes"',
        },
        maxResults: {
          type: 'number',
          description: 'Maximum number of results to return (default: 5)',
        },
      },
      required: ['query'],
    },
  };

  async execute(args: Record<string, any>): Promise<ToolResult> {
    const { query, category, maxResults = 5 } = args;
    if (!query) {
      return { success: false, output: '', error: 'query is required' };
    }

    ensureMemoryDir();

    const searchDir = category ? path.join(MEMORY_DIR, category) : MEMORY_DIR;
    if (!fs.existsSync(searchDir)) {
      return { success: true, output: 'No memories found.' };
    }

    // Collect all .md files recursively
    const files = this.findMarkdownFiles(searchDir);
    if (files.length === 0) {
      return { success: true, output: 'No memories found.' };
    }

    // Search through files using keyword matching
    const keywords = query.toLowerCase().split(/\s+/).filter(Boolean);
    const results: { file: string; score: number; snippet: string; mtime: number }[] = [];

    for (const file of files) {
      try {
        const content = fs.readFileSync(file, 'utf-8');
        const lowerContent = content.toLowerCase();

        // Score based on keyword matches
        let score = 0;
        for (const kw of keywords) {
          const matches = lowerContent.split(kw).length - 1;
          score += matches;
        }

        if (score > 0) {
          // Extract a relevant snippet (first matching line area)
          const lines = content.split('\n');
          let snippetLines: string[] = [];
          for (let i = 0; i < lines.length; i++) {
            const lower = lines[i].toLowerCase();
            if (keywords.some((kw: string) => lower.includes(kw))) {
              const start = Math.max(0, i - 1);
              const end = Math.min(lines.length, i + 3);
              snippetLines = lines.slice(start, end);
              break;
            }
          }

          const relativePath = path.relative(MEMORY_DIR, file).replace(/\\/g, '/');
          const stat = fs.statSync(file);
          results.push({
            file: relativePath,
            score,
            snippet: snippetLines.join('\n').slice(0, 300),
            mtime: stat.mtimeMs,
          });
        }
      } catch { /* skip unreadable files */ }
    }

    // Sort by score desc, then by recency
    results.sort((a, b) => b.score - a.score || b.mtime - a.mtime);
    const top = results.slice(0, maxResults);

    if (top.length === 0) {
      return { success: true, output: `No memories matching "${query}" found.` };
    }

    const output = top.map((r, i) =>
      `[${i + 1}] ${r.file} (score: ${r.score})\n${r.snippet}`
    ).join('\n\n---\n\n');

    return {
      success: true,
      output: `Found ${top.length} matching memories:\n\n${output}`,
    };
  }

  private findMarkdownFiles(dir: string): string[] {
    const results: string[] = [];
    try {
      const entries = fs.readdirSync(dir, { withFileTypes: true });
      for (const entry of entries) {
        const fullPath = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          results.push(...this.findMarkdownFiles(fullPath));
        } else if (entry.name.endsWith('.md')) {
          results.push(fullPath);
        }
      }
    } catch { /* skip unreadable dirs */ }
    return results;
  }
}

// ─── Memory Get ──────────────────────────────────────────────────

export class MemoryGetTool implements Tool {
  name = 'memory_get';
  description = 'Read a specific memory file by path';
  definition: ToolDefinition = {
    name: 'memory_get',
    description: 'Read the full content of a specific memory file. Use the path from memory_search results.',
    input_schema: {
      type: 'object',
      properties: {
        path: {
          type: 'string',
          description: 'Relative path within the memory directory (e.g., "notes/my-note.md")',
        },
      },
      required: ['path'],
    },
  };

  async execute(args: Record<string, any>): Promise<ToolResult> {
    const { path: relPath } = args;
    if (!relPath) {
      return { success: false, output: '', error: 'path is required' };
    }

    ensureMemoryDir();
    const fullPath = path.join(MEMORY_DIR, relPath);

    // Security check - prevent path traversal
    if (!fullPath.startsWith(MEMORY_DIR)) {
      return { success: false, output: '', error: 'Invalid path' };
    }

    if (!fs.existsSync(fullPath)) {
      return { success: false, output: '', error: `Memory file not found: ${relPath}` };
    }

    try {
      const content = fs.readFileSync(fullPath, 'utf-8');
      return { success: true, output: content };
    } catch (err: any) {
      return { success: false, output: '', error: err.message };
    }
  }
}

// ─── Memory List ─────────────────────────────────────────────────

export class MemoryListTool implements Tool {
  name = 'memory_list';
  description = 'List all saved memory files';
  definition: ToolDefinition = {
    name: 'memory_list',
    description: 'List all saved memory files, optionally filtered by category.',
    input_schema: {
      type: 'object',
      properties: {
        category: {
          type: 'string',
          description: 'Filter by category (optional). Categories: "user", "project", "facts", "preferences", "notes"',
        },
      },
    },
  };

  async execute(args: Record<string, any>): Promise<ToolResult> {
    const { category } = args;

    ensureMemoryDir();
    const searchDir = category ? path.join(MEMORY_DIR, category) : MEMORY_DIR;

    if (!fs.existsSync(searchDir)) {
      return { success: true, output: 'No memories saved yet.' };
    }

    const files = this.findMarkdownFiles(searchDir);
    if (files.length === 0) {
      return { success: true, output: 'No memories saved yet.' };
    }

    // Sort by modification time (newest first)
    const fileInfos = files.map(f => {
      const stat = fs.statSync(f);
      const rel = path.relative(MEMORY_DIR, f).replace(/\\/g, '/');
      return { path: rel, mtime: stat.mtimeMs, size: stat.size };
    }).sort((a, b) => b.mtime - a.mtime);

    const output = fileInfos.map(f =>
      `  ${f.path} (${formatSize(f.size)}, ${new Date(f.mtime).toLocaleDateString()})`
    ).join('\n');

    return {
      success: true,
      output: `Saved memories (${fileInfos.length} files):\n${output}`,
    };
  }

  private findMarkdownFiles(dir: string): string[] {
    const results: string[] = [];
    try {
      const entries = fs.readdirSync(dir, { withFileTypes: true });
      for (const entry of entries) {
        const fullPath = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          results.push(...this.findMarkdownFiles(fullPath));
        } else if (entry.name.endsWith('.md')) {
          results.push(fullPath);
        }
      }
    } catch { /* skip */ }
    return results;
  }
}

// ─── Helpers ─────────────────────────────────────────────────────

function formatSize(bytes: number): string {
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let i = 0;
  let size = bytes;
  while (size >= 1024 && i < units.length - 1) {
    size /= 1024;
    i++;
  }
  return `${size.toFixed(i === 0 ? 0 : 1)}${units[i]}`;
}

function formatDuration(seconds: number): string {
  const days = Math.floor(seconds / 86400);
  const hours = Math.floor((seconds % 86400) / 3600);
  const mins = Math.floor((seconds % 3600) / 60);
  const parts = [];
  if (days > 0) parts.push(`${days}d`);
  if (hours > 0) parts.push(`${hours}h`);
  parts.push(`${mins}m`);
  return parts.join(' ');
}

// ─── Tool Manager ────────────────────────────────────────────────

export class ToolManager {
  private tools: Map<string, Tool> = new Map();

  constructor() {
    this.registerDefaultTools();
  }

  private registerDefaultTools() {
    const tools: Tool[] = [
      new ShellTool(),
      new ReadFileTool(),
      new WriteFileTool(),
      new ListDirTool(),
      new SystemInfoTool(),
      new ProcessListTool(),
      new ProcessKillTool(),
      new NetworkInfoTool(),
      new OpenTool(),
      new ClipboardTool(),
      new DiskUsageTool(),
      new SearchFilesTool(),
      new EnvTool(),
      new ScreenshotTool(),
      new WebBrowseTool(),
      new MemorySaveTool(),
      new MemorySearchTool(),
      new MemoryGetTool(),
      new MemoryListTool(),
    ];

    for (const tool of tools) {
      this.register(tool);
    }
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

  /** Get tool definitions for Anthropic API */
  getToolDefinitions(): ToolDefinition[] {
    return Array.from(this.tools.values()).map(t => t.definition);
  }

  async execute(name: string, args: Record<string, any>): Promise<ToolResult> {
    const tool = this.tools.get(name);
    if (!tool) {
      return { success: false, output: '', error: `Tool not found: ${name}` };
    }

    try {
      console.log(`[Tool] Executing ${name}:`, JSON.stringify(args).slice(0, 200));
      const result = await tool.execute(args);
      console.log(`[Tool] ${name} result: ${result.success ? 'success' : 'error'}${result.error ? ' - ' + result.error : ''}`);
      return result;
    } catch (err: any) {
      return { success: false, output: '', error: err.message };
    }
  }
}

export const toolManager = new ToolManager();
