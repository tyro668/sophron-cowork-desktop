import dingtalkIcon from '../../assets/dingtalk.png';
import feishuIcon from '../../assets/feishu.png';
import wecomIcon from '../../assets/wecom.png';
import type { RemoteChannelType } from './types';

interface Props {
  type: RemoteChannelType;
  className?: string;
}

const channelIcon: Record<RemoteChannelType, string> = {
  feishu: feishuIcon,
  dingtalk: dingtalkIcon,
  wecom: wecomIcon,
};

export function ChannelBrandIcon({ type, className = 'h-10 w-10' }: Props) {
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
