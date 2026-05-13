import { useState } from 'react';
import { Tabs } from 'antd';
import PageHeader from '../../components/PageHeader.js';
import PricingPane from './Pricing.js';
import PreferencesPane from './Preferences.js';
import MonitorPane from './Monitor.js';
import { useI18n } from '../../i18n/index.js';
import type { MessageKey } from '../../i18n/messages.js';

type TabKey = 'preferences' | 'pricing' | 'monitor';

const SUBTITLE_KEY: Record<TabKey, MessageKey> = {
  preferences: 'settings.subtitle.preferences',
  pricing:     'settings.subtitle.pricing',
  monitor:     'settings.subtitle.monitor',
};

export default function Settings() {
  const [tab, setTab] = useState<TabKey>('preferences');
  const { t } = useI18n();
  return (
    <>
      <PageHeader title={t('settings.title')} subtitle={t(SUBTITLE_KEY[tab])} />
      <Tabs
        activeKey={tab}
        onChange={(k) => setTab(k as TabKey)}
        items={[
          { key: 'preferences', label: t('settings.tab.preferences'), children: <PreferencesPane /> },
          { key: 'pricing',     label: t('settings.tab.pricing'),     children: <PricingPane /> },
          { key: 'monitor',     label: t('settings.tab.monitor'),     children: <MonitorPane /> },
        ]}
      />
    </>
  );
}
