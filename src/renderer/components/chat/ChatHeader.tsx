import { useEffect, useRef, useState } from 'react';
import { Plug } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { mcpClient } from '../../features/mcp/api/mcp-client';

interface ChatHeaderProps {
  title: string;
  isElectron: boolean;
}

export function ChatHeader({ title, isElectron }: ChatHeaderProps) {
  const { t } = useTranslation();
  const [activeConnectors, setActiveConnectors] = useState<
    { id: string; name: string; connected: boolean; toolCount: number }[]
  >([]);
  const [showConnectorLabel, setShowConnectorLabel] = useState(true);
  const headerRef = useRef<HTMLDivElement>(null);
  const titleRef = useRef<HTMLHeadingElement>(null);
  const connectorMeasureRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!isElectron || !mcpClient.isAvailable()) return;
    const loadConnectors = async () => {
      try {
        const statuses = await mcpClient.getServerStatus();
        const active =
          (
            statuses as Array<{ id: string; name: string; connected: boolean; toolCount: number }>
          )?.filter((s) => s.connected && s.toolCount > 0) || [];
        setActiveConnectors(active);
      } catch (err) {
        console.error('Failed to load MCP connectors:', err);
      }
    };
    void loadConnectors();
    const interval = setInterval(() => void loadConnectors(), 5000);
    return () => clearInterval(interval);
  }, [isElectron]);

  useEffect(() => {
    const titleEl = titleRef.current;
    const headerEl = headerRef.current;
    const measureEl = connectorMeasureRef.current;
    if (!titleEl || !headerEl || !measureEl) {
      setShowConnectorLabel(true);
      return;
    }
    const updateLabelVisibility = () => {
      const isTruncated = titleEl.scrollWidth > titleEl.clientWidth;
      const headerStyle = window.getComputedStyle(headerEl);
      const paddingLeft = Number.parseFloat(headerStyle.paddingLeft) || 0;
      const paddingRight = Number.parseFloat(headerStyle.paddingRight) || 0;
      const contentWidth = headerEl.clientWidth - paddingLeft - paddingRight;
      const titleWidth = titleEl.getBoundingClientRect().width;
      const rightColumnWidth = Math.max(0, (contentWidth - titleWidth) / 2);
      const connectorFullWidth = measureEl.getBoundingClientRect().width;
      setShowConnectorLabel(!isTruncated && rightColumnWidth >= connectorFullWidth);
    };
    updateLabelVisibility();
    const observer = new ResizeObserver(updateLabelVisibility);
    observer.observe(titleEl);
    observer.observe(headerEl);
    return () => observer.disconnect();
  }, [title, activeConnectors.length]);

  return (
    <div
      ref={headerRef}
      className="glass-panel-header titlebar-drag relative grid h-12 grid-cols-[1fr_auto_1fr] items-center px-4 lg:px-8"
    >
      <div aria-hidden="true" />
      <h2
        ref={titleRef}
        className="text-[15px] font-medium text-text-primary text-center truncate max-w-[40vw] lg:max-w-[32rem]"
      >
        {title}
      </h2>
      {activeConnectors.length > 0 && (
        <>
          <div
            ref={connectorMeasureRef}
            aria-hidden="true"
            className="absolute left-0 top-0 -z-10 opacity-0 pointer-events-none"
          >
            <div className="flex items-center gap-2 px-2.5 py-1 rounded-full">
              <Plug className="w-3.5 h-3.5" />
              <span className="text-xs font-medium whitespace-nowrap">
                {t('chat.connectorCount', { count: activeConnectors.length })}
              </span>
            </div>
          </div>
          <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-mcp/10 justify-self-end">
            <Plug className="w-3.5 h-3.5 text-mcp" />
            <span className="text-xs text-mcp font-medium">
              {showConnectorLabel
                ? t('chat.connectorCount', { count: activeConnectors.length })
                : activeConnectors.length}
            </span>
          </div>
        </>
      )}
    </div>
  );
}
