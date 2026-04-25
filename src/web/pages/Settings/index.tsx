import { useState } from 'react';
import { Tabs } from 'antd';
import PageHeader from '../../components/PageHeader.js';
import PricingPane from './Pricing.js';
import PreferencesPane from './Preferences.js';

type TabKey = 'preferences' | 'pricing';

export default function Settings() {
  const [tab, setTab] = useState<TabKey>('preferences');
  const subtitle = tab === 'preferences'
    ? '显示偏好与本地配置 · 仅影响当前浏览器'
    : '按每百万 token 设置美元单价 · 模型列表来自实际使用记录';

  return (
    <>
      <PageHeader title="设置" subtitle={subtitle} />
      <Tabs
        activeKey={tab}
        onChange={(k) => setTab(k as TabKey)}
        items={[
          { key: 'preferences', label: '显示偏好', children: <PreferencesPane /> },
          { key: 'pricing',     label: '计费规则', children: <PricingPane /> },
        ]}
      />
    </>
  );
}
