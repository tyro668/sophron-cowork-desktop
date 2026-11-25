# local-agent：本地宝云端通道（WebSocket + OSS 分片上传）

从 `hihidata-agent`（本地宝，Java，`feature/3.0` @ `1ac07abd`）迁移过来的云端连接和文件上传实现。
只包含"连云 + 把数据传到 OSS + 状态回报"，**不含** JDBC/Excel 等取数逻辑（通过 `TableContentProvider` 注入）。

模块不直接依赖 Electron，可在主进程、单测和命令行里运行；主进程里用 `createAppLocalAgentLogger()` 接入应用日志。
当前**没有**接入 `bootstrap.ts` / IPC，需要时由宿主按需创建 `LocalAgent`。

## 用法

```ts
import { LocalAgent } from './local-agent';
import { createAppLocalAgentLogger } from './local-agent/app-logger';

const agent = await LocalAgent.fromConfigFile('/path/to/config.yaml', {
  version: '3.0.0', // 本地宝产品版本号，握手 query.version
  logger: createAppLocalAgentLogger(),
});
agent.registerTableContentProvider('mysql-1', async ({ stream, source }) => {
  // 往 stream 里写编码好的数据（Sync 端期望每片是一个 LZ4 Frame 的 CSV，见下文）
  await stream.write(bytes);
});
agent.on('offline', () => {
  /* 被云端踢下线：提示用户，不退出进程 */
});
agent.start();

// 本地文件直接分片上传到云端分配的路径
await agent.uploadFile('/data/a.csv', {
  sourceName,
  tableName,
  path,
  uploadId,
  groupId,
  messageId,
  type: 0,
});
```

## Java → TypeScript 对照

| Java（hihidata-agent）                                                                  | TypeScript（本目录）                                                                  | 说明                                                                                                       |
| --------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| `ProjectConstants.Ws`、`ReceiveEvent`、`SendEvent`、`HTTPEvent`、`AgentEnv.s3BatchSize` | `constants.ts`                                                                        | 事件名、webhook 路径、默认值一一对应                                                                       |
| `AgentConfig` / `ServerConfig` / `SocketIoConfig`、`VerifyUtil`                         | `config.ts`                                                                           | yaml 的 `socket.io` 段；`LOCAL_AGENT_TOKEN` 等价于 `-Dtoken`                                               |
| `WebSocketVerticle.concatOptions()`                                                     | `config.ts#buildSocketOptions`                                                        | query 传 token/agentId/version/apiLevel/instanceId；只走 websocket；`reconnectionAttempts: 0` → `Infinity` |
| `WebSocketVerticle`、`EventFactory.initFlowEvent()`、`AgentContext`                     | `connection.ts`                                                                       | connect / connectSuccess / connectErrorMessage / offline / 重连 / 存活日志                                 |
| `RemoteEnvs`、`RemoteEnvBean`、`EventFactory.update()`                                  | `remote-env.ts`                                                                       | 保留服务端拼写 `rowcountTimout` / `contentTimout`                                                          |
| `EventFactory.initReceiveEvent()`、`BaseSocketHandler`                                  | `transport/event-dispatcher.ts`                                                       | 参数 `[payload, messageId, trace?]`，剥离 ack 回调                                                         |
| `SocketMessageSender`、`MessageQueueEmitter`                                            | `transport/socket-sender.ts`                                                          | 容量 16 的串行 ack 队列；二进制加 0x04 前缀                                                                |
| `HttpMessageSender`                                                                     | `transport/http-sender.ts`                                                            | `baseUrl + eventType` POST JSON；重置时重试一次                                                            |
| `MessageSender`、`MessageSenderFactory`、`MessageEncoder`、`Message.ofError`            | `transport/agent-socket.ts`、`local-agent.ts`                                         | 工厂改为 `LocalAgent` 组合                                                                                 |
| `S3HttpUtils`（webhook + PUT + 重试 + 内网探测）                                        | `s3/s3-http-client.ts`、`s3/retry.ts`、`s3/internal-network-state.ts`、`s3/errors.ts` | 3 次重试、`min(30ms·2^n, 60s)+rand(500ms)`；`SyncBizException` 不重试                                      |
| `FileUploadTask`                                                                        | `s3/file-upload-task.ts`                                                              | 10000 片换文件、ETag 汇总合并                                                                              |
| `S3MessageSender.sendSync()`、`S3DataSyncStream`、`S3UploadBuffer`                      | `s3/s3-upload-stream.ts`                                                              | 按 10MB 阈值切片；CSV 编码；压缩通过 `compressBatch` 注入                                                  |
| —（新增）                                                                               | `s3/upload-file.ts`                                                                   | 本地文件分片上传                                                                                           |
| `S3SyncTask`、`AgentSyncStatusEnum`、`SyncStatusRequest`                                | `sync/sync-task.ts`、`types.ts`                                                       | START_SYNC → UPLOAD_SUCCESS / UPLOAD_FAILED                                                                |
| `SyncTaskDispatcher`、`SyncTaskExecutor`、`SyncTableInfo`、`SyncHeartbeatRequest`       | `sync/sync-dispatcher.ts`                                                             | 按数据源并发上限 + 心跳                                                                                    |
| `TableContentS3DispatchHandler`、`S3SourceData.create(FetchBean)`                       | `handlers/table-content-s3-dispatch.ts`                                               | 取数由 `TableContentProvider` 注入                                                                         |

## 测试

- 单测：`npx vitest run tests/local-agent`（假 Socket.IO 服务端 + 假 Sync/OSS HTTP 服务）
- 真实连接冒烟：`npm run smoke:local-agent -- <config.yaml> [秒数≤30]`（不注册任务处理器、不回 ack、输出打码）
