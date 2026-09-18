# 远程控制扫码配置

在「设置 → 远程控制 → 渠道配置」点击渠道的「配置」，使用对应手机客户端扫码并确认。授权成功后，本地保存凭据并启用该渠道；远程控制总开关仍由用户控制。已有配置可通过「管理」调整。

| 渠道     | 扫码后连接方式 | 接入范围                             |
| -------- | -------------- | ------------------------------------ |
| 钉钉     | Stream         | 复用现有机器人消息收发               |
| 飞书     | WebSocket      | 复用现有机器人消息收发               |
| Lark     | WebSocket      | 独立配置，使用 Lark API 和连接域名   |
| 微信     | iLink 长轮询   | 私聊文本、服务端转写的语音；文本回复 |
| 企业微信 | WebSocket      | 复用现有智能机器人消息收发           |

飞书、Lark、钉钉和企业微信保留手动配置入口，扫码创建的机器人默认使用配对策略。微信绑定扫码用户，使用该用户的允许列表；暂不支持图片、文件和群聊。平台账号权限、客户端版本以及扫码确认步骤由各平台决定。

二维码在本地生成。设备授权码、应用密钥和微信令牌由主进程处理，扫码状态 IPC 只返回二维码图片、有效期和状态。关闭或刷新弹窗、页面跳转及窗口销毁会取消旧请求；授权后的保存阶段完成后再关闭。过期或失败可刷新重试，微信需要验证码时会显示输入框。

## 协议依据

- 飞书/Lark：已锁定的 `@larksuiteoapi/node-sdk@1.73.0` 的 `registerApp` 协议；独立实现可取消的 HTTP 请求及轮询，避免 SDK 在取消时留下请求。上游：[larksuite/node-sdk](https://github.com/larksuite/node-sdk)。
- 钉钉：[官方连接器 device-auth.ts](https://github.com/DingTalk-Real-AI/dingtalk-openclaw-connector/blob/main/src/device-auth.ts)。
- 微信：[Tencent/openclaw-weixin 协议](https://github.com/Tencent/openclaw-weixin/blob/main/docs/protocol.md)，当前兼容版本 `2.4.9`。
- 企业微信：[WecomTeam/wecom-cli 二维码认证](https://github.com/WecomTeam/wecom-cli/blob/main/crates/wecom-cli/src/auth/qrcode.rs)。

## 验证范围

自动化测试覆盖授权成功后保存、凭据隔离、刷新和取消竞态、过期、初始化超时、保存失败、Lark 域名切换、微信验证码、消息去重、回复上下文及令牌失效。协议测试使用模拟服务响应，不会创建真实平台机器人。

界面已检查中英文、浅色/深色、窄窗口，以及二维码弹窗和手动配置入口。发布前仍需使用各平台真实账号完成扫码授权与消息往返验证；开发期间未执行真实账号授权。
