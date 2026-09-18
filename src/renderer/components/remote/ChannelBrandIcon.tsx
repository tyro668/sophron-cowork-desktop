import dingtalkIcon from '../../assets/dingtalk.png';
import { MessagesSquare } from 'lucide-react';
import feishuIcon from '../../assets/feishu.png';
import wecomIcon from '../../assets/wecom.png';
import type { RemoteChannelType } from './types';

interface Props {
  type: RemoteChannelType;
  className?: string;
}

const channelIcon: Record<RemoteChannelType, string> = {
  feishu: feishuIcon,
  lark: feishuIcon,
  wechat: '',
  dingtalk: dingtalkIcon,
  wecom: wecomIcon,
};

export function ChannelBrandIcon({ type, className = 'h-10 w-10' }: Props) {
  if (type === 'wechat')
    return <MessagesSquare aria-hidden="true" className={`${className} shrink-0 text-success`} />;
  return (
    <img
      src={channelIcon[type]}
      alt=""
      aria-hidden="true"
      draggable={false}
      className={`shrink-0 select-none object-contain ${className}`}
    />
  );
}
