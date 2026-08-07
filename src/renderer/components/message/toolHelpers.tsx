// Utility functions for tool use/result display
import {
  Terminal,
  FileCode,
  FileText,
  Pencil,
  Search,
  Globe,
  FolderSearch,
  Database,
  Table2,
  Workflow,
  Play,
} from 'lucide-react';

/** Map a tool name to a small icon element */
export function getToolIcon(name: string) {
  const n = name.toLowerCase();
  if (n === 'bash' || n === 'execute_command') return <Terminal className="w-3.5 h-3.5" />;
  if (n === 'read' || n === 'read_file') return <FileCode className="w-3.5 h-3.5" />;
  if (n === 'write' || n === 'write_file') return <FileText className="w-3.5 h-3.5" />;
  if (n === 'edit' || n === 'edit_file') return <Pencil className="w-3.5 h-3.5" />;
  if (n === 'grep') return <Search className="w-3.5 h-3.5" />;
  if (n === 'glob') return <FolderSearch className="w-3.5 h-3.5" />;
  if (n === 'websearch') return <Globe className="w-3.5 h-3.5" />;
  if (n === 'webfetch') return <Globe className="w-3.5 h-3.5" />;
  if (n.startsWith('data_run')) return <Play className="w-3.5 h-3.5" />;
  if (n.includes('workflow') || n.includes('operator') || n.includes('task')) {
    return <Workflow className="w-3.5 h-3.5" />;
  }
  if (n.includes('output_table')) return <Table2 className="w-3.5 h-3.5" />;
  if (n.startsWith('data_')) return <Database className="w-3.5 h-3.5" />;
  return <Terminal className="w-3.5 h-3.5" />;
}

/** Shorten a file path to just filename or last 2 segments */
export function shortenPath(p: string): string {
  if (typeof p !== 'string') return String(p);
  const segments = p.replace(/\\/g, '/').split('/').filter(Boolean);
  if (segments.length <= 2) return segments.join('/');
  return segments.slice(-2).join('/');
}

export function getMcpToolDisplayName(name: string, displayName?: string): string {
  if (typeof displayName === 'string' && displayName.trim().length > 0) {
    return displayName;
  }

  if (name.startsWith('mcp__')) {
    const match = name.match(/^mcp__(.+?)__(.+)$/);
    return match?.[2] || name;
  }

  return name;
}

/** Get compact label: tool action + key argument */
export function getToolLabel(
  name: string,
  input: Record<string, unknown>,
  displayName?: string
): string {
  const inp = input || {};
  // MCP tools
  if (name.startsWith('mcp__')) {
    return getMcpToolDisplayName(name, displayName);
  }

  const nameLower = name.toLowerCase();
  if (nameLower === 'read' || nameLower === 'read_file') {
    const p = String(inp.file_path || inp.path || '');
    return p ? `Read ${shortenPath(p)}` : 'Read file';
  }
  if (nameLower === 'write' || nameLower === 'write_file') {
    const p = String(inp.file_path || inp.path || '');
    return p ? `Write ${shortenPath(p)}` : 'Write file';
  }
  if (nameLower === 'edit' || nameLower === 'edit_file') {
    const p = String(inp.file_path || inp.path || '');
    return p ? `Edit ${shortenPath(p)}` : 'Edit file';
  }
  if (nameLower === 'bash' || nameLower === 'execute_command') {
    const cmd = String(inp.command || inp.cmd || '');
    if (cmd) {
      const short = cmd.length > 60 ? cmd.substring(0, 57) + '...' : cmd;
      return `$ ${short}`;
    }
    return 'Run command';
  }
  if (nameLower === 'glob') return inp.pattern ? `Glob ${String(inp.pattern)}` : 'Glob';
  if (nameLower === 'grep') return inp.pattern ? `Grep "${String(inp.pattern)}"` : 'Grep';
  if (nameLower === 'websearch') return inp.query ? `Search "${String(inp.query)}"` : 'Web search';
  if (nameLower === 'webfetch') {
    const url = String(inp.url || '');
    return url ? `Fetch ${url.length > 50 ? url.substring(0, 47) + '...' : url}` : 'Fetch URL';
  }
  if (nameLower.startsWith('data_')) {
    return getDataToolLabel(nameLower, inp);
  }
  return name;
}

function getDataToolLabel(name: string, input: Record<string, unknown>): string {
  const id = firstString(input, ['id', 'taskId', 'inputTableId', 'outputTableId']);
  const nameArg = firstString(input, ['name', 'taskName', 'outputTableName']);
  if (name === 'data_get_workflow_dsl_reference') return 'Get workflow DSL reference';
  if (name === 'data_list_input_tables') return 'List input tables';
  if (name === 'data_create_input_table')
    return `Create input table${nameArg ? ` ${nameArg}` : ''}`;
  if (name === 'data_update_input_table') return `Update input table${id ? ` ${id}` : ''}`;
  if (name === 'data_list_output_tables') return 'List output tables';
  if (name === 'data_create_output_table')
    return `Create output table${nameArg ? ` ${nameArg}` : ''}`;
  if (name === 'data_update_output_table') return `Update output table${id ? ` ${id}` : ''}`;
  if (name === 'data_preview_table')
    return `Preview ${String(input.tableKind || 'data')} table${id ? ` ${id}` : ''}`;
  if (name === 'data_list_tasks') return 'List data tasks';
  if (name === 'data_analyze_task_requirement') return 'Analyze data task requirement';
  if (name === 'data_generate_task_from_requirement') {
    return `Generate data task${nameArg ? ` ${nameArg}` : ''}`;
  }
  if (name === 'data_create_task') return `Create data task${nameArg ? ` ${nameArg}` : ''}`;
  if (name === 'data_update_task') return `Update data task${id ? ` ${id}` : ''}`;
  if (name === 'data_get_task_workflow') return `Get task workflow${id ? ` ${id}` : ''}`;
  if (name === 'data_apply_workflow_dsl') {
    return `${input.dryRun ? 'Validate' : 'Apply'} workflow DSL${id ? ` ${id}` : ''}`;
  }
  if (name === 'data_export_workflow_dsl') return `Export workflow DSL${id ? ` ${id}` : ''}`;
  if (name === 'data_configure_input_operator')
    return `Configure input operator${id ? ` ${id}` : ''}`;
  if (name === 'data_apply_operator_dsl') {
    return `${input.dryRun ? 'Validate' : 'Apply'} operator DSL${id ? ` ${id}` : ''}`;
  }
  if (name === 'data_configure_output_operator')
    return `Configure output operator${id ? ` ${id}` : ''}`;
  if (name === 'data_run_task') return `Run data task${id ? ` ${id}` : ''}`;
  if (name === 'data_get_run_result') return `Get run result${id ? ` ${id}` : ''}`;
  return name;
}

function firstString(input: Record<string, unknown>, keys: string[]): string {
  for (const key of keys) {
    const value = input[key];
    if (typeof value === 'string' && value.trim()) {
      return value.trim();
    }
  }
  return '';
}
