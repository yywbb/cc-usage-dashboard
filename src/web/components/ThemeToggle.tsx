import { Button, Tooltip } from 'antd';
import { MoonOutlined, SunOutlined } from '@ant-design/icons';
import { useTheme } from '../theme/useTheme.js';
import { useI18n } from '../i18n/index.js';

export default function ThemeToggle() {
  const { mode, toggle } = useTheme();
  const { t } = useI18n();
  const label = mode === 'dark' ? t('theme.toLight') : t('theme.toDark');
  return (
    <Tooltip title={label} placement="bottom">
      <Button
        type="text"
        shape="circle"
        icon={mode === 'dark' ? <SunOutlined /> : <MoonOutlined />}
        onClick={toggle}
        aria-label={label}
      />
    </Tooltip>
  );
}
