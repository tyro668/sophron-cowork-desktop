import type { ServerEvent } from '../../shared/contracts';
import { remoteManager } from '../remote/remote-manager';
import { log, logError } from '../utils/logger';
import { appContext } from './context';

// 发送事件到渲染进程（含远程会话拦截）
export function sendToRenderer(event: ServerEvent) {
  const payload =
    'payload' in event
      ? (event.payload as { sessionId?: string; [key: string]: unknown })
      : undefined;
  const sessionId = payload?.sessionId;

  // 判断是否远程会话
  if (sessionId && remoteManager.isRemoteSession(sessionId)) {
    // 处理远程会话事件

    // 拦截 stream.message，用于回传到远程通道
    if (event.type === 'stream.message') {
      const message = payload.message as {
        id?: string;
        role?: string;
        content?: Array<{ type: string; text?: string }>;
      };
      if (message?.role === 'assistant' && message?.content) {
        // 提取助手文本内容
        const textContent = message.content
          .filter((c) => c.type === 'text' && c.text)
          .map((c) => c.text)
          .join('\n');

        if (textContent) {
          // 发送到远程通道（带缓冲）
          remoteManager
            .sendResponseToChannel(sessionId, textContent, false, message.id)
            .catch((err: Error) => {
              logError('[Remote] Failed to send response to channel:', err);
            });
        }
      }
    }

    // 拦截 trace.step 作为工具进度
    if (event.type === 'trace.step') {
      const step = payload.step as {
        type?: string;
        toolName?: string;
        status?: string;
        title?: string;
      };
      if (step?.type === 'tool_call' && step?.toolName) {
        remoteManager
          .sendToolProgress(
            sessionId,
            step.toolName,
            step.status === 'completed'
              ? 'completed'
              : step.status === 'error'
                ? 'error'
                : 'running'
          )
          .catch((err: Error) => {
            logError('[Remote] Failed to send tool progress:', err);
          });
      }
    }

    // trace.update 预留；当前主要用 trace.step

    // 拦截 session.status，仅清理本轮回复缓冲；idle/error 后会话仍可继续
    if (event.type === 'session.status') {
      const status = payload.status as string;
      if (status === 'idle' || status === 'error') {
        // 本轮结束，清空缓冲但保留远程会话映射
        remoteManager.clearSessionBuffer(sessionId).catch((err: Error) => {
          logError('[Remote] Failed to clear session buffer:', err);
        });
      }
    }

    // 拦截 permission.request
    if (event.type === 'permission.request' && payload.toolUseId && payload.toolName) {
      log('[Remote] Intercepting permission for remote session:', sessionId);
      remoteManager
        .handlePermissionRequest(
          sessionId,
          payload.toolUseId as string,
          payload.toolName as string,
          (payload.input as Record<string, unknown> | undefined) ?? {}
        )
        .then((result) => {
          if (result !== null && appContext.sessionManager) {
            let permissionResult: 'allow' | 'deny' | 'allow_always';
            if (result.allow) {
              permissionResult = result.remember ? 'allow_always' : 'allow';
            } else {
              permissionResult = 'deny';
            }
            appContext.sessionManager.handlePermissionResponse(
              payload.toolUseId as string,
              permissionResult
            );
          }
        })
        .catch((err) => {
          logError('[Remote] Failed to handle permission request:', err);
        });
      return; // 不发送到本地 UI
    }
  }

  // 发送到本地 UI
  if (appContext.mainWindow && !appContext.mainWindow.isDestroyed()) {
    appContext.mainWindow.webContents.send('server-event', event);
  }
}
