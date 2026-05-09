import { useState } from 'react';
import { Tabs } from 'antd';
import PageHeader from '../../components/PageHeader.js';
import PricingPane from './Pricing.js';
import PreferencesPane from './Preferences.js';
import MonitorPane from './Monitor.js';

type TabKey = 'preferences' | 'pricing' | 'monitor';

const SUBTITLE: Record<TabKey, string> = {
  preferences: '显示偏好与本地配置 · 仅影响当前浏览器',
  pricing:     '按每百万 token 设置美元单价 · 模型列表来自实际使用记录',
  monitor:     '后台间隔扫描 + 规则触发系统通知 · 设置保存在服务端 DB',
};

export default function Settings() {
  const [tab, setTab] = useState<TabKey>('preferences');
  return (
    <>
      <PageHeader title="设置" subtitle={SUBTITLE[tab]} />
      <Tabs
        activeKey={tab}
        onChange={(k) => setTab(k as TabKey)}
        items={[
          { key: 'preferences', label: '显示偏好', children: <PreferencesPane /> },
          { key: 'pricing',     label: '计费规则', children: <PricingPane /> },
          { key: 'monitor',     label: '用量监控', children: <MonitorPane /> },
        ]}
      />
    </>
  );
}
