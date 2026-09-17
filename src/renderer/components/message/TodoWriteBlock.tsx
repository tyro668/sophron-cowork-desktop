// TodoWrite tool block — flat header row, expands to an indented task list
import { useState, memo } from 'react';
import { useTranslation } from 'react-i18next';
import { ChevronRight, ListTodo, Loader2, XCircle, Square, CheckSquare } from 'lucide-react';
import type { ToolUseContent } from '../../types';
import type { TodoItem } from './types';

interface TodoWriteBlockProps {
  block: ToolUseContent;
}

export const TodoWriteBlock = memo(function TodoWriteBlock({ block }: TodoWriteBlockProps) {
  const { t } = useTranslation();
  const [expanded, setExpanded] = useState(true);
  const todos: TodoItem[] = ((block.input as Record<string, unknown>)?.todos as TodoItem[]) || [];

  const completedCount = todos.filter((item) => item.status === 'completed').length;
  const totalCount = todos.length;
  const progress = totalCount > 0 ? (completedCount / totalCount) * 100 : 0;
  const inProgressItem = todos.find((item) => item.status === 'in_progress');

  const getStatusIcon = (status: string) => {
    switch (status) {
      case 'completed':
        return <CheckSquare className="w-3.5 h-3.5 text-success" />;
      case 'in_progress':
        return <Loader2 className="w-3.5 h-3.5 text-accent animate-spin" />;
      case 'cancelled':
        return <XCircle className="w-3.5 h-3.5 text-text-muted" />;
      default: // pending
        return <Square className="w-3.5 h-3.5 text-text-muted" />;
    }
  };

  const getStatusStyle = (status: string) => {
    switch (status) {
      case 'completed':
        return 'text-text-muted line-through';
      case 'in_progress':
        return 'text-accent font-medium';
      case 'cancelled':
        return 'text-text-muted line-through opacity-60';
      default:
        return 'text-text-primary';
    }
  };

  if (todos.length === 0) {
    return null;
  }

  return (
    <div className="-mx-2">
      {/* Flat header row */}
      <button
        onClick={() => setExpanded(!expanded)}
        className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left transition-colors hover:bg-surface-hover/60"
      >
        <span className="flex h-4 w-4 flex-shrink-0 items-center justify-center text-accent">
          <ListTodo className="h-3.5 w-3.5" />
        </span>
        <span className="flex-shrink-0 text-[12px] font-medium text-text-secondary">
          {t('messageCard.taskProgress')}
        </span>
        {inProgressItem && (
          <span className="min-w-0 flex-1 truncate text-[12px] text-text-muted">
            {inProgressItem.activeForm || inProgressItem.content}
          </span>
        )}
        <span className="ml-auto flex-shrink-0 text-[11px] tabular-nums text-text-muted">
          {completedCount}/{totalCount}
        </span>
        <ChevronRight
          className={`h-3.5 w-3.5 flex-shrink-0 text-text-muted transition-transform ${
            expanded ? 'rotate-90' : ''
          }`}
        />
      </button>

      {/* Todo list — indented under a thin left rail */}
      {expanded && (
        <div className="mb-1 ml-4 mt-0.5 animate-fade-in border-l border-border-subtle pb-1 pl-3">
          <div className="my-1.5 h-1 overflow-hidden rounded-full bg-surface-muted">
            <div
              className="h-full rounded-full bg-accent transition-all duration-500"
              style={{ width: `${progress}%` }}
            />
          </div>
          <div className="space-y-0.5 py-1">
            {todos.map((todo, index) => (
              <div
                key={todo.id || index}
                className={`flex items-start gap-2 rounded-md px-1.5 py-1 transition-colors ${
                  todo.status === 'in_progress' ? 'bg-accent-muted' : ''
                }`}
              >
                <div className="mt-0.5 flex-shrink-0">{getStatusIcon(todo.status)}</div>
                <span className={`text-[13px] leading-relaxed ${getStatusStyle(todo.status)}`}>
                  {todo.content}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
});
