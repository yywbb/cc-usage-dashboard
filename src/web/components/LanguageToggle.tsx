import { Button, Tooltip } from 'antd';
import { GlobalOutlined } from '@ant-design/icons';
import { useI18n } from '../i18n/index.js';

export default function LanguageToggle() {
  const { lang, toggle, t } = useI18n();
  const label = lang === 'zh' ? t('lang.toEnglish') : t('lang.toChinese');
  return (
    <Tooltip title={label} placement="bottom">
      <Button
        type="text"
        shape="circle"
        icon={<GlobalOutlined />}
        onClick={toggle}
        aria-label={label}
      />
    </Tooltip>
  );
}
